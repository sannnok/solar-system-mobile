// Карточки-картинки для искажений: satori (вёрстка флексами → SVG) + resvg (SVG → PNG).
// Браузер не нужен, рендер карточки ~100–200 мс — можно генерировать на лету в боте.
//
//   renderCard(bias, { format: 'post' })        1080×1350 — пост/фото в Telegram, Instagram
//   renderCard(bias, { format: 'story' })       1080×1920 — сторис
//   renderSlide(bias, kind, { format: 'story' }) кадры для роликов: hook | what | example | tip

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { biases, getQuadrant, getGroup } from './data.mjs';

const require = createRequire(import.meta.url);
const fontFile = (pkg, file) => readFileSync(require.resolve(`${pkg}/${file}`));

// Fontsource раздаёт шрифты по подмножествам (latin, cyrillic, …), а satori не
// склеивает файлы одного семейства — берёт первый и для недостающих глифов идёт
// к следующему семейству из fontFamily. Поэтому даём подмножествам разные имена
// и перечисляем их цепочкой; DejaVu — последний резерв для ≠, ± и т. п.
const SUBSETS = { '': 'latin', Cyr: 'cyrillic', Ext: 'latin-ext', CyrExt: 'cyrillic-ext' };
const FONTS = (() => {
  const list = [];
  for (const [suffix, sub] of Object.entries(SUBSETS)) {
    for (const w of [500, 600, 700, 800]) {
      list.push({ name: `Manrope${suffix}`, weight: w, style: 'normal', data: fontFile('@fontsource/manrope', `files/manrope-${sub}-${w}-normal.woff`) });
    }
    for (const w of [700, 800]) {
      list.push({ name: `Unbounded${suffix}`, weight: w, style: 'normal', data: fontFile('@fontsource/unbounded', `files/unbounded-${sub}-${w}-normal.woff`) });
    }
  }
  list.push({ name: 'DejaVu', weight: 400, style: 'normal', data: fontFile('dejavu-fonts-ttf', 'ttf/DejaVuSans.ttf') });
  list.push({ name: 'DejaVu', weight: 700, style: 'normal', data: fontFile('dejavu-fonts-ttf', 'ttf/DejaVuSans-Bold.ttf') });
  return list;
})();
const family = (base) => [...Object.keys(SUBSETS).map((s) => base + s), 'DejaVu'].join(', ');
const BODY_FONT = family('Manrope');
const TITLE_FONT = family('Unbounded');

const SIZES = { post: [1080, 1350], story: [1080, 1920], square: [1080, 1080] };

// ---------- мини-элементы ----------

function h(type, style = {}, ...children) {
  const flat = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  return { type, props: { style: { display: 'flex', ...style }, children: flat.length === 1 ? flat[0] : flat } };
}
const text = (style, str) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: str } });

const BG = '#0b0f17';
const INK = '#f5f7fb';
const MUTED = 'rgba(245,247,251,0.55)';

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Колесо кодекса: все 187 точек по их настоящим углам из SVG, текущая подсвечена.
export function codexWheelSvg(current, size = 200) {
  const c = size / 2;
  const r = size * 0.42;
  const dots = biases.map((b) => {
    const a = (b.angle * Math.PI) / 180;
    const q = getQuadrant(b.quadrant);
    const on = b.id === current?.id;
    const x = (c + r * Math.cos(a)).toFixed(1);
    const y = (c + r * Math.sin(a)).toFixed(1);
    return on ? '' : `<circle cx="${x}" cy="${y}" r="${Math.max(size * 0.008, 1.8)}" fill="${q.accent}" fill-opacity="0.55"/>`;
  }).join('');
  let hl = '';
  if (current) {
    const a = (current.angle * Math.PI) / 180;
    const q = getQuadrant(current.quadrant);
    const x = (c + r * Math.cos(a)).toFixed(1);
    const y = (c + r * Math.sin(a)).toFixed(1);
    hl = `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="${q.accent}" stroke-width="${size * 0.008}" stroke-opacity="0.8"/>`
      + `<circle cx="${x}" cy="${y}" r="${size * 0.05}" fill="${q.accent}" fill-opacity="0.25"/>`
      + `<circle cx="${x}" cy="${y}" r="${size * 0.025}" fill="${q.accent}"/>`
      + `<circle cx="${c}" cy="${c}" r="${size * 0.018}" fill="${q.accent}"/>`;
  }
  const ring = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="${size * 0.004}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${ring}${dots}${hl}</svg>`;
}

