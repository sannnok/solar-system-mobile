/**
 * Joint actions and their maximum isometric torques.
 *
 * `typical` is an order of magnitude for an untrained adult man, from the
 * general strength literature — enough to show which link limits, not a norm.
 * Armwrestlers are far stronger, which is why the panel lets each user enter
 * their own. `sign` is the direction of the joint coordinate it drives (see
 * exercises.js): + pronation, flexion, radial deviation, elbow flexion,
 * internal rotation.
 */

export const ACTIONS = [
  { id: 'elbowFlex', joint: 'elbow', sign: 1, name: 'Сгибание локтя', typical: 70 },
  { id: 'elbowExt', joint: 'elbow', sign: -1, name: 'Разгибание локтя', typical: 45 },
  { id: 'shoulderIR', joint: 'ir', sign: 1, name: 'Ротация плеча внутрь', typical: 50 },
  { id: 'shoulderER', joint: 'ir', sign: -1, name: 'Ротация плеча наружу', typical: 35 },
  { id: 'supination', joint: 'pron', sign: -1, name: 'Супинация', typical: 10 },
  { id: 'pronation', joint: 'pron', sign: 1, name: 'Пронация', typical: 9 },
  { id: 'wristFlex', joint: 'flex', sign: 1, name: 'Сгибание кисти (капинг)', typical: 12 },
  { id: 'wristExt', joint: 'flex', sign: -1, name: 'Разгибание кисти', typical: 8 },
  { id: 'radialDev', joint: 'dev', sign: 1, name: 'Подъём на лучевую', typical: 10 },
  { id: 'ulnarDev', joint: 'dev', sign: -1, name: 'Отведение к мизинцу', typical: 12 },
];

export const TYPICAL = Object.fromEntries(ACTIONS.map((a) => [a.id, a.typical]));
