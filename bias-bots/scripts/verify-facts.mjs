#!/usr/bin/env node
// Проверка фактов рубрик «Доказано наукой» и «Плацебо и мифы» по PubMed (NCBI E-utilities).
//
// У каждого факта в data/facts-ru.json заявлен уровень доказанности, и запись
// PubMed (тип публикации, название, аннотация) должна его подтверждать:
//   A — рандомизация И двойное ослепление: тип «Randomized Controlled Trial» или
//       randomized / randomly assigned, плюс «double-blind», «double-masked»,
//       «double-dummy» или «patients and assessors … blinded»;
//   B — рандомизированное исследование либо мета-анализ/систематический обзор
//       рандомизированных исследований;
//   C — наблюдательное исследование (тип «Observational Study», когорта,
//       проспективное наблюдение) — подаётся как связь, а не доказательство.
// Результат с цитатами-доказательствами пишется в data/facts-pubmed.json;
// боты показывают только факты, чей уровень подтверждён. Код выхода 1, если
// хоть один факт не прошёл.
//
//   node scripts/verify-facts.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { ROOT } from '../src/lib/data.mjs';

const FACTS = path.join(ROOT, 'data', 'facts-ru.json');
const OUT = path.join(ROOT, 'data', 'facts-pubmed.json');

export const RULES = {
  randomized: /\brandomi[sz](?:ed|ation)\b|\brandomly (?:assigned|allocated)\b/i,
  doubleBlind: /double[- ]?(?:blind(?:ed)?|mask(?:ed)?|dummy)|(?:patients|participants) and (?:outcome )?(?:assessors|investigators|staff)[^.]{0,60}(?:blind|mask)/i,
  rctPool: /randomi[sz]ed controlled trials|randomi[sz]ed trials/i,
  observational: /\bcohorts?\b|\bprospective\b|\blongitudinal\b|\bobservational\b|population study/i,
};

const sentenceWith = (text, re) => {
  const sentences = text.split(/(?<=[.;])\s+|\n/);
  return sentences.find((s) => re.test(s))?.trim().slice(0, 240) ?? null;
};

export function verifyRecord(rec, level = 'A') {
  const text = `${rec.title}\n${rec.abstract}`;
  const rctType = rec.types.includes('Randomized Controlled Trial');
  const meta = rec.types.some((t) => t === 'Meta-Analysis' || t === 'Systematic Review');
  const randomizedEvidence = rctType ? 'Publication type: Randomized Controlled Trial' : sentenceWith(text, RULES.randomized);
  const blindEvidence = sentenceWith(text, RULES.doubleBlind);
  const poolEvidence = meta ? sentenceWith(text, RULES.rctPool) : null;
  const obsEvidence = rec.types.includes('Observational Study') ? 'Publication type: Observational Study' : sentenceWith(text, RULES.observational);

  const randomized = Boolean(randomizedEvidence);
  const double_blind = Boolean(blindEvidence);
  const checks = {
    A: randomized && double_blind && !meta,
    B: (randomized && !meta) || Boolean(poolEvidence),
    C: Boolean(obsEvidence) && !rctType,
  };
  const quote = { A: blindEvidence, B: meta ? poolEvidence : randomizedEvidence, C: obsEvidence }[level];
  return {
    level, meta, randomized, double_blind,
    evidence: { randomized: randomizedEvidence, double_blind: blindEvidence, level: quote ?? null },
    verified: Boolean(checks[level]),
  };
}

export function parsePubmedXml(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out = {};
  $('PubmedArticle').each((_, a) => {
    const $a = $(a);
    const pmid = $a.find('MedlineCitation > PMID').first().text();
    out[pmid] = {
      pmid,
      title: $a.find('ArticleTitle').first().text().trim(),
      journal: $a.find('Journal ISOAbbreviation').first().text(),
      year: $a.find('JournalIssue PubDate Year').first().text() || $a.find('JournalIssue PubDate MedlineDate').first().text().slice(0, 4),
      doi: $a.find('ArticleId[IdType="doi"]').first().text() || null,
      first_author: $a.find('AuthorList Author').first().find('LastName').text(),
      types: $a.find('PublicationType').map((_, t) => $(t).text()).get(),
      abstract: $a.find('Abstract AbstractText').map((_, t) => (t.attribs.Label ? `${t.attribs.Label}: ` : '') + $(t).text()).get().join('\n'),
    };
  });
  return out;
}

async function main() {
  const { facts } = JSON.parse(await readFile(FACTS, 'utf8'));
  const ids = facts.map((f) => f.pmid);
  const q = new URLSearchParams({ db: 'pubmed', id: ids.join(','), retmode: 'xml', tool: 'bias-bots' });
  const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${q}`);
  if (!res.ok) throw new Error(`PubMed: ${res.status} ${res.statusText}`);
  const records = parsePubmedXml(await res.text());

  const result = { checked_at: new Date().toISOString(), rule: 'A: randomized AND double-blind; B: RCT или мета-анализ РКИ; C: наблюдение — по записи PubMed', records: {} };
  let failed = 0;
  for (const f of facts) {
    const rec = records[f.pmid];
    if (!rec) {
      console.log(`✗ ${f.id}: PMID ${f.pmid} не найден`);
      failed++;
      continue;
    }
    const v = verifyRecord(rec, f.level ?? 'A');
    const { abstract, ...meta } = rec;
    result.records[f.pmid] = { ...meta, ...v };
    if (!v.verified) failed++;
    console.log(`${v.verified ? '✓' : '✗'} ${(f.level ?? 'A')} ${f.id.padEnd(24)} ${rec.journal} ${rec.year}  R:${v.randomized ? '+' : '−'} DB:${v.double_blind ? '+' : '−'}${v.meta ? ' мета' : ''}`);
  }
  await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(`\n${facts.length - failed}/${facts.length} прошли → ${path.relative(process.cwd(), OUT)}`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
