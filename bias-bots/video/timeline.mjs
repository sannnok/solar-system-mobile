// Раскадровка динамичного ролика — общий код для Node (сколько кадров рендерить)
// и для Remotion (когда какая сцена). Сцены идут встык с нахлёстом OVERLAP кадров,
// в нахлёсте играет переход. Длительность сцены — по объёму текста; если есть
// озвучка, всё растягивается/сжимается под её длину.

export const FPS = 30;
export const OVERLAP = 9;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function buildTimeline({ hook, summary, example, tip }, { audioDuration = null } = {}) {
  const sec = {
    hook: clamp(1.3 + hook.length / 24, 2.2, 3.4),
    term: 3.0,
    what: clamp(1.0 + summary.length / 17, 2.6, 4.8),
    example: clamp(1.0 + (example ?? '').length / 17, 2.6, 4.8),
    tip: clamp(1.0 + (tip ?? '').length / 17, 2.6, 4.8),
    cta: 3.8,
  };
  if (!example) delete sec.example;
  if (!tip) delete sec.tip;
  if (audioDuration) {
    const overlapSec = (OVERLAP / FPS) * (Object.keys(sec).length - 1);
    // итоговая длина = сумма сцен − нахлёсты; она должна быть «озвучка + 1 с»
    const sum = Object.values(sec).reduce((a, b) => a + b, 0);
    const k = (audioDuration + 1.0 + overlapSec) / sum;
    for (const key of Object.keys(sec)) sec[key] = Math.max(1.6, sec[key] * k);
  }
  const scenes = [];
  let from = 0;
  for (const [id, s] of Object.entries(sec)) {
    const dur = Math.round(s * FPS);
    scenes.push({ id, from, dur });
    from += dur - OVERLAP;
  }
  const last = scenes.at(-1);
  return { fps: FPS, scenes, total: last.from + last.dur };
}

// Подсветка маркером: последние 2–3 слова фразы (обычно в них суть)
export function defaultHighlight(text, words = 3) {
  const parts = text.replace(/[.!?…]+$/, '').split(/\s+/);
  return parts.slice(-Math.min(words, Math.max(1, parts.length - 2))).join(' ');
}
