import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createApi } from '../src/api/server.mjs';
import { openDb } from '../src/lib/db.mjs';
import { biasOfDay } from '../src/lib/data.mjs';

let server, base;
const KEY = 'secret';
before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { handler } = createApi({ store: openDb(':memory:'), apiKey: KEY, botUsername: 'BiasTestBot' });
  server = http.createServer(handler);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
const api = (p, opts = {}) => fetch(base + p, { ...opts, headers: { 'x-api-key': KEY, ...(opts.headers ?? {}) } });

test('health без ключа, остальное — с ключом', async () => {
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  assert.equal((await fetch(`${base}/api/biases`)).status, 401);
  const list = await (await api('/api/biases')).json();
  assert.equal(list.length, 187);
});

test('искажение дня с подписями и ссылкой в бота', async () => {
  const b = await (await api('/api/bias/today')).json();
  assert.equal(b.id, biasOfDay().id);
  assert.match(b.bot_link, /t\.me\/BiasTestBot\?start=b\d+_reels/);
  assert.ok(b.caption_plain.includes('@BiasTestBot'));
});

test('next-video пропускает опубликованные', async () => {
  const first = await (await api('/api/bias/next-video')).json();
  const r = await api(`/api/video/${first.id}/published`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com/v' }) });
  assert.equal(r.status, 200);
  const second = await (await api('/api/bias/next-video')).json();
  assert.notEqual(second.id, first.id);
});

test('карточка, кадр, сценарий-шаблон, статика', async () => {
  const card = await api('/api/card/anchoring.png?format=story');
  assert.equal(card.headers.get('content-type'), 'image/png');
  assert.ok((await card.arrayBuffer()).byteLength > 10_000);
  assert.equal((await api('/api/slide/anchoring/hook.png?hook=Тест')).status, 200);
  assert.equal((await api('/api/slide/anchoring/nope.png')).status, 404);
  const s = await (await api('/api/bias/anchoring/script')).json();
  assert.equal(s.source, 'template');
  assert.ok(s.voiceover.includes('Эффект якоря'));
  const data = await fetch(`${base}/data/biases.json`);
  assert.equal(data.status, 200);
  assert.equal((await fetch(`${base}/data/../package.json`)).status, 404);
});

let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

test('POST /api/video отдаёт mp4', { skip: !hasFfmpeg, timeout: 120_000 }, async () => {
  const r = await api('/api/video/halo-effect?style=simple&hook=' + encodeURIComponent('Почему красивым верят больше?'), { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(4, 8).toString(), 'ftyp');
});
