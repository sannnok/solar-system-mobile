/**
 * A match: two right arms locked in a grip across the table.
 *
 * The opponent is the same rig turned 180° about the vertical — not mirrored:
 * a mirror image of a right arm is a left arm. Both rigs are built in their
 * own (mirrored) rig space exactly as the visual ones are, so every number
 * here is in world space and both athletes share it.
 *
 * Statics, step by step:
 *  1. Dock. Each technique has a pose; both athletes' elbow and shoulder
 *     rotation are solved together (damped least squares) so the two grip
 *     points meet, staying as close to each technique as possible. A tiny
 *     shift of the opponent closes whatever is left. Closing your elbow drags
 *     the meeting point towards you — the hook.
 *  2. Effort. Each technique pushes the other hand: a force (pull towards
 *     yourself, up, to your pad…) and twists through the athlete's own joints
 *     (supinate, pronate, cup, rise), as a torque along the hand's actual
 *     rotation for that joint. Per newton of pull.
 *  3. Contest. Through the grip, what one hand feels is minus what the other
 *     does (Newton's third law). The contested wrench on my hand is
 *     W = (E_opp − E_me) / 2: where both pull against each other it is the
 *     full pull, where they twist the same way it cancels — two hooks turn the
 *     grip in the same direction, so nobody fights over supination.
 *  4. Capacity. Virtual work gives each joint's torque per newton of W. The
 *     largest W an athlete holds is limited by the first joint to reach its
 *     maximum (strength.js). The weaker athlete breaks there; the other's
 *     ratio is the margin.
 *
 * It explains a lock-up, it does not predict a match: grip geometry is a
 * parameter we have not calibrated, and the body, the start and fatigue are
 * not in it.
 */

import * as THREE from 'three';
import { Rig } from '../render/rig.js';
import { JOINTS, demandsFromTorques, handMotion, wrenchTorques } from './mechanics.js';
import { ACTION_MUSCLES, TYPICAL } from './strength.js';

export const PAD_DISTANCE = 3.2; // dm, elbow to elbow
const DEG = Math.PI / 180;
const G = 9.81;

/**
 * `pose` in degrees; `pull` in rig space (−z towards yourself, −x towards your
 * pad, +y up); `twist` in metres of torque per newton of pull, through the
 * athlete's own joints (+ pronation, flexion, radial deviation).
 */
export const TECHNIQUES = [
  {
    id: 'hook',
    label: 'Крюк',
    pose: { pron: -30, flex: 28, dev: 0, elbow: 8, ir: 6, grip: 0.95 },
    pull: [-0.45, -0.1, -1],
    twist: { pron: -0.025, flex: 0.02 },
  },
  {
    id: 'top',
    label: 'Верх',
    pose: { pron: 30, flex: 8, dev: 18, elbow: -6, ir: -6, grip: 0.95 },
    pull: [0.05, 0.6, -1],
    twist: { pron: 0.03, dev: 0.02, flex: 0.005 },
  },
  {
    id: 'side',
    label: 'Боковое',
    pose: { pron: -10, flex: 20, dev: 0, elbow: 0, ir: 12, grip: 0.95 },
    pull: [-1, -0.15, -0.25],
    twist: { flex: 0.015, pron: -0.01 },
  },
];

/** Where the opponent's hand bears on yours, hand-local. Height slides it along the hand. */
export const GRIPS = [
  { id: 'deep', label: 'Глубокий', at: [-0.16, 0.62, 0] },
  { id: 'medium', label: 'Средний', at: [-0.25, 0.8, 0] },
  { id: 'fingers', label: 'На пальцах', at: [-0.42, 1.0, 0] },
  // Strapped wrists: the hands still grip, but the load passes close to the wrists.
  { id: 'straps', label: 'Ремни', at: [-0.05, 0.25, 0] },
];

/** Whose hand sits higher. The higher hand bears near the other's fingertips: a long lever on his wrist. */
export const HEIGHTS = [
  { id: 'me', label: 'Ты', h: 1 },
  { id: 'even', label: 'Ровно', h: 0 },
  { id: 'opp', label: 'Соперник', h: -1 },
];
const HEIGHT_SHIFT = 0.15; // dm per step

