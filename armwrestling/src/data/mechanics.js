/**
 * Joint loads by virtual work — shared by the app's "weak link" panel and by
 * scripts/check-armlab.mjs.
 *
 * For a force F applied at a point P of the hand, its generalised force on a
 * joint coordinate q is Q = F · ∂P/∂q: the torque F produces about that joint.
 * ∂P/∂q comes from finite differences on the real rig, so there are no axes or
 * sign conventions to get wrong. Rig units are decimetres and angles radians,
 * so for a force in newtons the torque in N·m is Q × 0.1 × F.
 *
 * Use a probe rig (new Rig({ probe: true })): it is posed many times per call.
 */

import * as THREE from 'three';
import { HANDLE } from '../render/rig.js';
import { ACTIONS } from './strength.js';

export const JOINTS = ['pron', 'flex', 'dev', 'elbow', 'ir'];
const EPS = 1e-3;
const DM = 0.1;
const _p = new THREE.Vector3();

/** Hand-local point where a resistance acts: a cable on the handle, or the opponent's grip. */
export function resistancePoint(resist) {
  return resist.kind === 'cable' ? HANDLE[resist.attach] : new THREE.Vector3(...resist.at);
}

/** Unit direction (rig space) of a resistance at the rig's current pose. */
export function resistanceDirection(rig, resist, target = new THREE.Vector3()) {
  if (resist.kind === 'cable') {
    rig.hand.localToWorld(_p.copy(resistancePoint(resist)));
    return target.set(...resist.anchor).sub(_p).normalize();
  }
  return target.set(...resist.dir).normalize();
}

/** Generalised force on every joint of a unit force with fixed `direction` at hand-local `point`. */
export function virtualWork(rig, pose, point, direction) {
  const at = (p) => {
    rig.update(p);
    return rig.hand.localToWorld(point.clone());
  };
  const out = {};
  for (const q of JOINTS) {
    const dP = at({ ...pose, [q]: pose[q] + EPS }).sub(at({ ...pose, [q]: pose[q] - EPS })).divideScalar(2 * EPS);
    out[q] = direction.dot(dP);
  }
  rig.update(pose);
  return out;
}

/** Generalised forces of a resistance at a pose (unit force). */
export function resistanceLoads(rig, pose, resist) {
  rig.update(pose);
  const direction = resistanceDirection(rig, resist);
  return virtualWork(rig, pose, resistancePoint(resist), direction);
}

/**
 * Joint torques (N·m, signed: the direction the resistance pulls each joint)
 * turned into what it takes to hold them: the action that must resist, the
 * torque, and that torque as a share of the athlete's maximum for that
 * action. Sorted, weakest link first.
 */
export function demandsFromTorques(torques, capacities) {
  return JOINTS.map((joint) => {
    const sign = torques[joint] < 0 ? 1 : -1; // pulled towards −q → hold with +q
    const action = ACTIONS.find((a) => a.joint === joint && a.sign === sign);
    const torque = Math.abs(torques[joint]);
    const max = capacities[action.id] ?? action.typical;
    return { joint, action, torque, max, share: torque / max };
  }).sort((a, b) => b.share - a.share);
}

/** What it takes to hold a pose against a resistance of `newtons`. */
export function jointDemands(rig, pose, resist, newtons, capacities) {
  const Q = resistanceLoads(rig, pose, resist);
  const torques = Object.fromEntries(JOINTS.map((q) => [q, Q[q] * DM * newtons]));
  return demandsFromTorques(torques, capacities);
}

// ── wrenches: force and torque through a grip ───────────────────────────────

const SPOKE = 0.5; // dm
const WORLD_AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

/**
 * How the hand moves when each joint turns, per radian: the world velocity of
 * a hand point and the hand's angular velocity. The angular velocity comes
 * from the velocities of three spokes around the point,
 *   ω = Σ rₖ × (vₖ − v₀) / (2e²),
 * so it is read off the actual motion — correct through mirrored parents,
 * where turning an axis vector would flip its sense.
 */
export function handMotion(rig, pose, point) {
  rig.update(pose);
  const centre = rig.hand.localToWorld(point.clone());
  const locals = [point.clone(), ...WORLD_AXES.map((a) => rig.hand.worldToLocal(centre.clone().addScaledVector(a, SPOKE)))];
  const positions = (p) => {
    rig.update(p);
    return locals.map((l) => rig.hand.localToWorld(l.clone()));
  };
  const out = {};
  for (const q of JOINTS) {
    const plus = positions({ ...pose, [q]: pose[q] + EPS });
    const minus = positions({ ...pose, [q]: pose[q] - EPS });
    const v = plus.map((p, i) => p.sub(minus[i]).divideScalar(2 * EPS));
    const w = new THREE.Vector3();
    WORLD_AXES.forEach((a, k) => w.add(a.clone().multiplyScalar(SPOKE).cross(v[k + 1].clone().sub(v[0]))));
    out[q] = { v: v[0], w: w.divideScalar(2 * SPOKE * SPOKE) };
  }
  rig.update(pose);
  return out;
}

/**
 * Generalised forces, in N·m, of a wrench on the hand: force F (N, world) at
 * the motion's point and torque M (N·m, world). Positive pulls the joint
 * towards +q.
 */
export function wrenchTorques(motion, F, M) {
  return Object.fromEntries(JOINTS.map((q) => [q, DM * F.dot(motion[q].v) + M.dot(motion[q].w)]));
}
