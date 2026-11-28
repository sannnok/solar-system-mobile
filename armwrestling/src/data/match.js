/**
 * A match: two right arms locked in a grip across the table.
 *
 * The opponent is the same rig turned 180° about the vertical — not mirrored:
 * a mirror image of a right arm is a left arm. Both rigs are built in their
 * own (mirrored) rig space exactly as the visual ones are, so every number
 * here is in world space and both athletes share it.
 *
 * Statics, step by step:
 *  1. Lock. The grip is a lock, not a point: the two grip points meet and the
 *     palms face each other. All ten joints of both arms are solved together
 *     (damped least squares), each staying as close to its technique as it
 *     can. Two different techniques therefore meet halfway — a hooker and a
 *     toproller cannot both keep their own wrist rotation in one grip.
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
 *     fingers are a link too: they hold whatever pulls the palms apart, slides
 *     the other hand out past the fingertips, or peels the grip open with a
 *     twist — and how much of the athlete's grip strength they can use depends
 *     on where the other hand sits in them. The largest W an athlete holds is
 *     limited by the first link to reach its maximum (strength.js). The weaker
 *     athlete breaks there; the other's ratio is the margin.
 *
 * It explains a lock-up, it does not predict a match: grip geometry and the
 * finger model are estimates we have not calibrated, and the body, the start
 * and fatigue are not in it.
 */

import * as THREE from 'three';
import { Rig } from '../render/rig.js';
import { JOINTS, demandsFromTorques, handMotion, wrenchTorques } from './mechanics.js';
import { ACTIONS, ACTION_MUSCLES, TYPICAL } from './strength.js';

export const PAD_DISTANCE = 3.2; // dm, elbow to elbow
const DEG = Math.PI / 180;
const G = 9.81;
const GRIP_ACTION = ACTIONS.find((a) => a.id === 'grip');

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

/**
 * The grip, as the athletes set it and fight for it.
 *   depth     0 = on the fingers … 1 = deep, palm in palm. The referee sets it.
 *   height    cm, + = your hand sits higher: you bear near his fingertips,
 *             a long lever on his wrist, and he holds you with his fingertips.
 *   rotation  where the locked hands are turned, as the mean rotation of the
 *             two forearms in degrees: − towards the hook (supination), + over
 *             the top (pronation). Two right forearms stand nearly upright and
 *             turn the same way about the vertical, so a locked grip has one
 *             rotation, not two — whoever wins it turns both. `null` lets the
 *             techniques settle it between them.
 *   straps    wrists strapped: the strap, not the fingers, holds the hands
 *             together, and the load passes near the wrists.
 */
export const DEFAULT_GRIP = { depth: 0.5, height: 0, rotation: null, straps: false };
export const GRIP_PARAMS = [
  { key: 'depth', label: 'Глубина', min: 0, max: 1, step: 0.05 },
  { key: 'height', label: 'Высота кисти', min: -3, max: 3, step: 0.25 },
  { key: 'rotation', label: 'Поворот замка', min: -40, max: 40, step: 2 },
];

// Along the hand (hand-local y, wrist at 0, knuckles at 1.0) and off the palm (x, palm side −).
const PROFILE = [
  [0.25, -0.05],
  [0.62, -0.16], // heel of the palm: deep
  [0.8, -0.25], // middle of the palm
  [1.0, -0.42], // the knuckle line: on the fingers
  [1.15, -0.5], // fingertips
];
// Share of full grip strength the fingers can use, by where the other hand sits in them:
// wrapped all round it like a dynamometer handle, down to a fingertip pinch.
const HOLD = [
  [0.62, 1],
  [0.8, 0.8],
  [1.0, 0.5],
  [1.15, 0.3],
];
// Width of the contact (m) that a twist must be resisted across: a full palm or a strip of fingers.
const PATCH = [
  [0.62, 0.075],
  [1.0, 0.04],
  [1.15, 0.03],
];
const DEPTH_Y = [1.0, 0.62]; // depth 0 → 1
const STRAP_Y = 0.42;
const Y_RANGE = [0.25, 1.15];

const table = (rows, y) => {
  if (y <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) {
    if (y <= rows[i][0]) {
      const [y0, v0] = rows[i - 1];
      const [y1, v1] = rows[i];
      return v0 + ((v1 - v0) * (y - y0)) / (y1 - y0);
    }
  }
  return rows[rows.length - 1][1];
};

