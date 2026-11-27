/**
 * Exercises are data, not code: two poses, a weight per muscle, the equipment
 * and the words. Adding one means adding an entry here.
 *
 * Pose angles are in degrees:
 *   pron   forearm rotation, + pronation (palm to the opponent), − supination
 *   flex   wrist, + flexion (cupping), − extension
 *   dev    wrist, + radial deviation (rising), − ulnar
 *   elbow  change in elbow flexion from the rest angle, + closes the elbow
 *   ir     shoulder internal rotation, + moves the hand towards the pad (side pressure)
 *   grip   0 open … 1 fist
 *
 * Every rep has the same rhythm: set-up, concentric, hold at the top, slow
 * eccentric, pause. `progress` and `effort` below encode it.
 */

const DEFAULT_POSE = { pron: 0, flex: 0, dev: 0, elbow: 0, ir: 0, grip: 0.95 };
const DEG = Math.PI / 180;

/** Phase boundaries shared by every exercise (fraction of the rep). */
export const RHYTHM = { up: 0.12, top: 0.42, down: 0.55, rest: 0.92 };

const smooth = (t) => t * t * (3 - 2 * t);
const span = (u, a, b) => Math.min(Math.max((u - a) / (b - a), 0), 1);

/** 0 at the start position, 1 at the top. */
export function progress(u) {
  if (u < RHYTHM.up) return 0;
  if (u < RHYTHM.top) return smooth(span(u, RHYTHM.up, RHYTHM.top));
  if (u < RHYTHM.down) return 1;
  if (u < RHYTHM.rest) return 1 - smooth(span(u, RHYTHM.down, RHYTHM.rest));
  return 0;
}

/** How hard the athlete is working, 0..1. The eccentric is not a rest. */
export function effort(u) {
  if (u < RHYTHM.up) return 0.3;
  if (u < RHYTHM.top) return 0.3 + 0.7 * smooth(span(u, RHYTHM.up, RHYTHM.top));
  if (u < RHYTHM.down) return 1;
  if (u < RHYTHM.rest) return 0.9 - 0.55 * span(u, RHYTHM.down, RHYTHM.rest);
  return 0.3;
}

/** Pose at rep fraction u, in degrees (for readouts) and radians (for the rig). */
export function poseAt(exercise, u, variant = 'technique') {
  const err = variant === 'error' ? exercise.error : null;
  const from = { ...DEFAULT_POSE, ...exercise.from, ...(err?.from ?? {}) };
  const to = { ...DEFAULT_POSE, ...exercise.from, ...exercise.to, ...(err?.to ?? {}) };
  const s = progress(u);
  const deg = {};
  for (const key of Object.keys(DEFAULT_POSE)) deg[key] = from[key] + (to[key] - from[key]) * s;
  const rad = { ...deg };
  for (const key of ['pron', 'flex', 'dev', 'elbow', 'ir']) rad[key] = deg[key] * DEG;
  return { deg, rad };
}

export function activationsAt(exercise, u) {
  const e = effort(u);
  const out = {};
  for (const [id, w] of Object.entries(exercise.weights)) out[id] = Math.min(1, 0.04 + w * e);
  return out;
}

export function phaseAt(exercise, u) {
  let index = 0;
  exercise.phases.forEach((phase, i) => {
    if (u >= phase.at) index = i;
  });
  return index;
}

const phases = (names) =>
  [0, RHYTHM.up, RHYTHM.top, RHYTHM.down, RHYTHM.rest].map((at, i) => ({ at, ...names[i] }));

const signed = (value, positive, negative) =>
  value >= 0 ? `${positive} ${Math.round(value)}°` : `${negative} ${Math.round(-value)}°`;

