// Хранилище обоих ботов: встроенный node:sqlite (Node ≥ 22.13), один файл.
// Оба бота и API могут работать отдельными процессами — WAL это переживает.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDb(file = process.env.DB_PATH ?? 'state/bots.db') {
  if (file !== ':memory:') mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      bot TEXT NOT NULL, id INTEGER NOT NULL,
      first_name TEXT, username TEXT,
      source TEXT,                         -- откуда пришёл: reels, channel, health, …
      created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      daily_hour INTEGER,                  -- час рассылки (по TZ_OFFSET) или NULL
      last_daily INTEGER,                  -- номер дня последней рассылки
      blocked INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL DEFAULT '{}',     -- JSON: счёт квиза, привычки, серии…
      PRIMARY KEY (bot, id)
    );
    CREATE TABLE IF NOT EXISTS events (
      ts INTEGER NOT NULL, bot TEXT NOT NULL, user_id INTEGER, type TEXT NOT NULL, payload TEXT
    );
    CREATE INDEX IF NOT EXISTS events_type ON events (bot, type, ts);
    CREATE TABLE IF NOT EXISTS file_cache (key TEXT PRIMARY KEY, file_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS purchases (
      charge_id TEXT PRIMARY KEY,          -- telegram_payment_charge_id (нужен для возврата)
      bot TEXT NOT NULL, user_id INTEGER NOT NULL, product TEXT NOT NULL,
      currency TEXT NOT NULL, amount INTEGER NOT NULL,
      ts INTEGER NOT NULL, refunded_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS purchases_user ON purchases (bot, user_id, product);
    CREATE TABLE IF NOT EXISTS videos (
      bias_id TEXT PRIMARY KEY, status TEXT NOT NULL, url TEXT, meta TEXT, ts INTEGER NOT NULL
    );
  `);
  return new Store(db);
}

export class Store {
  constructor(db) { this.db = db; }

  touchUser(bot, from, source = null) {
    const now = Date.now();
    const existing = this.getUser(bot, from.id);
    if (!existing) {
      this.db.prepare(`INSERT INTO users (bot, id, first_name, username, source, created_at, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(bot, from.id, from.first_name ?? null, from.username ?? null, source, now, now);
      this.log(bot, from.id, 'new_user', source);
      return { user: this.getUser(bot, from.id), isNew: true };
    }
    this.db.prepare('UPDATE users SET last_seen = ?, first_name = ?, username = ?, blocked = 0 WHERE bot = ? AND id = ?')
      .run(now, from.first_name ?? null, from.username ?? null, bot, from.id);
    return { user: { ...existing, last_seen: now }, isNew: false };
  }

  getUser(bot, id) {
    const row = this.db.prepare('SELECT * FROM users WHERE bot = ? AND id = ?').get(bot, id);
    return row ? { ...row, data: JSON.parse(row.data) } : null;
  }

  updateData(bot, id, fn) {
    const u = this.getUser(bot, id);
    if (!u) return null;
    const data = fn(structuredClone(u.data)) ?? u.data;
    this.db.prepare('UPDATE users SET data = ? WHERE bot = ? AND id = ?').run(JSON.stringify(data), bot, id);
    return data;
  }

  setDailyHour(bot, id, hour) {
    this.db.prepare('UPDATE users SET daily_hour = ? WHERE bot = ? AND id = ?').run(hour, bot, id);
  }

  dueForDaily(bot, hour, day) {
    return this.db.prepare(`SELECT * FROM users WHERE bot = ? AND blocked = 0 AND daily_hour = ?
      AND (last_daily IS NULL OR last_daily < ?)`).all(bot, hour, day)
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }

  markDaily(bot, id, day) {
    this.db.prepare('UPDATE users SET last_daily = ? WHERE bot = ? AND id = ?').run(day, bot, id);
  }

  markBlocked(bot, id) {
    this.db.prepare('UPDATE users SET blocked = 1 WHERE bot = ? AND id = ?').run(bot, id);
    this.log(bot, id, 'blocked');
  }

  log(bot, userId, type, payload = null) {
    this.db.prepare('INSERT INTO events (ts, bot, user_id, type, payload) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), bot, userId ?? null, type, payload == null ? null : String(payload));
  }

  cacheGet(key) { return this.db.prepare('SELECT file_id FROM file_cache WHERE key = ?').get(key)?.file_id ?? null; }
  cacheSet(key, fileId) { this.db.prepare('INSERT OR REPLACE INTO file_cache (key, file_id) VALUES (?, ?)').run(key, fileId); }

  kvGet(key) { return this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null; }
  kvSet(key, value) { this.db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, String(value)); }

  videoStatus(biasId) { return this.db.prepare('SELECT * FROM videos WHERE bias_id = ?').get(biasId) ?? null; }
  videosDone() { return new Set(this.db.prepare("SELECT bias_id FROM videos WHERE status = 'published'").all().map((r) => r.bias_id)); }
  setVideo(biasId, status, url = null, meta = null) {
    this.db.prepare('INSERT OR REPLACE INTO videos (bias_id, status, url, meta, ts) VALUES (?, ?, ?, ?, ?)')
      .run(biasId, status, url, meta == null ? null : JSON.stringify(meta), Date.now());
  }

  addPurchase({ bot, userId, product, currency, amount, chargeId }) {
    this.db.prepare(`INSERT OR IGNORE INTO purchases (charge_id, bot, user_id, product, currency, amount, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(chargeId, bot, userId, product, currency, amount, Date.now());
    this.log(bot, userId, 'purchase', `${product}:${amount}${currency}`);
  }

  activePurchase(bot, userId, product) {
    return this.db.prepare(`SELECT * FROM purchases WHERE bot = ? AND user_id = ? AND product = ? AND refunded_at IS NULL
      ORDER BY ts DESC LIMIT 1`).get(bot, userId, product) ?? null;
  }

  markRefunded(chargeId) {
    this.db.prepare('UPDATE purchases SET refunded_at = ? WHERE charge_id = ?').run(Date.now(), chargeId);
  }

  revenue(bot) {
    return this.db.prepare(`SELECT product, currency, COUNT(*) AS purchases, SUM(amount) AS amount FROM purchases
      WHERE bot = ? AND refunded_at IS NULL GROUP BY product, currency`).all(bot).map((r) => ({ ...r }));
  }

  stats(bot) {
    const one = (sql, ...a) => Object.values(this.db.prepare(sql).get(...a))[0];
    const dayAgo = Date.now() - 86_400_000;
    return {
      users: one('SELECT COUNT(*) FROM users WHERE bot = ?', bot),
      active24h: one('SELECT COUNT(*) FROM users WHERE bot = ? AND last_seen > ?', bot, dayAgo),
      new24h: one('SELECT COUNT(*) FROM users WHERE bot = ? AND created_at > ?', bot, dayAgo),
      subscribed: one('SELECT COUNT(*) FROM users WHERE bot = ? AND daily_hour IS NOT NULL AND blocked = 0', bot),
      blocked: one('SELECT COUNT(*) FROM users WHERE bot = ? AND blocked = 1', bot),
      sources: this.db.prepare(`SELECT COALESCE(source, '—') AS source, COUNT(*) AS n FROM users
        WHERE bot = ? GROUP BY source ORDER BY n DESC LIMIT 10`).all(bot),
      events24h: this.db.prepare(`SELECT type, COUNT(*) AS n FROM events WHERE bot = ? AND ts > ?
        GROUP BY type ORDER BY n DESC LIMIT 15`).all(bot, dayAgo),
    };
  }
}
