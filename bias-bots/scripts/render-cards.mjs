#!/usr/bin/env node
// Пакетный рендер карточек в out/cards/<format>/NNN-id.png — для постинга вручную,
// загрузки в соцсети или n8n. Боту это не нужно: он рисует карточки на лету.
//
//   node scripts/render-cards.mjs                    все, формат post (1080×1350)
//   node scripts/render-cards.mjs --format story     1080×1920
//   node scripts/render-cards.mjs --only anchoring,halo-effect
//   node scripts/render-cards.mjs --handle @MyBot

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { biases, ROOT } from '../src/lib/data.mjs';
import { renderCard } from '../src/lib/cards.mjs';

const { values } = parseArgs({
  options: {
    format: { type: 'string', default: 'post' },
    only: { type: 'string' },
    handle: { type: 'string', default: process.env.BIAS_BOT_USERNAME ? `@${process.env.BIAS_BOT_USERNAME}` : '' },
    out: { type: 'string', default: path.join(ROOT, 'out', 'cards') },
  },
});

const only = values.only?.split(',').map((s) => s.trim());
const list = only ? biases.filter((b) => only.includes(b.id) || only.includes(String(b.n))) : biases;
const dir = path.join(values.out, values.format);
await mkdir(dir, { recursive: true });

const t0 = Date.now();
for (const b of list) {
  const png = await renderCard(b, { format: values.format, handle: values.handle });
  await writeFile(path.join(dir, `${String(b.n).padStart(3, '0')}-${b.id}.png`), png);
}
console.log(`${list.length} карточек → ${path.relative(process.cwd(), dir)} за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