/** Hand-local points where each athlete bears on the other's hand. */
export function gripPoints(grip) {
  const base = grip.straps ? STRAP_Y : DEPTH_Y[0] + (DEPTH_Y[1] - DEPTH_Y[0]) * grip.depth;
  const shift = 0.1 * grip.height; // cm → dm
  const clamp = (y) => THREE.MathUtils.clamp(y, Y_RANGE[0], Y_RANGE[1]);
  const yMe = clamp(base - shift);
  const yOpp = clamp(base + shift);
  return {
    me: new THREE.Vector3(table(PROFILE, yMe), yMe, 0),
    opp: new THREE.Vector3(table(PROFILE, yOpp), yOpp, 0),
  };
}

/** Where the lock turns when nobody wins the rotation: halfway between the two techniques. */
export function naturalRotation(me, opp) {
  const a = TECHNIQUES.find((t) => t.id === me).pose.pron;
  const b = TECHNIQUES.find((t) => t.id === opp).pose.pron;
  return Math.round((a + b) / 2);
}

export const PROFILES = [
  { id: 'same', label: 'Как ты' },
  { id: 'typical', label: 'Типичный' },
  { id: 'toproller', label: 'Верховик', scale: { radialDev: 1.6, pronation: 1.5, wristFlex: 1.3, wristExt: 1.2, grip: 1.3 } },
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

/** How stiffly each technique keeps its own joint angles while the arms settle into one grip. */
const STIFF = { pron: 0.5, flex: 0.8, dev: 0.8, elbow: 0.6, ir: 0.6 };
const GAP = 10; // weight of a decimetre of gap against a radian of departure
const FACE = 6; // weight of the palms not facing each other
const TURN = 8; // weight of a radian off the set rotation of the lock
const GOAL = 3; // weight of a decimetre between the lock and where the winner drives it
const PALM = new THREE.Vector3(-1, 0, 0); // hand-local, out of the palm
const ALONG = new THREE.Vector3(0, 1, 0); // hand-local, wrist to fingers

/** How far a link gives way in the break animation, radians. */
const YIELD = { pron: 45 * DEG, flex: 50 * DEG, dev: 35 * DEG, elbow: 40 * DEG, ir: 70 * DEG };
const DRIVE = 2.2; // dm the winner drives the lock through the break
// The winner drives with the arm and keeps his wrist: elbow and shoulder give, the hand does not.
const DRIVING = { pron: 1.5, flex: 1.5, dev: 1.5, elbow: 0.25, ir: 0.25 };

/**
 * Damped least squares (Levenberg–Marquardt) with a finite-difference
 * Jacobian. `residual(x)` must leave the rigs posed at x.
 */
function leastSquares(x0, residual, iterations = 40) {
  let x = [...x0];
  let r = residual(x);
  let lambda = 1e-2;
  const norm = (v) => v.reduce((a, b) => a + b * b, 0);
  for (let iter = 0; iter < iterations; iter++) {
    const J = r.map(() => new Array(x.length).fill(0));
    x.forEach((_, j) => {
      const xp = [...x];
      xp[j] += 1e-4;
      const rp = residual(xp);
      rp.forEach((v, i) => (J[i][j] = (v - r[i]) / 1e-4));
    });
    const A = x.map((_, a) => x.map((_, b) => J.reduce((s, row) => s + row[a] * row[b], 0) + (a === b ? lambda : 0)));
    const g = x.map((_, a) => -J.reduce((s, row, i) => s + row[a] * r[i], 0));
    const delta = solveLinear(A, g);
    const next = x.map((v, i) => v + delta[i]);
    const rn = residual(next);
    if (norm(rn) < norm(r)) {
      x = next;
      r = rn;
      lambda *= 0.3;
      if (Math.hypot(...delta) < 1e-6) break;
    } else {
      lambda *= 10;
      if (lambda > 1e8) break;
    }
  }
  residual(x); // leave the rigs at the accepted point
  return x;
}

export class MatchSolver {
  constructor() {
    this.me = place(false);
    this.opp = place(true);
  }

  #point(side, pose, at) {
    side.rig.update(pose);
    return side.rig.hand.localToWorld(at.clone());
  }

  #palm(side) {
    return PALM.clone().transformDirection(side.rig.hand.matrixWorld);
  }

  /**
   * Bring the hands into one lock: grip points together, palms facing.
   * `free` lists the [pose, key] pairs that may move; each is pulled back
   * towards `target` (same pose shape) with its technique's stiffness.
   */
  #lock(poseMe, poseOpp, atMe, atOpp, free, target, { face = true, rotation = null, goal = null, stiff = () => 1, hold = GAP } = {}) {
    const residual = (x) => {
      free.forEach(([p, k], i) => (p[k] = x[i]));
      const a = this.#point(this.me, poseMe, atMe);
      const nMe = this.#palm(this.me);
      const b = this.#point(this.opp, poseOpp, atOpp);
      const nOpp = this.#palm(this.opp);
      const out = [];
      if (goal) {
        const off = a.clone().sub(goal);
        out.push(off.x * GOAL, off.y * GOAL, off.z * GOAL);
      }
      const gap = a.sub(b);
      out.push(gap.x * hold, gap.y * hold, gap.z * hold);
      if (face) {
        const n = nMe.add(nOpp);
        out.push(n.x * FACE, n.y * FACE, n.z * FACE);
      }
      if (rotation !== null) out.push(((poseMe.pron + poseOpp.pron) / 2 - rotation) * TURN);
      free.forEach(([p, k], i) => out.push((x[i] - target(p)[k]) * STIFF[k] * stiff(p, k)));
      return out;
    };
    leastSquares(
      free.map(([p, k]) => p[k]),
      residual,
    );
  }

  /** Effort wrench an athlete applies on the other's hand, per newton of pull. */
  #effort(side, tech, motion) {
    const F = new THREE.Vector3(...tech.pull).normalize().transformDirection(side.rig.root.matrixWorld);
    const M = new THREE.Vector3();
    for (const [q, k] of Object.entries(tech.twist)) M.addScaledVector(motion[q].w.clone().normalize(), k);
    return { F, M };
  }

  /**
   * What the fingers carry per newton of contest, and what they can carry.
   * The palms can only push; whatever pulls them apart, slides the other hand
   * out past the fingertips or peels the grip open is held by fingers. Both
   * athletes' fingers share the separation and the peel; the slide is each
   * one's own. The strap, when there is one, takes it all.
   */
  #fingers(W, poseMe, poseOpp, at, caps) {
    this.me.rig.update(poseMe);
    const nMe = this.#palm(this.me);
    const uMe = ALONG.clone().transformDirection(this.me.rig.hand.matrixWorld);
    this.opp.rig.update(poseOpp);
    const nOpp = this.#palm(this.opp);
    const uOpp = ALONG.clone().transformDirection(this.opp.rig.hand.matrixWorld);
    const n = nMe.clone().sub(nOpp).normalize(); // shared palm normal, out of my palm
    const separation = Math.max(0, W.F.dot(n));
    const peel = W.M.clone().addScaledVector(n, -W.M.dot(n)).length();
    const patch = table(PATCH, (at.me.y + at.opp.y) / 2);
    const side = (u, F, y, capKg) => {
      const flat = u.clone().addScaledVector(n, -u.dot(n)).normalize();
      const slide = Math.max(0, F.dot(flat));
      const load = 0.5 * separation + slide + (0.5 * peel) / patch;
      const hold = table(HOLD, y);
      const max = hold * (capKg ?? GRIP_ACTION.typical) * G;
      return { load, max, hold, slide };
    };
    return {
      separation,
      peel,
      patch,
      me: side(uMe, W.F, at.me.y, caps.me.grip),
      opp: side(uOpp, W.F.clone().negate(), at.opp.y, caps.opp.grip),
    };
  }

  /**
   * Solve a lock-up. `grip` is { depth, height, rotation, straps } (see
   * DEFAULT_GRIP). Everything returned is in world space.
   */
  solve({ me, opp, grip = DEFAULT_GRIP, capsMe, capsOpp }) {
    const techMe = TECHNIQUES.find((t) => t.id === me);
    const techOpp = TECHNIQUES.find((t) => t.id === opp);
    const g = { ...DEFAULT_GRIP, ...grip };
    const at = gripPoints(g);

    // 1. Lock: both arms settle into one grip, then a tiny shift closes any rounding gap.
    this.opp.outer.position.set(0, 0, PAD_DISTANCE);
    this.opp.outer.updateMatrixWorld(true);
    const targetMe = toRad(techMe.pose);
    const targetOpp = toRad(techOpp.pose);
    const rotation = g.rotation === null ? null : g.rotation * DEG;
    const poseMe = { ...targetMe };
    const poseOpp = { ...targetOpp };
    if (rotation !== null) poseMe.pron = poseOpp.pron = rotation;
    const free = [...JOINTS.map((k) => [poseMe, k]), ...JOINTS.map((k) => [poseOpp, k])];
    this.#lock(poseMe, poseOpp, at.me, at.opp, free, (p) => (p === poseMe ? targetMe : targetOpp), { rotation });
    const contact = this.#point(this.me, poseMe, at.me);
    const mismatch = contact.clone().sub(this.#point(this.opp, poseOpp, at.opp));
    this.opp.outer.position.add(mismatch);
    this.opp.outer.updateMatrixWorld(true);
    this.me.rig.update(poseMe);
    const nMe = this.#palm(this.me);
    this.opp.rig.update(poseOpp);
    const facing = -nMe.dot(this.#palm(this.opp));

    // 2–3. Efforts and the contested wrench on my hand.
    const motionMe = handMotion(this.me.rig, poseMe, at.me);
    const motionOpp = handMotion(this.opp.rig, poseOpp, at.opp);
    const eMe = this.#effort(this.me, techMe, motionMe);
    const eOpp = this.#effort(this.opp, techOpp, motionOpp);
    const W = {
      F: eOpp.F.clone().sub(eMe.F).multiplyScalar(0.5),
      M: eOpp.M.clone().sub(eMe.M).multiplyScalar(0.5),
    };

    // 4. Every link per newton of W, and how far each athlete can go.
    const perMe = wrenchTorques(motionMe, W.F, W.M);
    const perOpp = wrenchTorques(motionOpp, W.F.clone().negate(), W.M.clone().negate());
    const fingers = this.#fingers(W, poseMe, poseOpp, at, { me: capsMe, opp: capsOpp });
    const links = (per, caps, finger, s) => {
      const list = demandsFromTorques(
        Object.fromEntries(JOINTS.map((q) => [q, per[q] * s])),
        caps,
      );
      if (!g.straps) {
        const load = finger.load * s;
        list.push({ joint: 'grip', action: GRIP_ACTION, torque: load, max: finger.max, share: load / finger.max, unit: 'Н' });
      }
      return list.sort((a, b) => b.share - a.share);
    };
    const limit = (per, caps, finger) => 1 / Math.max(links(per, caps, finger, 1)[0].share, 1e-9);
    const sMe = limit(perMe, capsMe, fingers.me);
    const sOpp = limit(perOpp, capsOpp, fingers.opp);
    const s = Math.min(sMe, sOpp);
    const margin = sMe / sOpp - 1;

    return {
      grip: g,
      at,
      poses: { me: toDeg(poseMe), opp: toDeg(poseOpp), meRad: poseMe, oppRad: poseOpp },
      targets: { me: targetMe, opp: targetOpp },
      offset: this.opp.outer.position.clone(),
      mismatch: mismatch.length(),
      facing,
      rotation: (poseMe.pron + poseOpp.pron) / 2 / DEG,
      contact,
      efforts: { me: eMe, opp: eOpp },
      wrench: W,
      fingers,
      newtons: s,
      kg: s / G,
      sMe,
      sOpp,
      margin,
      winner: Math.abs(margin) < 0.03 ? 'even' : margin > 0 ? 'me' : 'opp',
      me: links(perMe, capsMe, fingers.me, s),
      opp: links(perOpp, capsOpp, fingers.opp, s),
    };
  }

  /**
   * The margin across one grip parameter, everything else held: what the
   * grip slider's curve shows. `values` default to the parameter's range.
   */
  sweep(settings, key, count = 13) {
    const p = GRIP_PARAMS.find((x) => x.id === key || x.key === key);
    const values = Array.from({ length: count }, (_, i) => p.min + ((p.max - p.min) * i) / (count - 1));
    const margins = values.map((v) => this.solve({ ...settings, grip: { ...settings.grip, [key]: v } }).margin);
    return { key, values, margins };
  }

  /**
   * How the lock-up breaks, as keyframes from the lock (t = 0) to the break
   * (t = 1). The athlete who reaches 100% first gives way at that link: the
   * joint turns the way it is being pushed and the two arms stay locked
   * through it, or — when it is the fingers — the grip opens and the other
   * hand pulls out.
   */
  breakdown(result, count = 16) {
    const loser = result.sMe <= result.sOpp ? 'me' : 'opp';
    const winner = loser === 'me' ? 'opp' : 'me';
    const link = result[loser][0];
    this.opp.outer.position.copy(result.offset);
    this.opp.outer.updateMatrixWorld(true);
    const start = { me: { ...result.poses.meRad }, opp: { ...result.poses.oppRad } };
    const poses = { me: { ...start.me }, opp: { ...start.opp } };
    const frames = [];

    if (link.joint === 'grip') {
      // The fingers open; the winner's hand pulls out along his own pull.
      const pull = result.efforts[winner].F.clone();
      const side = this[winner];
      const at = result.at[winner];
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const goal = result.contact.clone().addScaledVector(pull, 1.3 * t);
        const pose = poses[winner];
        const free = JOINTS.map((k) => [pose, k]);
        leastSquares(
          free.map(([p, k]) => p[k]),
          (x) => {
            free.forEach(([p, k], j) => (p[k] = x[j]));
            const gap = this.#point(side, pose, at).sub(goal);
            return [gap.x * GAP, gap.y * GAP, gap.z * GAP, ...free.map(([, k], j) => (x[j] - start[winner][k]) * STIFF[k] * DRIVING[k])];
          },
          25,
        );
        poses[loser].grip = start[loser].grip - 0.6 * t;
        frames.push({ me: { ...poses.me }, opp: { ...poses.opp } });
      }
      return { loser, link, frames };
    }

    // A joint gives way the direction it is pushed, and the winner drives the
    // lock through it along his own pull; his arm moves, the loser's holds on.
    const q = link.joint;
    const drive = result.efforts[winner].F.clone();
    const dir = -link.action.sign;
    const turn = (start.me.pron + start.opp.pron) / 2;
    const pinned = [poses[loser], q];
    const free = [...JOINTS.map((k) => [poses.me, k]), ...JOINTS.map((k) => [poses.opp, k])].filter(
      ([p, k]) => !(p === pinned[0] && k === pinned[1]),
    );
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      poses[loser][q] = start[loser][q] + dir * YIELD[q] * t;
      this.#lock(poses.me, poses.opp, result.at.me, result.at.opp, free, (p) => (p === poses.me ? start.me : start.opp), {
        // The lock keeps its turn unless the rotation itself is what gives way.
        rotation: q === 'pron' ? null : turn,
        goal: result.contact.clone().addScaledVector(drive, DRIVE * t),
        stiff: (p, k) => (p === poses[winner] ? DRIVING[k] : 1),
        hold: 4 * GAP, // the hands stay locked; the drive goes only as far as they can

      });
      frames.push({ me: { ...poses.me }, opp: { ...poses.opp } });
    }
    return { loser, link, frames };
  }
}

/** Gaussian elimination with partial pivoting for the small normal equations. */
function solveLinear(A, b) {
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
 * Muscle effort from link demands: each muscle works as hard as the hardest
 * action it carries needs, scaled by its leverage at the pose. The finger
 * flexors always squeeze a little — a grip is never slack.
 */
export function activationsFromDemands(demands, pose, leverage = {}) {
  const out = {};
  for (const d of demands) {
    for (const [id, role] of Object.entries(ACTION_MUSCLES[d.action.id])) {
      const gain = leverage[id] ? leverage[id](pose) : 1;
      out[id] = Math.max(out[id] ?? 0, Math.min(1, d.share) * role * gain);
    }
  }
  for (const id of ['fds', 'fdp']) out[id] = Math.max(out[id] ?? 0, 0.3);
  for (const [id, v] of Object.entries(out)) out[id] = Math.min(1, 0.05 + v);
  return out;
}