export const PROFILES = [
  { id: 'same', label: 'Как ты' },
  { id: 'typical', label: 'Типичный' },
  { id: 'toproller', label: 'Верховик', scale: { radialDev: 1.6, pronation: 1.5, wristFlex: 1.3, wristExt: 1.2 } },
  { id: 'hooker', label: 'Крюковой', scale: { elbowFlex: 1.4, supination: 1.4, wristFlex: 1.3, shoulderIR: 1.4 } },
  { id: 'stronger', label: 'Сильнее на 30%', all: 1.3 },
];

export function profileCaps(id, mine) {
  const p = PROFILES.find((x) => x.id === id) ?? PROFILES[0];
  if (p.id === 'same') return { ...mine };
  if (p.all) return Object.fromEntries(Object.entries(mine).map(([k, v]) => [k, v * p.all]));
  const base = { ...TYPICAL };
  for (const [k, f] of Object.entries(p.scale ?? {})) base[k] *= f;
  return base;
}

const toRad = (pose) => Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, k === 'grip' ? v : v * DEG]));
const toDeg = (pose) => Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, k === 'grip' ? v : v / DEG]));

/** A probe rig placed the way main.js places the visual one. */
function place(opponent) {
  const rig = new Rig({ probe: true });
  const outer = new THREE.Group();
  const mirror = new THREE.Group();
  mirror.scale.x = -1;
  outer.add(mirror);
  mirror.add(rig.root);
  if (opponent) {
    outer.rotation.y = Math.PI;
    outer.position.set(0, 0, PAD_DISTANCE);
  }
  outer.updateMatrixWorld(true);
  return { rig, outer };
}

export class MatchSolver {
  constructor() {
    this.me = place(false);
    this.opp = place(true);
  }

