// Рубрика «Доказано наукой»: факты только из рандомизированных двойных слепых
// исследований. Показываем лишь те, что прошли проверку по PubMed
// (scripts/verify-facts.mjs → data/facts-pubmed.json).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, getBias } from './data.mjs';
import { esc } from './tg.mjs';

const raw = JSON.parse(readFileSync(path.join(ROOT, 'data', 'facts-ru.json'), 'utf8'));
const pubmed = JSON.parse(readFileSync(path.join(ROOT, 'data', 'facts-pubmed.json'), 'utf8'));

export const FACT_TOPICS = { food: 'Питание', move: 'Тренировки', med: 'Медицина', supp: 'Добавки', sleep: 'Сон' };

// Бесплатные — сначала, чтобы новичок видел витрину рубрики
export const facts = raw.facts
  .filter((f) => pubmed.records[f.pmid]?.verified)
  .map((f) => ({ ...f, source: pubmed.records[f.pmid] }))
  .sort((a, b) => Number(Boolean(b.free)) - Number(Boolean(a.free)));

export const unverified = raw.facts.filter((f) => !pubmed.records[f.pmid]?.verified).map((f) => f.id);
export const factsCheckedAt = pubmed.checked_at;
const byId = new Map(facts.map((f) => [f.id, f]));
export const getFact = (id) => byId.get(id) ?? null;
export const freeFacts = facts.filter((f) => f.free);

export const pubmedUrl = (pmid) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
export const sourceLine = (f) => `${f.source.journal}, ${f.source.year} · ${f.source.first_author} et al. · n = ${f.n.toLocaleString('ru-RU')}`;

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
    `📄 <b>Источник:</b> ${esc(sourceLine(f))}`,
    `Дизайн по PubMed: <i>«${esc(f.source.evidence.double_blind)}»</i>`,
    [`<a href="${pubmedUrl(f.pmid)}">PubMed ${f.pmid}</a>`, f.source.doi && `<a href="https://doi.org/${f.source.doi}">DOI</a>`].filter(Boolean).join(' · '),
  ];
  if (bias) {
    const name = biasLink ? `<a href="${biasLink(bias)}">${esc(bias.name_ru)}</a>` : `<b>${esc(bias.name_ru)}</b>`;
    lines.push('', `🧠 Ловушка мышления: ${name}`);
  }
  // Лимит Telegram — 1024 видимых символа (теги и адреса ссылок не считаются).
  // Не влезли — сначала убираем цитату дизайна, потом ограничения.
  const visible = (t) => t.replace(/<[^>]+>/g, '').replace(/&(lt|gt|amp|quot);/g, '_').length;
  let kept = lines;
  for (const drop of ['Дизайн по PubMed', '⚠️']) {
    if (visible(kept.join('\n')) <= 1024) break;
    kept = kept.filter((l) => !l.startsWith(drop));
  }
  return kept.join('\n');
}
