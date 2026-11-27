/**
 * Physics lint for ArmLab exercises: does the cable resist the movement, and
 * does the athlete's force arrow push the way the arm moves?
 *
 * Method: virtual work. For every joint coordinate q (forearm rotation, wrist
 * flexion and deviation, elbow, shoulder rotation) the generalised force of a
 * unit force F applied at point P is Q = F · ∂P/∂q, with ∂P/∂q taken by finite
 * differences on the real rig. It needs no axes or sign conventions, so it
 * cannot be fooled by the mirrored rig or by a wrongly drawn arrow.
 *
 *   cable    Q·Δq < 0  — resists the motion, so the muscles that make it must work
 *   athlete  Q·Δq > 0  — the arrow drives the motion
 *
 * Only joints that move at least MIN_RANGE are checked this way; small
 * incidental drifts in a pose are not the exercise. A joint held still that the
 * cable loads hard gets a warning instead if the muscles holding it carry
 * little weight. Exits non-zero on failures, not on warnings.
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
const { EXERCISES, poseAt, RHYTHM } = await import('../armwrestling/src/data/exercises.js');

const JOINTS = { pron: 'ротация предплечья', flex: 'сгиб кисти', dev: 'отведение кисти', elbow: 'локоть', ir: 'ротация плеча' };
const MIN_RANGE = (8 * Math.PI) / 180;
const SAMPLES = [0.05, (RHYTHM.up + RHYTHM.top) / 2, (RHYTHM.top + RHYTHM.down) / 2]; // start, mid-lift, top
const EPS = 1e-3;
const TOLERANCE = 0.05; // per radian, unit force: below this the joint is simply not loaded

const rig = new Rig();
const at = (pose, point) => {
  rig.update(pose);
  return rig.hand.localToWorld(point.clone());
};
const generalised = (pose, q, point, dirAt) => {
  const dP = at({ ...pose, [q]: pose[q] + EPS }, point).sub(at({ ...pose, [q]: pose[q] - EPS }, point)).divideScalar(2 * EPS);
  return dirAt(pose).dot(dP);
};

/**
 * Who holds a joint against a pull in each direction. When the cable pulls a
 * joint that the exercise keeps still, the muscles on the other side must hold
 * it — so they should carry real weight in the exercise.
 */
const HOLDERS = {
  pron: { '+': ['supinator', 'biceps'], '-': ['pronatorTeres', 'pronatorQuadratus'] },
  flex: { '+': ['ecrl', 'ecrb', 'ecu', 'ed'], '-': ['fcu', 'fcr', 'fds'] },
  dev: { '+': ['fcu', 'ecu'], '-': ['ecrl', 'ecrb', 'fcr', 'apl'] },
  elbow: { '+': ['triceps'], '-': ['biceps', 'brachialis', 'brachioradialis'] },
  ir: { '+': null, '-': ['pec', 'lat', 'delt'] }, // external rotators are not modelled
};
const HOLD_LOAD = 0.5; // generalised force worth a stabiliser
const HOLD_WEIGHT = 0.3;

let failures = 0;
let warnings = 0;
for (const ex of EXERCISES) {
  const from = poseAt(ex, 0).rad;
  const to = poseAt(ex, RHYTHM.top).rad;
  const anchor = new THREE.Vector3(...ex.cable.anchor);
  const attach = HANDLE[ex.cable.attach];
  const linear = [].concat(ex.forces ?? ex.force).filter((f) => f.kind === 'linear');
  console.log(`\n${ex.title}`);

  for (const [q, name] of Object.entries(JOINTS)) {
    const delta = to[q] - from[q];
    if (Math.abs(delta) < MIN_RANGE) {
      // A joint held still: check the muscles holding it against the cable.
      const pull = SAMPLES.map((u) => {
        const pose = poseAt(ex, u).rad;
        return generalised(pose, q, attach, (p) => anchor.clone().sub(at(p, attach)).normalize());
      });
      const mean = pull.reduce((a, b) => a + b, 0) / pull.length;
      if (Math.abs(mean) < HOLD_LOAD) continue;
      const holders = HOLDERS[q][mean > 0 ? '+' : '-'];
      const best = holders ? Math.max(...holders.map((id) => ex.weights[id] ?? 0)) : null;
      if (best !== null && best >= HOLD_WEIGHT) continue;
      warnings++;
      const who = holders ? `${holders.join('/')} — максимум ${best}` : 'наружные ротаторы плеча, которых нет в модели';
      console.log(`  ! ${name.padEnd(18)} трос держит его с силой ${Math.abs(mean).toFixed(2)}, удерживают ${who}`);
      continue;
    }
    const dir = Math.sign(delta);
    const cable = SAMPLES.map((u) => {
      const pose = poseAt(ex, u).rad;
      return generalised(pose, q, attach, (p) => anchor.clone().sub(at(p, attach)).normalize());
    });
    const athlete = linear.map((f) =>
      SAMPLES.map((u) => {
        const pose = poseAt(ex, u).rad;
        return generalised(pose, q, HANDLE[f.at], (p) => {
          rig.update(p);
          return new THREE.Vector3(...f.dir).transformDirection((f.world ? rig.root : rig.hand).matrixWorld);
        });
      }),
    );

    const cableOk = cable.every((c) => c * dir < TOLERANCE);
    const athleteOk = athlete.every((list) => list.every((a) => a * dir > -TOLERANCE));
    if (!cableOk || !athleteOk) failures++;
    const fmt = (list) => list.map((v) => (v * dir).toFixed(2).padStart(6)).join('');
    console.log(
      `  ${cableOk ? '✓' : '✗'} ${name.padEnd(18)} трос ${fmt(cable)}${cableOk ? '' : '  ← помогает движению'}` +
        athlete.map((list) => `   ${athleteOk ? '✓' : '✗'} усилие ${fmt(list)}${athleteOk ? '' : '  ← против движения'}`).join(''),
    );
  }
}

console.log(failures ? `\n${failures} нарушений` : '\nВсе тросы сопротивляются движению, все векторы усилия ведут его.');
if (warnings) console.log(`${warnings} предупреждений: удерживающие мышцы недогружены относительно троса.`);
process.exit(failures ? 1 : 0);
