// Единая точка доступа к контенту кодекса: data/biases.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const raw = JSON.parse(readFileSync(path.join(ROOT, 'data', 'biases.json'), 'utf8'));

// Акценты для карточек: оттенки цветов квадрантов кодекса, но ярче —
// серый квадрант «памяти» на тёмном фоне смотрится мёртвым, берём лавандовый.
const ACCENTS = { q1: '#2dd4bf', q2: '#60a5fa', q3: '#a3e635', q4: '#c4b5fd' };

export const attribution = raw.attribution;
export const quadrants = raw.quadrants.map((q) => ({ ...q, accent: ACCENTS[q.id] ?? '#ffffff' }));
export const groups = raw.groups;
export const biases = raw.biases;

const byId = new Map(biases.map((b) => [b.id, b]));
const byN = new Map(biases.map((b) => [b.n, b]));
const quadrantById = new Map(quadrants.map((q) => [q.id, q]));
const groupById = new Map(groups.map((g) => [g.id, g]));

export const getBias = (id) => byId.get(id) ?? byN.get(Number(id)) ?? null;
export const getQuadrant = (id) => quadrantById.get(id) ?? null;
export const getGroup = (id) => groupById.get(id) ?? null;
export const groupsOf = (quadrantId) => groups.filter((g) => g.quadrant === quadrantId);
export const biasesOf = (groupId) => biases.filter((b) => b.group === groupId || b.also_groups?.includes(groupId));

// Детерминированный «случайный» порядок: искажение дня одно и то же для всех
// в один день и не повторяется 187 дней подряд.
function shuffled(seed) {
  const order = biases.map((b) => b.id);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
const DAILY_ORDER = shuffled(20261125);
const EPOCH = Date.UTC(2026, 0, 1);

export function dayIndex(date = new Date(), tzOffsetMinutes = 180) {
  const local = date.getTime() + tzOffsetMinutes * 60_000;
  return Math.floor((local - EPOCH) / 86_400_000);
}

export function biasOfDay(date = new Date(), tzOffsetMinutes = 180) {
  const i = ((dayIndex(date, tzOffsetMinutes) % DAILY_ORDER.length) + DAILY_ORDER.length) % DAILY_ORDER.length;
  return byId.get(DAILY_ORDER[i]);
}

export function randomBias(exclude = []) {
  const pool = biases.filter((b) => !exclude.includes(b.id));
  return pool[Math.floor(Math.random() * pool.length)] ?? biases[0];
}

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();

export function search(query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const scored = [];
  for (const b of biases) {
    const hay = [b.name_ru, b.name_en, b.summary_ru].map(norm);
    let score = 0;
    if (hay[0] === q || hay[1] === q) score = 100;
    else if (hay[0].startsWith(q) || hay[1].startsWith(q)) score = 50;
    else if (hay[0].includes(q) || hay[1].includes(q)) score = 30;
    else if (q.split(' ').every((w) => w.length > 2 && hay.some((h) => h.includes(w)))) score = 10;
    // грубый «стемминг»: «якорь» найдёт «эффект якоря», «выживший» — «ошибку выжившего»
    else if (q.split(' ').every((w) => w.length > 3 && hay.slice(0, 2).some((h) => h.includes(w.slice(0, Math.max(4, w.length - 2)))))) score = 8;
    if (score) scored.push([score, b]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, b]) => b);
}

// «Двойники» — синонимы и почти одинаковые искажения: в одном вопросе квиза
// их не смешиваем, а синонимы-псевдонимы (второй в группе) не загадываем вовсе.
const TWINS = [
  ['frequency-illusion', 'baader-meinhof-phenomenon'],
  ['forer-effect', 'barnum-effect', 'subjective-validation'],
  ['bike-shedding-effect', 'law-of-triviality'],
  ['sunk-cost-fallacy', 'irrational-escalation', 'escalation-of-commitment'],
  ['risk-compensation', 'peltzman-effect'],
  ['choice-supportive-bias', 'post-purchase-rationalization'],
  ['observer-expectancy-effect', 'experimenters-bias', 'expectation-bias', 'observer-effect'],
  ['serial-position-effect', 'primacy-effect', 'recency-effect'],
  ['misattribution-of-memory', 'source-confusion', 'cryptomnesia'],
  ['implicit-stereotypes', 'implicit-association', 'stereotypical-bias', 'stereotyping', 'prejudice'],
  ['reactance', 'reverse-psychology'],
  ['illusory-superiority', 'lake-wobegone-effect', 'overconfidence-effect'],
  ['fundamental-attribution-error', 'actor-observer-bias'],
  ['group-attribution-error', 'ultimate-attribution-error'],
  ['confirmation-bias', 'congruence-bias', 'selective-perception', 'continued-influence-effect', 'backfire-effect'],
];
const twinsOf = new Map();
for (const g of TWINS) for (const id of g) twinsOf.set(id, new Set(g));
const ALIASES = new Set(TWINS.flatMap((g) => g.slice(1)).filter((id) => ['baader-meinhof-phenomenon', 'barnum-effect', 'law-of-triviality', 'escalation-of-commitment', 'peltzman-effect', 'post-purchase-rationalization'].includes(id)));
const QUIZ_POOL = biases.filter((b) => !ALIASES.has(b.id) && b.example_ru);

// Вопрос викторины: пример из жизни → угадать искажение из 4 вариантов.
// Неверные варианты — из того же квадранта, чтобы было не слишком просто.
export function quizQuestion(rand = Math.random) {
  const answer = QUIZ_POOL[Math.floor(rand() * QUIZ_POOL.length)];
  const twins = twinsOf.get(answer.id) ?? new Set([answer.id]);
  const pool = QUIZ_POOL.filter((b) => !twins.has(b.id) && b.id !== answer.id);
  const same = pool.filter((b) => b.quadrant === answer.quadrant);
  const options = [answer];
  for (const source of [same, pool]) {
    const left = [...source];
    while (options.length < 4 && left.length) {
      const [pick] = left.splice(Math.floor(rand() * left.length), 1);
      const pickTwins = twinsOf.get(pick.id);
      if (!options.some((o) => o.id === pick.id || pickTwins?.has(o.id))) options.push(pick);
    }
  }
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { answer, options };
}