const wheel = (bias, size) => ({
  type: 'img',
  props: { width: size, height: size, src: `data:image/svg+xml;base64,${Buffer.from(codexWheelSvg(bias, size)).toString('base64')}` },
});

function titleSize(name, base) {
  const longestWord = Math.max(...name.split(/\s+/).map((w) => w.length));
  let s = base;
  if (name.length > 18) s = base * 0.84;
  if (name.length > 28) s = base * 0.72;
  // Unbounded широкий: длинное слово («Последовательного») не должно вылезать за край
  s = Math.min(s, (880 / Math.max(longestWord, 1)) * 1.45);
  return Math.round(s);
}

function background(accent, w, hgt) {
  return {
    position: 'absolute', left: 0, top: 0, width: w, height: hgt,
    backgroundColor: BG,
    backgroundImage: `radial-gradient(circle at 85% 0%, ${hexToRgba(accent, 0.35)} 0%, ${hexToRgba(accent, 0.08)} 35%, rgba(0,0,0,0) 60%)`,
  };
}

function pill(q) {
  return h('div', { alignItems: 'center', gap: 14, padding: '12px 22px', borderRadius: 999, backgroundColor: hexToRgba(q.accent, 0.14), border: `2px solid ${hexToRgba(q.accent, 0.4)}` },
    h('div', { width: 14, height: 14, borderRadius: 7, backgroundColor: q.accent }),
    text({ fontSize: 24, fontWeight: 800, letterSpacing: 2, color: q.accent, textTransform: 'uppercase' }, q.title_ru));
}

function box(label, body, q, { fontSize = 32 } = {}) {
  return h('div', { flexDirection: 'column', gap: 12, padding: '30px 34px', borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.055)', borderLeft: `6px solid ${q.accent}` },
    text({ fontSize: 20, fontWeight: 800, letterSpacing: 3, color: q.accent, textTransform: 'uppercase' }, label),
    text({ fontSize, fontWeight: 500, lineHeight: 1.35, color: INK }, body));
}