  #grip(side, pose, at) {
    side.rig.update(pose);
    return side.rig.hand.localToWorld(at.clone());
  }

  /**
   * Make the grips meet: unknowns are both athletes' elbow and shoulder
   * rotation; residuals are the gap between the grip points (heavily
   * weighted) and each unknown's departure from its technique (lightly).
   * Levenberg–Marquardt with a finite-difference Jacobian — a few dozen rig
   * updates, done only when the settings change.
   */
  #dock(poseMe, poseOpp, atMe, atOpp) {
    const KEYS = [
      [poseMe, 'elbow'],
      [poseMe, 'ir'],
      [poseOpp, 'elbow'],
      [poseOpp, 'ir'],
    ];
    const target = KEYS.map(([p, k]) => p[k]);
    const GAP = 10; // weight of a decimetre of gap against a radian of departure
    const residual = (x) => {
      KEYS.forEach(([p, k], i) => (p[k] = x[i]));
      const gap = this.#grip(this.me, poseMe, atMe).sub(this.#grip(this.opp, poseOpp, atOpp));
      return [gap.x * GAP, gap.y * GAP, gap.z * GAP, ...x.map((v, i) => (v - target[i]) * 0.6)];
    };
    let x = [...target];
    let r = residual(x);
    let lambda = 1e-2;
    const norm = (v) => v.reduce((a, b) => a + b * b, 0);
    for (let iter = 0; iter < 30; iter++) {
      // Jacobian J (residuals × unknowns) by forward differences.
      const J = r.map(() => new Array(x.length).fill(0));
      x.forEach((_, j) => {
        const xp = [...x];
        xp[j] += 1e-4;
        const rp = residual(xp);
        rp.forEach((v, i) => (J[i][j] = (v - r[i]) / 1e-4));
      });
      // (JᵀJ + λI) δ = −Jᵀr, 4×4.
      const A = x.map((_, a) => x.map((_, b) => J.reduce((s, row) => s + row[a] * row[b], 0) + (a === b ? lambda : 0)));
      const g = x.map((_, a) => -J.reduce((s, row, i) => s + row[a] * r[i], 0));
      const delta = solve4(A, g);
      const next = x.map((v, i) => v + delta[i]);
      const rn = residual(next);
      if (norm(rn) < norm(r)) {
        x = next;
        r = rn;
        lambda *= 0.3;
        if (Math.hypot(...delta) < 1e-6) break;
      } else {
        lambda *= 10;
        residual(x); // restore the poses to the accepted point
      }
    }
    residual(x);
  }

  /** Effort wrench an athlete applies on the other's hand, per newton of pull. */
  #effort(side, pose, at, tech, motion) {
    const F = new THREE.Vector3(...tech.pull).normalize().transformDirection(side.rig.root.matrixWorld);
    const M = new THREE.Vector3();
    for (const [q, k] of Object.entries(tech.twist)) M.addScaledVector(motion[q].w.clone().normalize(), k);
    return { F, M };
  }

  solve({ me, opp, grip, height, capsMe, capsOpp }) {
    const techMe = TECHNIQUES.find((t) => t.id === me);
    const techOpp = TECHNIQUES.find((t) => t.id === opp);
    const g = GRIPS.find((x) => x.id === grip);
    const h = HEIGHTS.find((x) => x.id === height).h;
    const atMe = new THREE.Vector3(...g.at);
    const atOpp = new THREE.Vector3(...g.at);
    atMe.y -= HEIGHT_SHIFT * h;
    atOpp.y += HEIGHT_SHIFT * h;

    // 1. Dock: solve both arms so the grips meet, then close any rounding gap.
    this.opp.outer.position.set(0, 0, PAD_DISTANCE);
    this.opp.outer.updateMatrixWorld(true);
    const poseMe = toRad(techMe.pose);
    const poseOpp = toRad(techOpp.pose);
    this.#dock(poseMe, poseOpp, atMe, atOpp);
    const contact = this.#grip(this.me, poseMe, atMe);
    const mismatch = contact.clone().sub(this.#grip(this.opp, poseOpp, atOpp));
    this.opp.outer.position.add(mismatch);
    this.opp.outer.updateMatrixWorld(true);

    // 2–3. Efforts and the contested wrench on my hand.
    const motionMe = handMotion(this.me.rig, poseMe, atMe);
    const motionOpp = handMotion(this.opp.rig, poseOpp, atOpp);
    const eMe = this.#effort(this.me, poseMe, atMe, techMe, motionMe);
    const eOpp = this.#effort(this.opp, poseOpp, atOpp, techOpp, motionOpp);
    const W = {
      F: eOpp.F.clone().sub(eMe.F).multiplyScalar(0.5),
      M: eOpp.M.clone().sub(eMe.M).multiplyScalar(0.5),
    };

    // 4. Joint torques per newton, and how far each athlete can go.
    const perMe = wrenchTorques(motionMe, W.F, W.M);
    const perOpp = wrenchTorques(motionOpp, W.F.clone().negate(), W.M.clone().negate());
    const limit = (per, caps) => {
      const unit = demandsFromTorques(per, caps); // torques at 1 N
      return 1 / Math.max(unit[0].share, 1e-9); // newtons at which the first joint reaches 100%
    };
    const sMe = limit(perMe, capsMe);
    const sOpp = limit(perOpp, capsOpp);
    const s = Math.min(sMe, sOpp);
    const scale = (per) => Object.fromEntries(JOINTS.map((q) => [q, per[q] * s]));
    const margin = sMe / sOpp - 1;

    return {
      poses: { me: toDeg(poseMe), opp: toDeg(poseOpp), meRad: poseMe, oppRad: poseOpp },
      offset: this.opp.outer.position.clone(),
      mismatch: mismatch.length(),
      contact,
      efforts: { me: eMe, opp: eOpp },
      wrench: W,
      newtons: s,
      kg: s / G,
      sMe,
      sOpp,
      margin,
      winner: Math.abs(margin) < 0.03 ? 'even' : margin > 0 ? 'me' : 'opp',
      me: demandsFromTorques(scale(perMe), capsMe),
      opp: demandsFromTorques(scale(perOpp), capsOpp),
    };
  }
}

/** Gaussian elimination with partial pivoting for the small normal equations. */
function solve4(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n];
    for (let k = r + 1; k < n; k++) sum -= M[r][k] * x[k];
    x[r] = sum / M[r][r];
  }
  return x;
}

/**
 * Muscle effort from joint demands: each muscle works as hard as the hardest
 * action it carries needs, scaled by its leverage at the pose. The finger
 * flexors also hold the grip itself, which this model does not load.
 */
export function activationsFromDemands(demands, pose, leverage = {}) {
  const out = {};
  for (const d of demands) {
    for (const [id, role] of Object.entries(ACTION_MUSCLES[d.action.id])) {
      const gain = leverage[id] ? leverage[id](pose) : 1;
      out[id] = Math.max(out[id] ?? 0, Math.min(1, d.share) * role * gain);
    }
  }
  for (const id of ['fds', 'fdp']) out[id] = Math.max(out[id] ?? 0, 0.55);
  for (const [id, v] of Object.entries(out)) out[id] = Math.min(1, 0.05 + v);
  return out;
}
