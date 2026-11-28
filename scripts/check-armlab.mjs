/**
 * Physics lint for ArmLab exercises: does the resistance oppose the movement,
 * does the athlete's force arrow drive it, and do the muscles that must hold
 * still joints carry weight?
 *
 * Method: virtual work (armwrestling/src/data/mechanics.js). For every joint
 * coordinate q — forearm rotation, wrist flexion and deviation, elbow,
 * shoulder rotation — the generalised force of a unit force F at point P is
 * Q = F · ∂P/∂q, with ∂P/∂q taken by finite differences on the real rig. No
 * axes or sign conventions are involved, so the mirrored rig or a wrongly
 * drawn arrow cannot fool it.
 *
 *   moving joint (≥ 8°)   resistance Q·Δq < 0, athlete's arrow Q·Δq > 0 — else a failure
 *   still joint           if the resistance loads it hard, the muscles holding
 *                         it against that pull must carry weight — else a warning
 *
 * Every resistance variant of every exercise is checked with its own weights.
 * Exits non-zero on failures, not on warnings.
 *
 *   npm run check:armlab
 */

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve the bare 'three' import the way the page's import map does.
const three = pathToFileURL(fileURLToPath(new URL('../vendor/three/three.module.min.js', import.meta.url))).href;
register(
  `data:text/javascript,${encodeURIComponent(
    `export async function resolve(s, c, next) { return s === 'three' ? { url: ${JSON.stringify(three)}, shortCircuit: true } : next(s, c); }`,
  )}`,
);

const THREE = await import('three');
const { Rig, HANDLE } = await import('../armwrestling/src/render/rig.js');
const { EXERCISES, poseAt, RHYTHM, weightsOf } = await import('../armwrestling/src/data/exercises.js');
const { resistanceLoads, virtualWork } = await import('../armwrestling/src/data/mechanics.js');

const JOINTS = { pron: 'ротация предплечья', flex: 'сгиб кисти', dev: 'отведение кисти', elbow: 'локоть', ir: 'ротация плеча' };
const MIN_RANGE = (8 * Math.PI) / 180;
const SAMPLES = [0.05, (RHYTHM.up + RHYTHM.top) / 2, (RHYTHM.top + RHYTHM.down) / 2]; // start, mid-lift, top
const TOLERANCE = 0.05; // per radian, unit force: below this the joint is simply not loaded

/** Who holds a joint against a pull in each direction (+ means pulled towards +q). */
const HOLDERS = {
  pron: { '+': ['supinator', 'biceps'], '-': ['pronatorTeres', 'pronatorQuadratus'] },
  flex: { '+': ['ecrl', 'ecrb', 'ecu', 'ed'], '-': ['fcu', 'fcr', 'fds', 'fdp'] },
  dev: { '+': ['fcu', 'ecu'], '-': ['ecrl', 'ecrb', 'fcr', 'apl'] },
  elbow: { '+': ['triceps'], '-': ['biceps', 'brachialis', 'brachioradialis'] },
  ir: { '+': ['infraspinatus'], '-': ['pec', 'lat', 'delt', 'teresMajor', 'subscapularis'] },
};
const HOLD_LOAD = 0.5;
const HOLD_WEIGHT = 0.3;

const rig = new Rig({ probe: true });
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
const fmt = (list, dir) => list.map((v) => (v * dir).toFixed(2).padStart(6)).join('');

let failures = 0;
let warnings = 0;
for (const ex of EXERCISES) {
  const from = poseAt(ex, 0).rad;
  const to = poseAt(ex, RHYTHM.top).rad;
  const arrows = [].concat(ex.forces ?? ex.force).filter((f) => f.kind === 'linear');

  for (const variant of ex.variants) {
    const weights = weightsOf(ex, variant);
    console.log(`\n${ex.title}${ex.variants.length > 1 ? ` — ${variant.label}` : ''}`);
    const loads = SAMPLES.map((u) => resistanceLoads(rig, poseAt(ex, u).rad, variant.resist));
    const athlete = arrows.map((f) =>
      SAMPLES.map((u) => {
        const pose = poseAt(ex, u).rad;
        rig.update(pose);
        const dir = new THREE.Vector3(...f.dir).transformDirection((f.world ? rig.root : rig.hand).matrixWorld);
        return virtualWork(rig, pose, HANDLE[f.at], dir);
      }),
    );

    for (const [q, name] of Object.entries(JOINTS)) {
      const pull = loads.map((Q) => Q[q]);
      const delta = to[q] - from[q];

      if (Math.abs(delta) < MIN_RANGE) {
        const m = mean(pull);
        if (Math.abs(m) < HOLD_LOAD) continue;
        const holders = HOLDERS[q][m > 0 ? '+' : '-'];
        const best = Math.max(...holders.map((id) => weights[id] ?? 0));
        if (best >= HOLD_WEIGHT) continue;
        warnings++;
        console.log(`  ! ${name.padEnd(18)} держится против ${Math.abs(m).toFixed(2)}, а ${holders.join('/')} — максимум ${best}`);
        continue;
      }

      const dir = Math.sign(delta);
      const resistOk = pull.every((c) => c * dir < TOLERANCE);
      const arrowRows = athlete.map((rows) => rows.map((Q) => Q[q]));
      const arrowOk = arrowRows.every((list) => list.every((a) => a * dir > -TOLERANCE));
      if (!resistOk || !arrowOk) failures++;
      console.log(
        `  ${resistOk ? '✓' : '✗'} ${name.padEnd(18)} сопротивление ${fmt(pull, dir)}${resistOk ? '' : '  ← помогает движению'}` +
          arrowRows.map((list) => `   ${arrowOk ? '✓' : '✗'} усилие ${fmt(list, dir)}${arrowOk ? '' : '  ← против движения'}`).join(''),
      );
    }
  }
}