function footer(bias, handle, wheelSize) {
  return h('div', { alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' },
    h('div', { alignItems: 'center', gap: 20 },
      wheel(bias, wheelSize),
      h('div', { flexDirection: 'column', gap: 4 },
        text({ fontSize: 26, fontWeight: 800, color: INK }, handle || 'Кодекс искажений'),
        text({ fontSize: 20, fontWeight: 500, color: MUTED }, `№ ${bias.n} из ${biases.length} · Cognitive Bias Codex`))),
  );
}

// ---------- шаблоны ----------

function cardTree(bias, { format = 'post', handle = '' } = {}) {
  const [W, H] = SIZES[format];
  const q = getQuadrant(bias.quadrant);
  const g = getGroup(bias.group);
  const tall = format === 'story';
  const pad = tall ? 84 : 72;
  return h('div', { width: W, height: H, position: 'relative', fontFamily: BODY_FONT, color: INK },
    h('div', background(q.accent, W, H)),
    // satori считает padding поверх width/height, поэтому отступы — позицией и размером
    h('div', { position: 'absolute', left: pad, top: pad, width: W - 2 * pad, height: H - 2 * pad, flexDirection: 'column', gap: tall ? 36 : 30 },
      h('div', { flexDirection: 'column', gap: 18 },
        h('div', {}, pill(q)),
        text({ fontSize: 24, fontWeight: 600, color: MUTED, lineHeight: 1.3 }, g.title_ru)),
      h('div', { flexDirection: 'column', gap: 10, marginTop: tall ? 30 : 6 },
        text({ fontFamily: TITLE_FONT, fontWeight: 800, fontSize: titleSize(bias.name_ru, tall ? 80 : 74), lineHeight: 1.12, color: INK }, bias.name_ru),
        text({ fontSize: 26, fontWeight: 700, color: q.accent, letterSpacing: 1 }, bias.name_en)),
      text({ fontSize: tall ? 46 : 42, fontWeight: 600, lineHeight: 1.3, color: INK }, bias.summary_ru),
      bias.example_ru ? box('Пример', bias.example_ru, q, { fontSize: tall ? 36 : 32 }) : null,
      bias.tip_ru ? box('Как не попасться', bias.tip_ru, q, { fontSize: tall ? 36 : 32 }) : null,
      footer(bias, handle, tall ? 150 : 128)));
}

// Кадры для ролика 9:16: один смысловой блок на экран, крупно.
function slideTree(bias, kind, { handle = '', hook = '', cta = '' } = {}) {
  const [W, H] = SIZES.story;
  const q = getQuadrant(bias.quadrant);
  const big = (s, size = 64) => text({ fontSize: size, fontWeight: 700, lineHeight: 1.25, color: INK }, s);
  const label = (s) => text({ fontSize: 30, fontWeight: 800, letterSpacing: 4, color: q.accent, textTransform: 'uppercase' }, s);
  let body;
  switch (kind) {
    case 'hook':
      body = h('div', { flexDirection: 'column', alignItems: 'center', gap: 48, flexGrow: 1, justifyContent: 'center', paddingBottom: 120 },
        wheel(bias, 520),
        text({ fontFamily: TITLE_FONT, fontWeight: 800, fontSize: titleSize(bias.name_ru, 88), lineHeight: 1.1, textAlign: 'center', color: INK, justifyContent: 'center' }, bias.name_ru),
        hook ? text({ fontSize: 52, fontWeight: 600, lineHeight: 1.3, textAlign: 'center', color: MUTED, justifyContent: 'center' }, hook) : null);
      break;
    case 'what':
      body = h('div', { flexDirection: 'column', gap: 36, flexGrow: 1, justifyContent: 'center', paddingBottom: 200 }, label('Что это'), big(bias.summary_ru, 70));
      break;
    case 'example':
      body = h('div', { flexDirection: 'column', gap: 36, flexGrow: 1, justifyContent: 'center', paddingBottom: 200 }, label('Пример'), big(bias.example_ru ?? bias.summary_ru, 64));
      break;
    case 'tip':
      body = h('div', { flexDirection: 'column', gap: 36, flexGrow: 1, justifyContent: 'center', paddingBottom: 200 },
        label('Как не попасться'), big(bias.tip_ru ?? '', 64),
        h('div', { marginTop: 60, padding: '34px 40px', borderRadius: 32, backgroundColor: q.accent, alignSelf: 'flex-start' },
          text({ fontSize: 40, fontWeight: 800, color: BG }, cta || `Ещё ${biases.length - 1} искажений — в боте ${handle}`.trim())));
      break;
    default:
      throw new Error(`unknown slide kind: ${kind}`);
  }
  return h('div', { width: W, height: H, position: 'relative', fontFamily: BODY_FONT, color: INK },
    h('div', background(q.accent, W, H)),
    h('div', { position: 'absolute', left: 90, top: 120, width: W - 180, height: H - 260, flexDirection: 'column' },
      h('div', { justifyContent: 'space-between', alignItems: 'center' }, pill(q),
        text({ fontSize: 28, fontWeight: 700, color: MUTED }, `№ ${bias.n}`)),
      body,
      h('div', { justifyContent: 'space-between', alignItems: 'center' },
        text({ fontSize: 30, fontWeight: 800, color: INK }, handle),
        kind === 'hook' ? null : text({ fontSize: 26, fontWeight: 700, color: q.accent, maxWidth: 560, textAlign: 'right', justifyContent: 'flex-end' }, bias.name_ru))));
}

// Карточка совета для ЗОЖ-бота: тема, заголовок, суть, «попробуйте» и связанная ловушка мышления.
function tipTree(tip, topic, bias, { handle = '', format = 'post' } = {}) {
  const [W, H] = SIZES[format];
  const pad = 72;
  const accent = topic.accent;
  const q = { accent, title_ru: topic.title };
  return h('div', { width: W, height: H, position: 'relative', fontFamily: BODY_FONT, color: INK },
    h('div', background(accent, W, H)),
    h('div', { position: 'absolute', left: pad, top: pad, width: W - 2 * pad, height: H - 2 * pad, flexDirection: 'column', gap: 30 },
      h('div', {}, pill(q)),
      text({ fontFamily: TITLE_FONT, fontWeight: 800, fontSize: titleSize(tip.title, 68), lineHeight: 1.14, color: INK, marginTop: 10 }, tip.title),
      text({ fontSize: 38, fontWeight: 600, lineHeight: 1.32, color: INK }, tip.body),
      box('Попробуйте', tip.action, q, { fontSize: 32 }),
      bias ? h('div', { alignItems: 'center', gap: 24, padding: '26px 30px', borderRadius: 28, border: `2px dashed ${hexToRgba(accent, 0.5)}` },
        wheel(bias, 110),
        h('div', { flexDirection: 'column', gap: 6, flexShrink: 1 },
          text({ fontSize: 20, fontWeight: 800, letterSpacing: 3, color: accent, textTransform: 'uppercase' }, 'Ловушка мышления'),
          text({ fontSize: 30, fontWeight: 800, color: INK }, bias.name_ru),
          text({ fontSize: 24, fontWeight: 500, color: MUTED, lineHeight: 1.3 }, bias.summary_ru))) : null,
      h('div', { marginTop: 'auto', justifyContent: 'space-between', alignItems: 'center' },
        text({ fontSize: 26, fontWeight: 800, color: INK }, handle),
        text({ fontSize: 20, fontWeight: 500, color: MUTED }, 'Не является медицинской рекомендацией'))));
}

export async function renderTipCard(tip, topic, bias, opts = {}) {
  return toPng(tipTree(tip, topic, bias, opts), SIZES[opts.format ?? 'post']);
}

// Карточка факта рубрики «Доказано наукой»: утверждение, что сделали и нашли,
// вывод и источник (журнал, год, PMID) — чтобы картинка сама по себе была проверяемой.
const SCIENCE = '#38bdf8';
function factTree(fact, bias, { handle = '', topicTitle = '' } = {}) {
  const [W, H] = SIZES.post;
  const pad = 72;
  const q = { accent: SCIENCE, title_ru: 'Двойное слепое РКИ' };
  const src = fact.source;
  return h('div', { width: W, height: H, position: 'relative', fontFamily: BODY_FONT, color: INK },
    h('div', background(SCIENCE, W, H)),
    h('div', { position: 'absolute', left: pad, top: pad, width: W - 2 * pad, height: H - 2 * pad, flexDirection: 'column', gap: 24 },
      h('div', { justifyContent: 'space-between', alignItems: 'center' },
        pill(q),
        text({ fontSize: 24, fontWeight: 700, color: MUTED }, [topicTitle, src.year].filter(Boolean).join(' · '))),
      text({ fontFamily: TITLE_FONT, fontWeight: 800, fontSize: titleSize(fact.title, 62), lineHeight: 1.14, color: INK, marginTop: 6 }, fact.title),
      text({ fontSize: fact.body.length > 300 ? 30 : 33, fontWeight: 500, lineHeight: 1.36, color: INK }, fact.body),
      box('Что из этого следует', fact.takeaway, q, { fontSize: 29 }),
      h('div', { marginTop: 'auto', flexDirection: 'column', gap: 6, padding: '22px 28px', borderRadius: 24, border: `2px solid ${hexToRgba(SCIENCE, 0.35)}` },
        text({ fontSize: 19, fontWeight: 800, letterSpacing: 3, color: SCIENCE, textTransform: 'uppercase' }, 'Источник'),
        text({ fontSize: 27, fontWeight: 800, color: INK }, `${src.journal}, ${src.year} · ${src.first_author} et al. · n = ${fact.n.toLocaleString('ru-RU')}`),
        text({ fontSize: 23, fontWeight: 600, color: MUTED }, `PubMed ${fact.pmid}${src.doi ? ` · doi.org/${src.doi}` : ''}`)),
      h('div', { justifyContent: 'space-between', alignItems: 'center' },
        h('div', { alignItems: 'center', gap: 14 },
          bias ? wheel(bias, 56) : null,
          text({ fontSize: 24, fontWeight: 800, color: INK }, handle)),
        text({ fontSize: 19, fontWeight: 500, color: MUTED }, 'Не является медицинской рекомендацией'))));
}

export async function renderFactCard(fact, bias, opts = {}) {
  return toPng(factTree(fact, bias, opts), SIZES.post);
}

async function toPng(tree, [W, H]) {
  const svg = await satori(tree, { width: W, height: H, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false } }).render().asPng();
}

export async function renderCard(bias, opts = {}) {
  return toPng(cardTree(bias, opts), SIZES[opts.format ?? 'post']);
}

export async function renderSlide(bias, kind, opts = {}) {
  return toPng(slideTree(bias, kind, opts), SIZES.story);
}

export const SLIDE_KINDS = ['hook', 'what', 'example', 'tip'];
