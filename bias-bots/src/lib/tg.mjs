// Общие помощники Telegram для обоих ботов.
import { InputFile, GrammyError } from 'grammy';

export const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const TZ_OFFSET = Number(process.env.TZ_OFFSET ?? 180); // минут к UTC, по умолчанию Москва

export function localNow(date = new Date(), tz = TZ_OFFSET) {
  const t = new Date(date.getTime() + tz * 60_000);
  return { hour: t.getUTCHours(), minute: t.getUTCMinutes(), day: Math.floor(t.getTime() / 86_400_000), weekday: t.getUTCDay() };
}

// Фото с кешем file_id: первый раз рендерим и загружаем PNG, дальше Telegram
// отдаёт ту же картинку по file_id мгновенно и без трафика.
export async function sendPhotoCached(api, store, chatId, key, render, extra = {}) {
  const cached = store.cacheGet(key);
  if (cached) {
    try {
      return await api.sendPhoto(chatId, cached, extra);
    } catch (e) {
      if (!(e instanceof GrammyError) || !/file|wrong|invalid/i.test(e.description)) throw e;
      // file_id протух (сменили бота/токен) — перезальём
    }
  }
  const png = await render();
  const msg = await api.sendPhoto(chatId, new InputFile(png, `${key.replace(/[^\w-]+/g, '_')}.png`), extra);
  const fileId = msg.photo?.at(-1)?.file_id;
  if (fileId) store.cacheSet(key, fileId);
  return msg;
}

export const isBlockedError = (e) => e instanceof GrammyError
  && (e.error_code === 403 || /chat not found|user is deactivated/i.test(e.description));

// Минутный планировщик: fn(local) вызывается раз в минуту; ошибки не роняют процесс.
export function everyMinute(fn) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await fn(localNow()); } catch (e) { console.error('[scheduler]', e); } finally { running = false; }
  };
  const timer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
  return () => clearInterval(timer);
}

// Рассылка с паузой — Telegram разрешает ~30 сообщений в секунду на бота.
export async function broadcast(users, send, { store, bot, onSent } = {}) {
  let ok = 0;
  for (const u of users) {
    try {
      await send(u);
      onSent?.(u);
      ok++;
    } catch (e) {
      if (isBlockedError(e)) store?.markBlocked(bot, u.id);
      else console.error(`[broadcast] ${u.id}:`, e.description ?? e.message);
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return ok;
}

// Разбор параметра /start: «b19_reels» → открыть искажение №19, источник reels;
// «reels» → только источник. Формат ограничен Telegram: [A-Za-z0-9_-], до 64 символов.
export function parseStartPayload(payload = '') {
  const m = payload.match(/^([a-z])(\d+)(?:_([\w-]{1,40}))?$/i);
  if (m) return { kind: m[1].toLowerCase(), n: Number(m[2]), source: m[3] ?? null };
  if (/^[\w-]{1,64}$/.test(payload)) return { kind: null, n: null, source: payload };
  return { kind: null, n: null, source: null };
}

export const deepLink = (username, payload) => username ? `https://t.me/${username}${payload ? `?start=${payload}` : ''}` : null;
