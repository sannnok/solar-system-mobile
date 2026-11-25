// Факты из исследований для двух рубрик:
//   «Доказано наукой» (rubric: health) — ЗОЖ-бот, про тело: питание, тренировки, сон, долголетие;
//   «Плацебо и мифы»  (rubric: myths)  — бот «Кодекс», про то, как нас обманывает голова.
// У каждого факта уровень доказанности (A/B/C), подтверждённый по PubMed
// (scripts/verify-facts.mjs → data/facts-pubmed.json). Неподтверждённые не показываются.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, getBias } from './data.mjs';
import { esc } from './tg.mjs';

const raw = JSON.parse(readFileSync(path.join(ROOT, 'data', 'facts-ru.json'), 'utf8'));
const pubmed = JSON.parse(readFileSync(path.join(ROOT, 'data', 'facts-pubmed.json'), 'utf8'));

export const FACT_TOPICS = { food: 'Питание', train: 'Тренировки', sleep: 'Сон', long: 'Долголетие', supp: 'Добавки', med: 'Медицина' };

export const LEVELS = {
  A: { badge: 'Двойное слепое РКИ', short: 'A', color: '#38bdf8', explain: 'рандомизированное двойное слепое исследование — ни участники, ни исследователи не знали, кто что получает' },
  B: { badge: 'Рандомизированное', short: 'B', color: '#34d399', explain: 'рандомизированное исследование или сводный анализ таких — участников распределяли случайно' },
  C: { badge: 'Наблюдение · связь', short: 'C', color: '#fbbf24', explain: 'наблюдение за людьми — показывает связь, а не доказывает причину' },
};
export const levelBadge = (f) => (f.level === 'B' && f.source.meta ? 'Мета-анализ РКИ' : f.level === 'C' && f.source.meta ? 'Мета-анализ наблюдений' : LEVELS[f.level].badge);

const verified = raw.facts
  .filter((f) => pubmed.records[f.pmid]?.verified && pubmed.records[f.pmid].level === f.level)
  .map((f) => ({ ...f, source: pubmed.records[f.pmid] }));

export const unverified = raw.facts.filter((f) => !verified.some((v) => v.id === f.id)).map((f) => f.id);
export const factsCheckedAt = pubmed.checked_at;

// Бесплатные — первыми, дальше по уровню (A → B → C), чтобы витрина была сильной
export function factsFor(rubric) {
  return verified
    .filter((f) => f.rubric === rubric)
    .sort((a, b) => Number(Boolean(b.free)) - Number(Boolean(a.free)) || a.level.localeCompare(b.level));
}
export const facts = verified;
const byId = new Map(verified.map((f) => [f.id, f]));
export const getFact = (id) => byId.get(id) ?? null;

export const pubmedUrl = (pmid) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
export const sampleText = (f) => f.n_text ?? `n = ${f.n.toLocaleString('ru-RU')}`;
export const sourceLine = (f) => `${f.source.journal}, ${f.source.year} · ${f.source.first_author} et al. · ${sampleText(f)}`;

export function factCaption(f, { biasLink = null } = {}) {
  const bias = getBias(f.bias);
  const lines = [
    `🔬 <b>${esc(f.title)}</b>`,
    '',
    esc(f.body),
    '',
    `👉 <b>Что из этого следует:</b> ${esc(f.takeaway)}`,
    `⚠️ <i>Ограничения: ${esc(f.limits)}</i>`,
    '',
    `📊 <b>Уровень ${f.level}</b> — ${esc(LEVELS[f.level].explain)}.`,
    `📄 <b>Источник:</b> ${esc(sourceLine(f))}`,
    `PubMed: <i>«${esc(f.source.evidence.level)}»</i>`,
    [`<a href="${pubmedUrl(f.pmid)}">PubMed ${f.pmid}</a>`, f.source.doi && `<a href="https://doi.org/${f.source.doi}">DOI</a>`].filter(Boolean).join(' · '),
  ];
  if (bias) {
    const name = biasLink ? `<a href="${biasLink(bias)}">${esc(bias.name_ru)}</a>` : `<b>${esc(bias.name_ru)}</b>`;
    lines.push('', `🧠 Ловушка мышления: ${name}`);
  }
  // Лимит Telegram — 1024 видимых символа (теги и адреса ссылок не считаются).
  // Не влезли — убираем по очереди: цитату PubMed, расшифровку уровня, ограничения.
  const visible = (t) => t.replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot);/g, '_').length;
  let kept = lines;
  for (const drop of ['PubMed: ', '📊', '⚠️']) {
    if (visible(kept.join('\n')) <= 1024) break;
    kept = kept.filter((l) => !l.startsWith(drop));
  }
  return kept.join('\n');
}
