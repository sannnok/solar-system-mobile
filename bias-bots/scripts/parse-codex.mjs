#!/usr/bin/env node
// Парсер «Кодекса когнитивных искажений» (Cognitive Bias Codex, CC BY-SA 4.0).
//
// 1. Скачивает интерактивный SVG с Wikimedia Commons — в нём 4 квадранта,
//    20 групп и 188 искажений, у каждого ссылка на статью английской Википедии.
// 2. Через API Википедии находит русские статьи (межъязыковые ссылки) и берёт
//    вводные абзацы на ru/en.
// 3. Сшивает с короткими описаниями из ru-статьи «Список когнитивных искажений».
// 4. Накладывает ручные переводы из data/codex-ru.json и data/overrides-ru.json.
//
// Результат: data/biases.json — единый источник контента для ботов, карточек
// и роликов. Сырые ответы кешируются в data/raw/, повторный запуск офлайн;
// --refresh скачивает заново.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'data', 'biases.json');
const REFRESH = process.argv.includes('--refresh');
const UA = 'bias-bots/0.1 (educational Telegram bot; Node.js fetch)';

const CODEX_FILE = 'Cognitive_bias_codex_en.svg';
const CODEX_URL = 'https://upload.wikimedia.org/wikipedia/commons/6/65/Cognitive_bias_codex_en.svg';
const RU_LIST_TITLE = 'Список когнитивных искажений';

// ---------- сеть с кешем ----------

async function cached(name, fetcher) {
  const file = path.join(RAW, name);
  if (!REFRESH && existsSync(file)) return readFile(file, 'utf8');
  const body = await fetcher();
  await writeFile(file, body);
  return body;
}

// Википедия режет частые анонимные запросы (429): идём последовательно,
// с паузой, и уважаем Retry-After.
let lastRequest = 0;
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + 1500 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
    if (res.ok) return res.text();
    if (attempt >= 6 || (res.status < 500 && res.status !== 429)) {
      throw new Error(`${res.status} ${res.statusText} for ${url}`);
    }
    const retryAfter = Number(res.headers.get('retry-after')) || 5 * attempt;
    console.warn(`  ${res.status}, повтор через ${retryAfter} с`);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
  }
}

