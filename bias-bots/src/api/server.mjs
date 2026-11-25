#!/usr/bin/env node
// HTTP API для n8n и других автоматизаций (и раздача интерактивной карты).
//
//   GET  /api/health
//   GET  /api/stats                          воронка: пользователи, источники, события обоих ботов
//   GET  /api/biases                         список (n, id, name_ru, quadrant)
//   GET  /api/bias/today                     искажение дня + подписи
//   GET  /api/bias/next-video                следующее искажение без опубликованного ролика
//   GET  /api/bias/:id                       одно искажение (+ подписи и ссылки)
//   GET  /api/bias/:id/script                сценарий ролика (Claude или шаблон)
//   GET  /api/card/:id.png?format=post|story карточка
//   GET  /api/slide/:id/:kind.png?hook=…     кадр ролика (hook|what|example|tip)
//   POST /api/video/:id?hook=…&cta=…&style=  → video/mp4. Тело: озвучка (audio/*) или пусто;
//                                              style=dynamic (Remotion, по умолчанию) | simple (ffmpeg)
//   GET  /api/cover/:id.png?hook=…            обложка ролика (кадр с колесом и названием)
//   POST /api/video/:id/published            {"url": "..."} — отметить опубликованным
//   GET  /webapp/…                           Telegram Mini App «интерактивная карта»
//
// Доступ: заголовок x-api-key или ?key= (если задан API_KEY). Webapp и /data — публичные.

import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../lib/env.mjs';
import { openDb } from '../lib/db.mjs';
import { ROOT, biases, getBias, biasOfDay, getQuadrant, getGroup } from '../lib/data.mjs';
import { renderCard, renderSlide, SLIDE_KINDS } from '../lib/cards.mjs';
import { biasCaption, biasPlainCaption } from '../lib/captions.mjs';
import { generateReelScript } from '../lib/script.mjs';
import { makeVideo } from '../lib/video.mjs';
import { renderReel, renderReelStill } from '../lib/reel.mjs';
import { deepLink } from '../lib/tg.mjs';