// ── the match: invariants of the two-arm statics (armwrestling/src/data/match.js) ──
const { MatchSolver, TECHNIQUES, DEFAULT_GRIP, naturalRotation } = await import('../armwrestling/src/data/match.js');
const { TYPICAL } = await import('../armwrestling/src/data/strength.js');
const solver = new MatchSolver();
// A trained arm: wrists, forearm and elbow two to two and a half times typical, a 55 kg grip.
const STRONG = {
  ...TYPICAL,
  wristFlex: 30,
  wristExt: 20,
  radialDev: 25,
  ulnarDev: 25,
  pronation: 20,
  supination: 22,
  elbowFlex: 120,
  elbowExt: 80,
  shoulderIR: 100,
  shoulderER: 60,
  grip: 55,
};
const match = (me, opp, grip = {}, caps = TYPICAL) =>
  solver.solve({ me, opp, grip: { ...DEFAULT_GRIP, rotation: naturalRotation(me, opp), ...grip }, capsMe: caps, capsOpp: caps });
const expect = (ok, text, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${text}${detail ? ` — ${detail}` : ''}`);
};
const pct = (x) => `${Math.round(x * 100)}%`;
const share = (list, joint) => list.find((d) => d.joint === joint)?.share ?? 0;
console.log('\nСхватка');
for (const t of TECHNIQUES) {
  const worst = Math.max(...[0.1, 0.5, 0.9].map((depth) => Math.abs(match(t.id, t.id, { depth }).margin)));
  expect(worst < 0.02, `${t.label}, зеркальная схватка — ничья при любой глубине`, `перевес до ${(worst * 100).toFixed(1)}%`);
}
for (const a of TECHNIQUES) {
  for (const b of TECHNIQUES) {
    if (a.id >= b.id) continue;
    const ab = match(a.id, b.id, { height: 1 });
    const ba = match(b.id, a.id, { height: -1 });
    expect(Math.abs((1 + ab.margin) * (1 + ba.margin) - 1) < 0.02, `${a.label} / ${b.label}: исход симметричен при обмене сторонами`);
    expect(
      ab.mismatch < 0.05 && ab.facing > 0.99,
      `${a.label} / ${b.label}: замок сходится`,
      `зазор ${(ab.mismatch * 10).toFixed(2)} см, ладони напротив на ${(ab.facing * 100).toFixed(1)}%`,
    );
  }
}
const hh = share(match('hook', 'hook').me, 'pron');
const ht = share(match('hook', 'top').me, 'pron');
// Two hooks twist the same way, so their supination mostly cancels; what is left comes from
// the forearms leaning towards each other, so the two rotation axes are not quite parallel.
expect(hh < 0.15 && ht > 2 * hh, 'Крюк против крюка за вращение почти не борются, крюк против верха — борются', `ротация предплечья ${pct(hh)} против ${pct(ht)}`);
const high = match('top', 'top', { height: 1.5 }).margin;
const low = match('top', 'top', { height: -1.5 }).margin;
expect(high > 0.1 && low < -0.1, 'Чья кисть выше, тот в выигрыше', `выше ты ${pct(high)}, выше соперник ${pct(low)}`);
const shallow = match('top', 'top', { depth: 0.1, height: 2 }, STRONG);
const deep = match('top', 'top', { depth: 0.9, height: 2 }, STRONG);
expect(
  shallow.opp[0].joint === 'grip',
  'Мелкий хват, сильные руки: у нижней кисти раскрывается хват',
  `первым сдаётся «${shallow.opp[0].action.name.toLowerCase()}»`,
);
expect(
  share(deep.opp, 'grip') < share(shallow.opp, 'grip') && deep.opp[0].joint !== 'grip',
  'Глубокий хват держит пальцы нижней кисти',
  `хват ${pct(share(shallow.opp, 'grip'))} на мелком → ${pct(share(deep.opp, 'grip'))} на глубоком`,
);
const strapped = match('top', 'top', { depth: 0.1, height: 2, straps: true }, STRONG);
expect(!strapped.opp.some((d) => d.joint === 'grip'), 'Ремни снимают нагрузку с пальцев');
let worstGap = 0;
for (const a of TECHNIQUES) {
  for (const b of TECHNIQUES) {
    const r = match(a.id, b.id);
    const { frames } = solver.breakdown(r);
    const last = frames.at(-1);
    solver.me.rig.update(last.me);
    const pa = solver.me.rig.hand.localToWorld(r.at.me.clone());
    solver.opp.rig.update(last.opp);
    worstGap = Math.max(worstGap, pa.distanceTo(solver.opp.rig.hand.localToWorld(r.at.opp.clone())));
  }
}
expect(worstGap < 0.1, 'Срыв: руки остаются в замке, пока ломается сустав', `зазор до ${(worstGap * 10).toFixed(1)} см`);
const slip = solver.breakdown(shallow);
solver.me.rig.update(slip.frames.at(-1).me);
const out = solver.me.rig.hand.localToWorld(shallow.at.me.clone()).distanceTo(shallow.contact);
expect(slip.link.joint === 'grip' && out > 0.5, 'Срыв хвата: кисть победителя выходит из захвата', `на ${(out * 10).toFixed(0)} см`);

console.log(failures ? `\n${failures} нарушений` : '\nВсе сопротивления мешают движению, все векторы усилия ведут его.');
console.log(warnings ? `${warnings} предупреждений: удерживающие мышцы недогружены.` : 'Удерживающие мышцы нагружены везде, где их нагружает сопротивление.');
process.exit(failures ? 1 : 0);