function api(lang, params) {
  const q = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  return `https://${lang}.wikipedia.org/w/api.php?${q}`;
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ---------- 1. SVG кодекса ----------

// Ссылка может вести на раздел статьи (…/Confirmation_bias#Continued_influence_effect):
// для API нужен заголовок без якоря.
function titleFromWikiUrl(url) {
  return decodeURIComponent(url.split('/wiki/')[1].split('#')[0]).replace(/_/g, ' ');
}

export function slugify(s) {
  return s.toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Текст без переводов: в SVG у каждой надписи есть <switch> с вариантами
// systemLanguage (pt, eu, ca); английский — вариант без атрибута.
function defaultText($, el) {
  const sw = $(el).is('switch') ? $(el) : $(el).find('switch').first();
  const t = sw.children('text').filter((_, n) => !n.attribs.systemLanguage).first();
  return t.find('tspan').map((_, s) => $(s).text().trim()).get().join(' ').replace(/\s+/g, ' ').trim()
    || t.text().replace(/\s+/g, ' ').trim();
}

export function parseCodexSvg(svg) {
  const $ = cheerio.load(svg, { xmlMode: true });
  const root = $('g#biases');
  const quadrantTitles = root.children('g').first().children('switch')
    .map((_, sw) => ({ color: (sw.attribs.style.match(/fill:(#\w+)/) || [])[1], title: defaultText($, sw) })).get();

  const quadrants = [];
  const groups = [];
  const biases = [];
  root.children('g').eq(1).children('g').each((qi, qg) => {
    const color = (qg.attribs.style.match(/fill:(#\w+)/) || [])[1];
    const q = quadrantTitles.find((t) => t.color === color);
    const quadrant = { id: `q${qi + 1}`, color, title_en: q?.title ?? '' };
    quadrants.push(quadrant);
    $(qg).children('g').each((gi, g) => {
      const group = {
        id: `${quadrant.id}g${gi + 1}`,
        quadrant: quadrant.id,
        title_en: defaultText($, $(g).children('switch').last()),
      };
      groups.push(group);
      $(g).children('a').each((_, a) => {
        const href = a.attribs['xlink:href'];
        const name_en = defaultText($, a);
        // Положение на круге кодекса: <g transform="rotate(-88.3) translate(428.0)">
        const angle = Number(($(a).children('g').attr('transform') ?? '').match(/rotate\(([-\d.]+)\)/)?.[1] ?? NaN);
        const dupe = biases.find((b) => b.id === slugify(name_en));
        if (dupe) { // «Negativity bias» нарисован в двух группах
          (dupe.also_groups ??= []).push(group.id);
          return;
        }
        biases.push({
          // id — по подписи, а не по ссылке: несколько искажений кодекса
          // ссылаются на одну и ту же статью (Baader-Meinhof → Frequency illusion).
          id: slugify(name_en),
          name_en,
          angle,
          wiki_title_en: titleFromWikiUrl(href),
          wiki_en: href,
          quadrant: quadrant.id,
          group: group.id,
        });
      });
    });
  });
  return { quadrants, groups, biases };
}

// ---------- 2. Википедия ----------

// Запрос по набору заголовков с учётом normalized/redirects: вернёт Map
// исходный_заголовок -> страница.
async function queryPages(lang, titles, params, cacheName) {
  const out = new Map();
  titles = [...new Set(titles)];
  const batches = chunk(titles, 20); // extracts отдаёт не больше 20 вступлений за раз
  for (const [i, batch] of batches.entries()) {
    const body = await cached(`${cacheName}-${i}.json`, () =>
      get(api(lang, { action: 'query', redirects: '1', titles: batch.join('|'), ...params })));
    const { query } = JSON.parse(body);
    const hop = new Map();
    for (const n of query.normalized ?? []) hop.set(n.from, n.to);
    for (const r of query.redirects ?? []) hop.set(r.from, r.to);
    const byTitle = new Map(query.pages.map((p) => [p.title, p]));
    for (const t of batch) {
      let cur = t;
      for (let k = 0; k < 4 && hop.has(cur); k++) cur = hop.get(cur);
      if (byTitle.has(cur)) out.set(t, byTitle.get(cur));
    }
  }
  return out;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Ручные тексты: data/ru/*.json, ключ — id искажения.
async function loadCurated() {
  const dir = path.join(ROOT, 'data', 'ru');
  const out = {};
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()) {
    Object.assign(out, JSON.parse(await readFile(path.join(dir, f), 'utf8')));
  }
  return out;
}

const stripStress = (s) => s.normalize('NFD').replace(/\u0301/g, '').normalize('NFC');

function firstSentences(text, maxLen = 320) {
  if (!text) return '';
  const clean = text
    .normalize('NFD').replace(/\u0301/g, '').normalize('NFC') // знаки ударения из ru-статей
    .replace(/\s*\([^()]*(?:\([^()]*\)[^()]*)*\)/g, '') // убираем скобки с англ. названиями и пр.
    .replace(/\s+/g, ' ')
    .trim();
  const parts = clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [clean];
  let res = '';
  for (const p of parts) {
    if ((res + p).length > maxLen && res) break;
    res += p;
  }
  return res.trim();
}

// ---------- 3. «Список когнитивных искажений» ----------

function parseRuList(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('.mw-parser-output li').each((_, li) => {
    const $li = $(li);
    if ($li.closest('.toc, .navbox, .reflist, .references, #toc').length) return;
    $li.find('sup, style, .mw-ref, ul').remove();
    const text = $li.text().replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
    // «Феномен Баадера — Майнхоф или … — недавно узнанная…»: в названии тоже
    // бывает тире, поэтому режем по первому тире, за которым идёт строчная буква.
    const m = text.match(/^(.+?)\s+[—–]\s+(?=[a-zа-яё«(])(.+)$/u) ?? text.match(/^(.+?)\s+[—–-]\s+(.+)$/);
    if (!m) return;
    const link = $li.children('a').first();
    const title = link.attr('title')?.replace(/ \(страница отсутствует\)$/, '');
    items.push({ name: m[1].trim(), desc: m[2].trim(), title: link.length && !link.hasClass('new') ? title : null });
  });
  return items;
}

// ---------- 4. сборка ----------

async function main() {
  await mkdir(RAW, { recursive: true });

  const svg = await cached(CODEX_FILE, () => get(CODEX_URL));
  const codex = parseCodexSvg(svg);
  console.log(`кодекс: ${codex.quadrants.length} квадранта, ${codex.groups.length} групп, ${codex.biases.length} искажений`);

  const enPages = await queryPages('en', codex.biases.map((b) => b.wiki_title_en),
    { prop: 'langlinks|extracts', lllang: 'ru', exintro: '1', explaintext: '1', exsentences: '3', exlimit: '20', lllimit: '500' },
    'en-pages');

  const ruTitles = [...new Set([...enPages.values()].map((p) => p.langlinks?.[0]?.title).filter(Boolean))];
  const ruPages = await queryPages('ru', ruTitles,
    { prop: 'extracts', exintro: '1', explaintext: '1', exsentences: '3', exlimit: '20' }, 'ru-pages');

  const listHtml = await cached('ru-list.json', () =>
    get(api('ru', { action: 'parse', page: RU_LIST_TITLE, prop: 'text', redirects: '1' })));
  const listItems = parseRuList(JSON.parse(listHtml).parse.text);
  const listTitles = [...new Set(listItems.map((i) => i.title).filter(Boolean))];
  const listCanon = await queryPages('ru', listTitles, { prop: 'info' }, 'ru-list-canon');
  const listByCanon = new Map();
  for (const it of listItems) {
    const canon = it.title && listCanon.get(it.title)?.title;
    if (canon && !listByCanon.has(canon)) listByCanon.set(canon, it);
  }

  const codexRu = JSON.parse(await readFile(path.join(ROOT, 'data', 'codex-ru.json'), 'utf8'));
  const curated = await loadCurated();

  // Кодекс ссылается и на разделы чужих статей (List_of_…#Humor_effect), и на
  // редиректы (Focusing effect → Anchoring). Статья «своя», если ссылка без
  // якоря и на ту же статью не ведёт прямая ссылка другого искажения
  // (переименованные статьи — тоже редиректы, их не отбрасываем).
  const directTargets = new Set(codex.biases
    .filter((b) => !b.wiki_en.includes('#') && enPages.get(b.wiki_title_en)?.title === b.wiki_title_en)
    .map((b) => b.wiki_title_en));
  const ownsArticle = (b, en) => Boolean(en) && !b.wiki_en.includes('#')
    && (en.title === b.wiki_title_en || !directTargets.has(en.title));

  const stats = { list: 0, article: 0, none: 0 };
  const missing = [];
  const biases = codex.biases.map((b, i) => {
    const en = enPages.get(b.wiki_title_en);
    const linkedRu = en?.langlinks?.[0]?.title ?? null;
    const own = ownsArticle(b, en);
    const ownRu = own && linkedRu && linkedRu !== RU_LIST_TITLE ? linkedRu : null;
    const ru = ownRu ? ruPages.get(ownRu) : null;
    const li = ownRu ? listByCanon.get(ru?.title ?? ownRu) : null;
    const c = curated[b.id];
    if (!c) missing.push(b.id);

    let wiki_summary_ru = '';
    if (li) { wiki_summary_ru = capitalize(stripStress(li.desc)); stats.list++; }
    else if (ru?.extract) { wiki_summary_ru = firstSentences(ru.extract, 400); stats.article++; }
    else stats.none++;

    return {
      n: i + 1,
      id: b.id,
      name_ru: c?.name ?? linkedRu?.replace(/\s*\(.*\)$/, '') ?? b.name_en,
      name_en: b.name_en,
      summary_ru: c?.summary ?? wiki_summary_ru,
      example_ru: c?.example ?? null,
      tip_ru: c?.tip ?? null,
      wiki_summary_ru: wiki_summary_ru || null,
      summary_en: own ? firstSentences(en.extract ?? '', 400) || null : null,
      quadrant: b.quadrant,
      group: b.group,
      angle: b.angle,
      ...(b.also_groups ? { also_groups: b.also_groups } : {}),
      wiki_en: b.wiki_en,
      wiki_ru: ownRu ? `https://ru.wikipedia.org/wiki/${encodeURIComponent(ownRu.replace(/ /g, '_'))}` : null,
    };
  });

  const quadrants = codex.quadrants.map((q, i) => ({ ...q, ...codexRu.quadrants[i] }));
  const groups = codex.groups.map((g, i) => ({ ...g, ...codexRu.groups[i] }));
  for (const [i, g] of codex.groups.entries()) {
    if (codexRu.groups[i]?.title_en_check && codexRu.groups[i].title_en_check !== g.title_en) {
      console.warn(`! группа ${g.id}: перевод от другой подписи — "${g.title_en}"`);
    }
  }

  const data = {
    generated_at: new Date().toISOString(),
    attribution: {
      codex: 'The Cognitive Bias Codex — дизайн John Manoogian III (jm3), категории Buster Benson, CC BY-SA 4.0, Wikimedia Commons',
      codex_url: 'https://commons.wikimedia.org/wiki/File:Cognitive_bias_codex_en.svg',
      texts: 'Краткие тексты — авторские (data/ru); wiki_summary_* — Википедия, CC BY-SA 4.0',
    },
    quadrants,
    groups: groups.map(({ title_en_check, ...g }) => g),
    biases,
  };
  await writeFile(OUT, JSON.stringify(data, null, 2) + '\n');

  console.log(`википедия ru: из списка ${stats.list}, из статьи ${stats.article}, нет ${stats.none}`);
  if (missing.length) console.log(`! нет в data/ru/*.json (${missing.length}): ${missing.join(', ')}`);
  console.log(`→ ${path.relative(process.cwd(), OUT)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
