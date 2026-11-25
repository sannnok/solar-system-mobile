import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildTimeline, defaultHighlight, FPS, OVERLAP } from '../video/timeline.mjs';
import { reelProps, renderReelStill, renderReel, browserExecutable } from '../src/lib/reel.mjs';
import { getBias } from '../src/lib/data.mjs';

const bias = getBias('sunk-cost-fallacy');
const texts = { hook: 'Почему мы досматриваем скучное кино до конца?', summary: bias.summary_ru, example: bias.example_ru, tip: bias.tip_ru };

test('раскадровка: 6 сцен встык с нахлёстом, ритм 2–5 секунд', () => {
  const t = buildTimeline(texts);
  assert.deepEqual(t.scenes.map((s) => s.id), ['hook', 'term', 'what', 'example', 'tip', 'cta']);
  for (let i = 1; i < t.scenes.length; i++) assert.equal(t.scenes[i].from, t.scenes[i - 1].from + t.scenes[i - 1].dur - OVERLAP);
  for (const s of t.scenes) assert.ok(s.dur >= 2.2 * FPS && s.dur <= 5 * FPS, `${s.id}: ${s.dur}`);
  assert.equal(t.total, t.scenes.at(-1).from + t.scenes.at(-1).dur);
});

test('раскадровка подстраивается под длину озвучки', () => {
  const voice = 31.5;
  const t = buildTimeline(texts, { audioDuration: voice });
  assert.ok(Math.abs(t.total / FPS - (voice + 1)) < 0.3, `${t.total / FPS} с`);
});

test('маркер по умолчанию — последние слова фразы', () => {
  assert.equal(defaultHighlight('Продолжаем вкладываться во что-то, потому что уже много вложили.'), 'уже много вложили');
  assert.equal(defaultHighlight('Коротко и ясно.'), 'ясно');
});

test('данные для шаблона: колесо из 187 точек, своя подсвечена, карточка из бота', async () => {
  const p = await reelProps(bias, { hook: texts.hook, handle: '@Bot' });
  assert.equal(p.wheel.length, 187);
  assert.equal(p.wheel.filter((d) => d.on).length, 1);
  assert.match(p.card, /^data:image\/png;base64,/);
  assert.equal(p.bias.name, bias.name_ru);
});

const canRender = Boolean(browserExecutable());
let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { hasFfmpeg = false; }

test('обложка ролика рендерится в PNG 1080×1920', { skip: !canRender && 'нет headless-браузера', timeout: 180_000 }, async () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'cover-')), 'c.png');
  await renderReelStill(bias, { outFile: out, hook: texts.hook, handle: '@Bot' });
  const buf = (await import('node:fs')).readFileSync(out);
  assert.equal(buf.readUInt32BE(16), 1080);
  assert.equal(buf.readUInt32BE(20), 1920);
});

test('полный динамичный ролик (RUN_REEL=1)', { skip: !(process.env.RUN_REEL && canRender && hasFfmpeg) && 'включается RUN_REEL=1', timeout: 600_000 }, async () => {
  const out = path.join(mkdtempSync(path.join(tmpdir(), 'reel-')), 'r.mp4');
  const res = await renderReel(bias, { outFile: out, hook: texts.hook, handle: '@Bot' });
  assert.ok(existsSync(out) && statSync(out).size > 100_000);
  assert.ok(res.duration > 15 && res.duration < 35);
});
