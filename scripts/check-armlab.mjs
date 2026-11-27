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

console.log(failures ? `\n${failures} нарушений` : '\nВсе сопротивления мешают движению, все векторы усилия ведут его.');
console.log(warnings ? `${warnings} предупреждений: удерживающие мышцы недогружены.` : 'Удерживающие мышцы нагружены везде, где их нагружает сопротивление.');
process.exit(failures ? 1 : 0);