export const EXERCISES = [
  {
    id: 'rising',
    chip: 'Подъём',
    title: 'Подъём на лучевую',
    duration: 4.2,
    camera: 'side',
    from: { dev: -14, flex: 10, pron: 5 },
    to: { dev: 24, flex: 14, pron: 8 },
    readout: (p) => signed(p.dev, 'Подъём', 'Отведение к мизинцу'),
    weights: {
      ecrl: 1, ecrb: 0.9, fcr: 0.75, apl: 0.7, brachioradialis: 0.55, fds: 0.6, ed: 0.2, fcu: 0.15,
      ecu: 0.1, biceps: 0.25, brachialis: 0.3, pronatorTeres: 0.15, pronatorQuadratus: 0.1,
      supinator: 0.1, triceps: 0.1, delt: 0.1, deltMid: 0.08, pec: 0.1, lat: 0.08,
    },
    cable: { attach: 'ulnarEnd', anchor: [0.1, 0.5, 4.6] },
    force: { kind: 'linear', frame: 'hand', at: 'center', dir: [0, 0.25, -1] },
    phases: phases([
      { name: 'Старт', cue: 'Кисть отведена к мизинцу, трос уже натянут' },
      { name: 'Подъём', cue: 'Тяни большим пальцем вверх и на себя, кисть не разгибай' },
      { name: 'Пик', cue: 'Задержка на секунду. Локоть неподвижен' },
      { name: 'Негатив', cue: 'Опускай 2–3 секунды под контролем' },
      { name: 'Пауза', cue: 'Хват не расслабляй между повторами' },
    ]),
    error: {
      title: 'Разгибание вместо подъёма',
      text: 'Кисть уходит назад, тыльной стороной к предплечью, а локоть подтягивает руку. Лучевая сторона почти не работает — в схватке такая кисть «проваливается», и соперник забирает её в верх.',
      risk: 'Перегруз тыльной стороны запястья',
      to: { dev: 4, flex: -34, elbow: 10 },
    },
  },
  {
    id: 'pronation',
    chip: 'Пронация',
    title: 'Пронация',
    duration: 4.4,
    camera: 'opponent',
    from: { pron: -15, dev: 8, flex: 12 },
    to: { pron: 50, dev: 10, flex: 14 },
    readout: (p) => signed(p.pron, 'Пронация', 'Супинация'),
    weights: {
      pronatorTeres: 1, pronatorQuadratus: 0.9, fcr: 0.55, brachioradialis: 0.45, fds: 0.6, fcu: 0.4,
      ecrl: 0.45, ecrb: 0.3, apl: 0.25, biceps: 0.15, supinator: 0.08, brachialis: 0.4, triceps: 0.15,
      delt: 0.15, deltMid: 0.1, pec: 0.2, lat: 0.15, ed: 0.15, ecu: 0.15,
    },
    cable: { attach: 'radialEnd', anchor: [2.4, 3.4, -1.8] },
    force: { kind: 'arc', frame: 'forearm', at: [0.05, 1.75, 0.05], axis: [0, 1, 0], sign: 1, radius: 0.78 },
    phases: phases([
      { name: 'Старт', cue: 'Ладонь развёрнута к себе, ремень натянут' },
      { name: 'Вращение', cue: 'Крути предплечье, кисть держи подкрученной и на лучевой' },
      { name: 'Пик', cue: 'Ладонь смотрит на соперника. Задержка' },
      { name: 'Негатив', cue: 'Медленно возвращай, кисть не отдавай' },
      { name: 'Пауза', cue: 'Локоть остаётся на подушке' },
    ]),
    error: {
      title: 'Крутишь плечом, а не предплечьем',
      text: 'Рука заваливается внутрь за счёт плеча, а кисть теряет подъём. Пронаторы почти не включаются — в верхе такую руку раскрывают.',
      risk: 'Перегруз плеча и внутренней стороны локтя',
      to: { pron: 12, ir: 24, dev: -6, flex: 0 },
    },
  },
  {
    id: 'cupping',
    chip: 'Капинг',
    title: 'Кистевой сгиб (капинг)',
    duration: 4.0,
    camera: 'opponent',
    from: { flex: -22, dev: 4 },
    to: { flex: 52, dev: 6 },
    readout: (p) => signed(p.flex, 'Сгиб кисти', 'Разгибание'),
    weights: {
      fcu: 1, fcr: 0.9, fds: 0.95, pronatorTeres: 0.3, pronatorQuadratus: 0.2, brachioradialis: 0.25,
      ecrl: 0.15, ecrb: 0.15, ed: 0.12, ecu: 0.1, apl: 0.15, biceps: 0.3, brachialis: 0.35,
      supinator: 0.1, triceps: 0.1, delt: 0.1, deltMid: 0.08, pec: 0.1, lat: 0.1,
    },
    cable: { attach: 'center', anchor: [3.6, 2.2, 0.4] },
    force: { kind: 'arc', frame: 'distal', at: [0, 2.62, 0], axis: [0, 0, 1], sign: 1, radius: 0.85, start: 1.0 },
    phases: phases([
      { name: 'Старт', cue: 'Кисть слегка разогнута, рукоять глубоко в ладони' },
      { name: 'Сгиб', cue: 'Заворачивай кисть к предплечью всей ладонью' },
      { name: 'Пик', cue: 'Максимальный сгиб, пальцы зажаты' },
      { name: 'Негатив', cue: 'Медленно, рукоять не скатывается к пальцам' },
      { name: 'Пауза', cue: 'Держи натяжение троса' },
    ]),
    error: {
      title: 'Раскрываешь пальцы',
      text: 'Рукоять скатывается к кончикам пальцев: работает только хват, а сгибатели запястья недогружены. В схватке именно так соперник раскрывает кисть.',
      risk: 'Перегруз сухожилий сгибателей пальцев',
      to: { flex: 26, grip: 0.45 },
    },
  },
  {
    id: 'hook',
    chip: 'Крюк',
    title: 'Супинация (крюк)',
    duration: 4.4,
    camera: 'side',
    from: { pron: 10, flex: 18 },
    to: { pron: -40, flex: 30, elbow: 10 },
    readout: (p) => signed(-p.pron, 'Супинация', 'Пронация'),
    weights: {
      biceps: 1, supinator: 0.9, brachialis: 0.65, brachioradialis: 0.5, fcu: 0.6, fds: 0.7, fcr: 0.45,
      pronatorTeres: 0.1, pronatorQuadratus: 0.1, ecrl: 0.2, ecrb: 0.15, apl: 0.1, ed: 0.1, ecu: 0.15,
      triceps: 0.15, delt: 0.25, deltMid: 0.15, pec: 0.3, lat: 0.3,
    },
    cable: { attach: 'radialEnd', anchor: [-2.8, 3.4, -1.2] },
    force: { kind: 'arc', frame: 'forearm', at: [0.05, 1.75, 0.05], axis: [0, 1, 0], sign: -1, radius: 0.78 },
    phases: phases([
      { name: 'Старт', cue: 'Предплечье слегка пронировано, кисть подкручена' },
      { name: 'Супинация', cue: 'Крути ладонь к себе, локоть закрывай' },
      { name: 'Пик', cue: 'Кисть у себя, угол в локте острый' },
      { name: 'Негатив', cue: 'Медленно отдавай, кисть не разгибай' },
      { name: 'Пауза', cue: 'Капинг сохраняется всю амплитуду' },
    ]),
    error: {
      title: 'Крюк без капинга',
      text: 'Кисть разогнута: бицепс крутит, но запястье открыто — соперник легко выпрямляет его и уходит в верх.',
      risk: 'Перегруз сухожилия бицепса и связок запястья',
      to: { pron: -40, flex: -18, elbow: -6 },
    },
  },
  {
    id: 'side',
    chip: 'Боковое',
    title: 'Боковое давление',
    duration: 4.6,
    camera: 'opponent',
    cameraShift: [0.35, 0, 0], // the hand travels towards the pad, screen-right here
    from: { ir: -4, flex: 22, pron: -10 },
    to: { ir: 17, flex: 26, pron: -12 },
    readout: (p) => signed(p.ir, 'Ротация плеча внутрь', 'Наружу'),
    weights: {
      pec: 1, delt: 0.8, lat: 0.6, biceps: 0.6, brachialis: 0.6, triceps: 0.3, deltMid: 0.3, fcu: 0.5,
      fds: 0.65, fcr: 0.35, pronatorTeres: 0.45, brachioradialis: 0.45, supinator: 0.2,
      pronatorQuadratus: 0.2, ecrl: 0.2, ecrb: 0.15, apl: 0.1, ed: 0.1, ecu: 0.15,
    },
    cable: { attach: 'center', anchor: [3.8, 3.2, 0.2] },
    force: { kind: 'linear', frame: 'hand', at: 'center', dir: [-1, 0, 0.1], world: true },
    phases: phases([
      { name: 'Старт', cue: 'Рука вертикально, плечо за рукой' },
      { name: 'Давление', cue: 'Дави в сторону, вращая плечо внутрь. Корпус за рукой' },
      { name: 'Пик', cue: 'Держи положение, кисть подкручена' },
      { name: 'Возврат', cue: 'Медленно, угол в локте не теряй' },
      { name: 'Пауза', cue: 'Смотри на свою руку' },
    ]),
    error: {
      title: 'Опасная позиция',
      text: 'Рука ушла наружу, а ты продолжаешь давить, развернув корпус и отвернувшись от руки. На плечевую кость приходится скручивающий момент — классический механизм спирального перелома.',
      risk: 'Риск перелома плечевой кости. Плечо держи за рукой и смотри на свою руку',
      danger: true,
      to: { ir: -30, flex: 8, pron: -5 },
    },
  },
];
