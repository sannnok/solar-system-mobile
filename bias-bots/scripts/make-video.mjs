#!/usr/bin/env node
// Ролик по одному искажению из командной строки.
//
//   node scripts/make-video.mjs --id sunk-cost-fallacy
//   node scripts/make-video.mjs --id 130 --audio voice.mp3 --music bg.mp3
//   node scripts/make-video.mjs --id anchoring --script    сценарий через Claude (нужен ANTHROPIC_API_KEY)
//   node scripts/make-video.mjs --today                    искажение дня
//   --style dynamic (по умолчанию, Remotion: анимация, переходы, эффекты) | simple (ffmpeg-слайды)
//   --cover                                                ещё и обложку .png

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv } from '../src/lib/env.mjs';
import { getBias, biasOfDay, ROOT } from '../src/lib/data.mjs';
import { makeVideo } from '../src/lib/video.mjs';
import { renderReel, renderReelStill } from '../src/lib/reel.mjs';
import { generateReelScript, templateScript } from '../src/lib/script.mjs';

loadEnv();
const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    today: { type: 'boolean' },
    audio: { type: 'string' },
    music: { type: 'string' },
    hook: { type: 'string' },
    script: { type: 'boolean' },
    style: { type: 'string', default: process.env.VIDEO_STYLE || 'dynamic' },
    cover: { type: 'boolean' },
    handle: { type: 'string', default: process.env.BIAS_BOT_USERNAME ? `@${process.env.BIAS_BOT_USERNAME}` : '' },
    out: { type: 'string', default: path.join(ROOT, 'out', 'videos') },
  },
});

const bias = values.today ? biasOfDay() : getBias(values.id);
if (!bias) {
  console.error('Укажите --id <id или номер> или --today');
  process.exit(1);
}
const botUsername = values.handle.replace(/^@/, '');
const script = values.script ? await generateReelScript(bias, { botUsername }) : templateScript(bias, { botUsername });
await mkdir(values.out, { recursive: true });
const base = path.join(values.out, `${String(bias.n).padStart(3, '0')}-${bias.id}`);
const t0 = Date.now();
const opts = {
  outFile: `${base}.mp4`, hook: values.hook ?? script.hook, handle: values.handle,
  audio: values.audio ?? null, music: values.music ?? process.env.MUSIC_FILE ?? null,
};
const res = values.style === 'simple' ? await makeVideo(bias, opts) : await renderReel(bias, opts);
if (values.cover) await renderReelStill(bias, { outFile: `${base}.png`, hook: opts.hook, handle: values.handle });
await writeFile(`${base}.json`, JSON.stringify(script, null, 2));
console.log(`${path.relative(process.cwd(), res.outFile)} · ${values.style} · ${res.duration.toFixed(1)} с · рендер ${((Date.now() - t0) / 1000).toFixed(1)} с`);
console.log(`сценарий (${script.source}) → ${path.relative(process.cwd(), base)}.json`);
