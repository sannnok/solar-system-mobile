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
 * What it takes to hold a pose against a resistance of `newtons`: for each
 * joint, the action the athlete needs (the resistance pulls one way, so the
 * muscles that turn the other way must hold), the torque, and that torque as
 * a share of the athlete's maximum for that action. Sorted, weakest link first.
 */
export function jointDemands(rig, pose, resist, newtons, capacities) {
  const Q = resistanceLoads(rig, pose, resist);
  return JOINTS.map((joint) => {
    const sign = Q[joint] < 0 ? 1 : -1; // pulled towards −q → hold with +q
    const action = ACTIONS.find((a) => a.joint === joint && a.sign === sign);
    const torque = Math.abs(Q[joint]) * DM * newtons;
    const max = capacities[action.id] ?? action.typical;
    return { joint, action, torque, max, share: torque / max };
  }).sort((a, b) => b.share - a.share);
}
