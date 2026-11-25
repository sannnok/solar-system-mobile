#!/usr/bin/env node
// Проверка рубрики «Доказано наукой» по PubMed (NCBI E-utilities).
//
// Для каждого факта из data/facts-ru.json берёт запись PubMed по PMID и требует:
//   1) рандомизацию — тип публикации «Randomized Controlled Trial» или слова
//      randomized / randomised / randomly assigned в названии или аннотации;
//   2) двойное ослепление — «double-blind», «double-masked», «double-dummy» или
//      «patients and assessors … blinded» в названии или аннотации.
// Результат с цитатами-доказательствами пишется в data/facts-pubmed.json;
// бот показывает только факты со статусом verified. Код выхода 1, если хоть
// один факт не прошёл.
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
};

const sentenceWith = (text, re) => {
  const sentences = text.split(/(?<=[.;])\s+/);
  return sentences.find((s) => re.test(s))?.trim().slice(0, 240) ?? null;
};

export function verifyRecord(rec) {
  const text = `${rec.title}\n${rec.abstract}`;
  const rctType = rec.types.includes('Randomized Controlled Trial');
  const randomizedEvidence = sentenceWith(text, RULES.randomized);
  const blindEvidence = sentenceWith(text, RULES.doubleBlind);
  return {
    randomized: rctType || Boolean(randomizedEvidence),
    double_blind: Boolean(blindEvidence),
    evidence: { randomized: rctType ? 'Publication type: Randomized Controlled Trial' : randomizedEvidence, double_blind: blindEvidence },
    verified: (rctType || Boolean(randomizedEvidence)) && Boolean(blindEvidence),
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

  const result = { checked_at: new Date().toISOString(), rule: 'randomized AND double-blind, по записи PubMed', records: {} };
  let failed = 0;
  for (const f of facts) {
    const rec = records[f.pmid];
    if (!rec) {
      console.log(`✗ ${f.id}: PMID ${f.pmid} не найден`);
      failed++;
      continue;
    }
    const v = verifyRecord(rec);
    const { abstract, ...meta } = rec;
    result.records[f.pmid] = { ...meta, ...v };
    if (!v.verified) failed++;
    console.log(`${v.verified ? '✓' : '✗'} ${f.id.padEnd(24)} ${rec.journal} ${rec.year}  R:${v.randomized ? '+' : '−'} DB:${v.double_blind ? '+' : '−'}`);
  }
  await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(`\n${facts.length - failed}/${facts.length} прошли → ${path.relative(process.cwd(), OUT)}`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