const MAX_AUDIO = 25 * 1024 * 1024;
const STATIC = {
  '/webapp/': path.join(ROOT, 'webapp'),
  '/data/': path.join(ROOT, 'data'),
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createApi({ store, apiKey = process.env.API_KEY || '', botUsername = process.env.BIAS_BOT_USERNAME || '' } = {}) {
  const handle = botUsername ? `@${botUsername}` : '';

  const full = (b) => ({
    ...b,
    quadrant_title: getQuadrant(b.quadrant).title_ru,
    group_title: getGroup(b.group).title_ru,
    bot_link: deepLink(botUsername, `b${b.n}_reels`),
    caption_html: biasCaption(b, { botUsername }),
    caption_plain: biasPlainCaption(b, { botUsername }),
    card_url: `/api/card/${b.id}.png`,
    video: store.videoStatus(b.id),
  });

  const routes = [
    ['GET', /^\/api\/health$/, () => json({ ok: true, biases: biases.length })],
    ['GET', /^\/api\/stats$/, () => json({
      bias: store.stats('bias'),
      health: store.stats('health'),
      revenue: store.revenue('health'),
      videos_published: store.videosDone().size,
      videos_left: biases.length - store.videosDone().size,
    })],
    ['GET', /^\/api\/biases$/, () => json(biases.map(({ n, id, name_ru, name_en, quadrant, group }) => ({ n, id, name_ru, name_en, quadrant, group })))],
    ['GET', /^\/api\/bias\/today$/, () => json(full(biasOfDay()))],
    ['GET', /^\/api\/bias\/next-video$/, () => {
      // Идём по порядку «искажения дня», начиная с сегодняшнего, и берём первое без ролика
      const done = store.videosDone();
      const start = biasOfDay();
      const order = [start, ...biases.filter((b) => b.id !== start.id)];
      const next = order.find((b) => !done.has(b.id));
      return next ? json(full(next)) : json({ done: true }, 404);
    }],
    ['GET', /^\/api\/bias\/([\w-]+)\/script$/, async (m) => {
      const b = getBias(m[1]);
      if (!b) return notFound();
      return json({ id: b.id, ...(await generateReelScript(b, { botUsername })) });
    }],
    ['GET', /^\/api\/bias\/([\w-]+)$/, (m) => (getBias(m[1]) ? json(full(getBias(m[1]))) : notFound())],
    ['GET', /^\/api\/card\/([\w-]+)\.png$/, async (m, url) => {
      const b = getBias(m[1]);
      if (!b) return notFound();
      const format = ['post', 'story', 'square'].includes(url.searchParams.get('format')) ? url.searchParams.get('format') : 'post';
      return png(await renderCard(b, { format, handle }));
    }],
    ['GET', /^\/api\/slide\/([\w-]+)\/(\w+)\.png$/, async (m, url) => {
      const b = getBias(m[1]);
      if (!b || !SLIDE_KINDS.includes(m[2])) return notFound();
      return png(await renderSlide(b, m[2], { handle, hook: url.searchParams.get('hook') ?? '', cta: url.searchParams.get('cta') ?? '' }));
    }],
    ['POST', /^\/api\/video\/([\w-]+)$/, async (m, url, req) => {
      const b = getBias(m[1]);
      if (!b) return notFound();
      const body = await readBody(req, MAX_AUDIO);
      const dir = await mkdtemp(path.join(tmpdir(), 'api-video-'));
      try {
        let audio = null;
        let hook = url.searchParams.get('hook') ?? '';
        let cta = url.searchParams.get('cta') ?? '';
        const type = req.headers['content-type'] ?? '';
        if (body.length && type.includes('application/json')) {
          const j = JSON.parse(body.toString('utf8'));
          hook = j.hook ?? hook;
          cta = j.cta ?? cta;
          if (j.audio_base64) {
            audio = path.join(dir, 'voice.mp3');
            await writeFile(audio, Buffer.from(j.audio_base64, 'base64'));
          }
        } else if (body.length) {
          audio = path.join(dir, `voice${type.includes('wav') ? '.wav' : '.mp3'}`);
          await writeFile(audio, body);
        }
        const outFile = path.join(dir, `${b.id}.mp4`);
        const style = (url.searchParams.get('style') || process.env.VIDEO_STYLE || 'dynamic') === 'simple' ? 'simple' : 'dynamic';
        const res = style === 'simple' ? await makeVideo(b, { outFile, hook, cta, handle, audio }) : await renderReel(b, { outFile, hook, cta, handle, audio });
        store.setVideo(b.id, 'rendered', null, { duration: res.duration, hook, style });
        return {
          status: 200,
          headers: {
            'content-type': 'video/mp4',
            'content-disposition': `attachment; filename="${String(b.n).padStart(3, '0')}-${b.id}.mp4"`,
            'x-video-duration': res.duration.toFixed(2),
          },
          body: await readFile(outFile),
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }],
    ['GET', /^\/api\/cover\/([\w-]+)\.png$/, async (m, url) => {
      const b = getBias(m[1]);
      if (!b) return notFound();
      const dir = await mkdtemp(path.join(tmpdir(), 'api-cover-'));
      try {
        const outFile = path.join(dir, 'cover.png');
        await renderReelStill(b, { outFile, hook: url.searchParams.get('hook') ?? '', handle });
        return png(await readFile(outFile));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }],
    ['POST', /^\/api\/video\/([\w-]+)\/published$/, async (m, url, req) => {
      const b = getBias(m[1]);
      if (!b) return notFound();
      const body = await readBody(req, 64 * 1024);
      const j = body.length ? JSON.parse(body.toString('utf8')) : {};
      store.setVideo(b.id, 'published', j.url ?? null, j);
      return json({ ok: true, id: b.id });
    }],
  ];

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      for (const [prefix, dir] of Object.entries(STATIC)) {
        if (req.method === 'GET' && (url.pathname.startsWith(prefix) || url.pathname === prefix.slice(0, -1))) {
          return send(res, await serveStatic(dir, url.pathname.slice(prefix.length) || 'index.html'));
        }
      }
      if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health' && apiKey
        && req.headers['x-api-key'] !== apiKey && url.searchParams.get('key') !== apiKey) {
        return send(res, json({ error: 'unauthorized' }, 401));
      }
      for (const [method, re, fn] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) return send(res, await fn(m, url, req));
      }
      send(res, notFound());
    } catch (e) {
      console.error('[api]', req.method, url.pathname, e);
      send(res, json({ error: e.message }, e.status ?? 500));
    }
  }

  return { handler };
}

async function serveStatic(dir, rel) {
  const file = path.resolve(dir, decodeURIComponent(rel));
  if (!file.startsWith(dir + path.sep) && file !== dir) return notFound();
  try {
    const s = await stat(file);
    const target = s.isDirectory() ? path.join(file, 'index.html') : file;
    return { status: 200, headers: { 'content-type': MIME[path.extname(target)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=300' }, body: await readFile(target) };
  } catch {
    return notFound();
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const json = (data, status = 200) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(data) });
const png = (buf) => ({ status: 200, headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' }, body: buf });
const notFound = () => json({ error: 'not found' }, 404);
function send(res, r) {
  res.writeHead(r.status, { 'access-control-allow-origin': '*', ...r.headers });
  res.end(r.body);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv();
  const { handler } = createApi({ store: openDb() });
  const port = Number(process.env.PORT ?? 8787);
  http.createServer(handler).listen(port, () => console.log(`API: http://localhost:${port}/api/health`));
}
