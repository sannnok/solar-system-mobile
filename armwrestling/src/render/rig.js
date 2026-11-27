/**
 * The arm: a small kinematic chain with real joint axes, a bone layer, a skin
 * layer and the training handle.
 *
 * Units are decimetres. y is up and the table top is y = 0. The athlete sits on
 * the −z side facing +z, and this is a right arm, so +x is the athlete's right.
 *
 * These are the coordinates of a mirror image: facing +z in a right-handed
 * system, your right hand is at −x, so main.js parents the root under a group
 * with scale.x = −1 to make this the right arm. Everything below is written
 * in the unmirrored "rig space" and reads as a right arm with +x to the right.
 *
 * Frames, all relative to `root`:
 *   upper    shoulder centre. +Y runs to the elbow, +Z is anterior (the side
 *            the forearm folds onto), +X is medial. Internal rotation of the
 *            shoulder is a turn about +Y — with the elbow on the pad, that is
 *            exactly what sweeps the forearm sideways in side pressure.
 *   forearm  elbow centre. +Y runs to the wrist, −X is palmar and +X dorsal; at
 *            the wrist −Z is the thumb side and +Z the little finger. Carries
 *            the ulna, which does not take part in pronation.
 *   distal   the forearm turned about the pronation axis, which runs from the
 *            radial head to the ulnar head. The radius and the hand live here,
 *            so in pronation the radius really does cross over the ulna.
 *   hand     wrist centre, same axes as the forearm at rest. Flexion turns
 *            about +Z, radial deviation about −X.
 */

import * as THREE from 'three';
import { createBoneMaterial, createRimMaterial } from './materials.js';
import { boneBetween, capsuleBetween, ellipsoid, ellipseTube, keyed, v3 } from './shapes.js';

export const ELBOW = v3(0, 0.42, 0);
export const UPPER_LEN = 3.0;
const UPPER_DIR = v3(-0.55, -1.05, 2.75).normalize();
export const SHOULDER = ELBOW.clone().addScaledVector(UPPER_DIR, -UPPER_LEN);
const FOREARM_DIR = v3(0, 1, 0.08).normalize();

export const RADIAL_HEAD = v3(0.2, 0.04, -0.02);
export const ULNAR_HEAD = v3(-0.02, 2.5, 0.2);
export const PRON_AXIS = ULNAR_HEAD.clone().sub(RADIAL_HEAD).normalize();
export const WRIST = v3(0, 2.62, 0);

/** The handle runs across the fist, thumb end at −z. */
export const HANDLE = {
  center: v3(-0.25, 0.97, 0),
  radialEnd: v3(-0.25, 0.97, -0.66),
  ulnarEnd: v3(-0.25, 0.97, 0.66),
};

/** Torso-relative points ('T' frame) are offsets from the shoulder centre. */
export const CHEST_CENTRE = v3(-1.5, -0.8, -0.7);

const AX = v3(1, 0, 0);
const AY = v3(0, 1, 0);
const AZ = v3(0, 0, 1);

const { qUpper, qForeRel } = (() => {
  const y = UPPER_DIR.clone();
  const z = FOREARM_DIR.clone().addScaledVector(y, -FOREARM_DIR.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  const qUpper = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const fx = AX.clone();
  const fy = FOREARM_DIR.clone();
  const fz = new THREE.Vector3().crossVectors(fx, fy);
  const qFore = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(fx, fy, fz));
  return { qUpper, qForeRel: qUpper.clone().invert().multiply(qFore) };
})();

/** How much of the pronation a forearm point at height y follows: 0 at the elbow, 1 at the wrist. */
export const twistShare = (y) =>
  THREE.MathUtils.clamp((y - RADIAL_HEAD.y) / (ULNAR_HEAD.y - RADIAL_HEAD.y), 0, 1);

const FINGERS = [
  { base: v3(0, 0.3, -0.19), knuckle: v3(0, 1.0, -0.27), lens: [0.42, 0.26, 0.19] },
  { base: v3(0, 0.3, -0.06), knuckle: v3(0, 1.04, -0.09), lens: [0.46, 0.29, 0.2] },
  { base: v3(0, 0.3, 0.07), knuckle: v3(0, 1.0, 0.09), lens: [0.43, 0.28, 0.19] },
  { base: v3(0, 0.3, 0.19), knuckle: v3(0, 0.92, 0.25), lens: [0.34, 0.22, 0.17] },
];
/** Joint flexion (radians) at a full grip — wraps the fingers round the handle. */
const CURL = [1.2, 1.7, 1.0];
const THUMB = [v3(-0.08, 0.2, -0.26), v3(-0.3, 0.48, -0.42), v3(-0.52, 0.72, -0.38), v3(-0.62, 0.92, -0.22)];

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

export class Rig {
  /**
   * `ghost` builds the red error overlay (arm only). `probe` builds frames and
   * nothing else — a cheap rig for mechanics calculations that can be posed
   * many times a frame without touching any geometry.
   */
  constructor({ ghost = false, probe = false } = {}) {
    this.ghost = ghost;
    this.probe = probe;
    this.root = new THREE.Group();
    this.upper = new THREE.Group();
    this.upper.position.copy(SHOULDER);
    this.forearm = new THREE.Group();
    this.forearm.position.set(0, UPPER_LEN, 0);
    this.distal = new THREE.Group();
    this.distal.matrixAutoUpdate = false;
    this.hand = new THREE.Group();
    this.hand.position.copy(WRIST);
    this.root.add(this.upper);
    this.upper.add(this.forearm);
    this.forearm.add(this.distal);
    this.distal.add(this.hand);

    this.layers = { bones: [], skin: [], gear: [] };
    this.pron = 0;
    this.fingers = [];

    if (probe) {
      this.update({ pron: 0, flex: 0, dev: 0, elbow: 0, ir: 0, grip: 0.95 });
      return;
    }

    if (ghost) {
      const red = 0xff3d5a;
      this.materials = {
        bone: createRimMaterial({ color: red, base: 0.22, strength: 1.2, power: 1.5 }),
        humerus: createRimMaterial({ color: red, base: 0.22, strength: 1.2, power: 1.5 }),
        skin: createRimMaterial({ color: red, base: 0.07, strength: 1.1, power: 1.6 }),
        gear: createRimMaterial({ color: red, base: 0.12, strength: 0.9 }),
      };
    } else {
      const bone = createBoneMaterial();
      this.materials = {
        bone,
        humerus: bone,
        skin: createRimMaterial({ color: 0x6fd0ff, base: 0.01, strength: 0.42 }),
        gear: new THREE.MeshStandardMaterial({ color: 0x3a4553, metalness: 0.85, roughness: 0.3 }),
      };
    }

    this.#buildSkeleton();
    this.#buildSkin();
    this.#buildHand();
    this.#buildHandle();
    this.update({ pron: 0, flex: 0, dev: 0, elbow: 0, ir: 0, grip: 0.95 });
  }

  /** Apply a pose (radians, grip 0..1) and refresh every world matrix. */
  update(p) {
    this.upper.quaternion.copy(qUpper).multiply(_q.setFromAxisAngle(AY, p.ir));
    this.forearm.quaternion.setFromAxisAngle(AX, p.elbow).multiply(qForeRel);

    // Rotate about the axis through the radial head: T(P)·R·T(−P).
    _m.makeRotationAxis(PRON_AXIS, p.pron);
    _v.copy(RADIAL_HEAD).applyMatrix4(_m);
    _m.setPosition(RADIAL_HEAD.x - _v.x, RADIAL_HEAD.y - _v.y, RADIAL_HEAD.z - _v.z);
    this.distal.matrix.copy(_m);

    this.hand.quaternion.setFromAxisAngle(AZ, p.flex).multiply(_q.setFromAxisAngle(AX, -p.dev));
    for (const joints of this.fingers) {
      joints.forEach((joint, i) => (joint.rotation.z = CURL[i] * p.grip));
    }

    this.root.updateMatrixWorld(true);
    if (p.pron !== this.pron) {
      this.pron = p.pron;
      if (this.forearmSkin) this.#twistForearmSkin();
    }
  }

  /**
   * A point given in one of the rig's frames, in world space. World matrices
   * include whatever the root is parented to — main.js mirrors it — so muscles
   * built from these points live in the scene, outside the mirror.
   */
  pointToWorld(frame, local, target) {
    switch (frame) {
      case 'H':
        return target.copy(local).applyMatrix4(this.upper.matrixWorld);
      case 'U':
        return target.copy(local).applyMatrix4(this.forearm.matrixWorld);
      case 'S':
        return this.twist(local, target).applyMatrix4(this.forearm.matrixWorld);
      case 'R':
        return target.copy(local).applyMatrix4(this.distal.matrixWorld);
      case 'M':
        return target.copy(local).applyMatrix4(this.hand.matrixWorld);
      case 'T':
        return target.copy(local).add(SHOULDER).applyMatrix4(this.root.matrixWorld);
      default:
        throw new Error(`Unknown frame ${frame}`);
    }
  }

  /** Which way is "out of the limb" at that point — muscles flatten against it. */
  outwardToWorld(frame, local, target) {
    if (frame === 'T') return target.copy(local).sub(CHEST_CENTRE).transformDirection(this.root.matrixWorld);
    target.set(local.x, 0, frame === 'M' ? local.z * 0.5 : local.z);
    if (target.lengthSq() < 1e-6) target.set(0, 0, 1);
    target.normalize();
    switch (frame) {
      case 'H':
        return target.transformDirection(this.upper.matrixWorld);
      case 'U':
        return target.transformDirection(this.forearm.matrixWorld);
      case 'S':
        target.applyAxisAngle(PRON_AXIS, this.pron * twistShare(local.y));
        return target.transformDirection(this.forearm.matrixWorld);
      case 'R':
        return target.transformDirection(this.distal.matrixWorld);
      default:
        return target.transformDirection(this.hand.matrixWorld);
    }
  }

  /** A direction given in one of the rig's frames (rig space for 'T'), in world space. */
  directionToWorld(frame, local, dir, target) {
    target.copy(dir);
    switch (frame) {
      case 'H':
        return target.transformDirection(this.upper.matrixWorld);
      case 'U':
        return target.transformDirection(this.forearm.matrixWorld);
      case 'S':
        target.applyAxisAngle(PRON_AXIS, this.pron * twistShare(local.y));
        return target.transformDirection(this.forearm.matrixWorld);
      case 'R':
        return target.transformDirection(this.distal.matrixWorld);
      case 'M':
        return target.transformDirection(this.hand.matrixWorld);
      default:
        return target.transformDirection(this.root.matrixWorld);
    }
  }

  /**
   * Soft tissue of the forearm follows the radius partway: nothing at the
   * elbow, all of it at the wrist. Input and output are forearm-local.
   */
  twist(local, target) {
    return target
      .copy(local)
      .sub(RADIAL_HEAD)
      .applyAxisAngle(PRON_AXIS, this.pron * twistShare(local.y))
      .add(RADIAL_HEAD);
  }

  elbowAngle() {
    const e = this.forearm.getWorldPosition(new THREE.Vector3());
    const w = this.hand.getWorldPosition(new THREE.Vector3());
    return this.upper.getWorldPosition(new THREE.Vector3()).sub(e).angleTo(w.sub(e));
  }

  setLayer(name, visible) {
    for (const mesh of this.layers[name]) mesh.visible = visible;
  }

  /** Glow on the humerus — the bone that breaks in a bad side-pressure position. */
  setDanger(amount) {
    const m = this.materials.humerus;
    if (m.uniforms.uStrength) m.uniforms.uStrength.value = 1.2 + amount * 2.4;
    if (m.uniforms.uGlow) m.uniforms.uGlow.value = amount;
  }

  // ── construction ──────────────────────────────────────────────────────────

  #add(layer, parent, mesh) {
    parent.add(mesh);
    this.layers[layer].push(mesh);
    return mesh;
  }

  #buildSkeleton() {
    const m = this.materials.bone;
    const h = this.materials.humerus;
    const bone = (parent, mesh) => this.#add('bones', parent, mesh);

    // Humerus, its head and the condyles at the elbow.
    bone(this.upper, ellipsoid(v3(0, 0.02, -0.02), v3(0.27, 0.27, 0.27), h, 18));
    bone(this.upper, boneBetween(v3(0, 0.12, 0), v3(0, 2.88, 0.02), 0.17, 0.095, 0.16, h));
    bone(this.upper, capsuleBetween(v3(-0.26, 2.97, 0.02), v3(0.3, 2.97, 0), 0.12, h));
    bone(this.upper, ellipsoid(v3(0.35, 2.92, -0.03), v3(0.09, 0.09, 0.09), h, 12));
    bone(this.upper, ellipsoid(v3(-0.29, 2.92, 0), v3(0.07, 0.07, 0.07), h, 12));

    // Ulna stays with the forearm; the radius turns with the hand.
    bone(this.forearm, boneBetween(v3(-0.07, -0.24, -0.09), ULNAR_HEAD.clone(), 0.14, 0.058, 0.08, m));
    bone(this.distal, boneBetween(v3(0.2, -0.02, -0.02), v3(0, 2.54, -0.17), 0.1, 0.062, 0.15, m));

    // Clavicle, for a sense of where the body is. The ghost is only an arm.
    const s = SHOULDER;
    if (!this.ghost) {
      bone(this.root, boneBetween(s.clone().add(v3(-1.35, 0.28, 0.35)), s.clone().add(v3(-0.1, 0.33, 0.06)), 0.07, 0.05, 0.08, m));
    }

    // Carpals: two rows of four.
    for (const [y, zs] of [
      [0.1, [-0.2, -0.07, 0.06, 0.19]],
      [0.24, [-0.21, -0.07, 0.07, 0.2]],
    ]) {
      for (const z of zs) bone(this.hand, ellipsoid(v3(0, y, z), v3(0.08, 0.065, 0.065), m, 10));
    }
  }

  #buildSkin() {
    const skin = (parent, mesh) => this.#add('skin', parent, mesh);
    const mat = this.materials.skin;

    const uRx = keyed([[0, 0.6], [0.3, 0.5], [0.7, 0.46], [0.92, 0.42], [1, 0.36]]);
    const uRz = keyed([[0, 0.6], [0.3, 0.55], [0.7, 0.5], [0.92, 0.42], [1, 0.36]]);
    skin(this.upper, new THREE.Mesh(
      ellipseTube((s) => ({ y: -0.1 + s * 3.25, cx: 0, cz: 0, rx: uRx(s), rz: uRz(s) }), 32, 28),
      mat,
    ));
    skin(this.upper, ellipsoid(v3(-0.05, 0.05, 0), v3(0.66, 0.62, 0.62), mat));

    const fRx = keyed([[0, 0.36], [0.1, 0.5], [0.34, 0.55], [0.62, 0.44], [0.86, 0.32], [1, 0.27]]);
    const fRz = keyed([[0, 0.4], [0.1, 0.5], [0.34, 0.5], [0.62, 0.42], [0.86, 0.36], [1, 0.36]]);
    const forearm = skin(this.forearm, new THREE.Mesh(
      ellipseTube((s) => ({ y: -0.3 + s * 2.96, cx: 0.02, cz: 0.02, rx: fRx(s), rz: fRz(s) }), 40, 28),
      mat,
    ));
    this.forearmSkin = forearm.geometry;
    const pos = forearm.geometry.attributes.position;
    this.skinRest = Float32Array.from(pos.array);
    this.skinShare = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) this.skinShare[i] = twistShare(pos.getY(i));

    skin(this.hand, ellipsoid(v3(-0.01, 0.6, 0), v3(0.17, 0.56, 0.38), mat));

    // Torso, neck and head — faint, just enough to read the posture.
    if (this.ghost) return;
    const s = SHOULDER;
    const torso = skin(this.root, ellipsoid(s.clone().add(v3(-1.45, -1.25, -0.6)), v3(1.45, 2.05, 0.9), mat, 32));
    torso.rotation.x = 0.3;
    skin(this.root, capsuleBetween(s.clone().add(v3(-1.45, 0.4, -0.45)), s.clone().add(v3(-1.45, 1.15, -0.25)), 0.32, mat, 16));
    skin(this.root, ellipsoid(s.clone().add(v3(-1.45, 1.65, -0.05)), v3(0.5, 0.62, 0.56), mat, 24));
  }

  #buildHand() {
    const bone = (parent, mesh) => this.#add('bones', parent, mesh);
    const skin = (parent, mesh) => this.#add('skin', parent, mesh);
    const m = this.materials.bone;
    const s = this.materials.skin;

    this.fingers = FINGERS.map((finger) => {
      bone(this.hand, capsuleBetween(finger.base, finger.knuckle, 0.045, m, 8));
      const joints = [];
      let parent = this.hand;
      let offset = finger.knuckle.clone();
      finger.lens.forEach((len, i) => {
        const joint = new THREE.Group();
        joint.position.copy(offset);
        parent.add(joint);
        joints.push(joint);
        bone(joint, capsuleBetween(v3(0, 0.03, 0), v3(0, len - 0.03, 0), [0.042, 0.036, 0.03][i], m, 8));
        skin(joint, capsuleBetween(v3(0, 0, 0), v3(0, len, 0), [0.088, 0.08, 0.072][i], s, 10));
        parent = joint;
        offset = v3(0, len, 0);
      });
      return joints;
    });

    for (let i = 0; i < THUMB.length - 1; i++) {
      bone(this.hand, capsuleBetween(THUMB[i], THUMB[i + 1], [0.05, 0.045, 0.036][i], m, 8));
      skin(this.hand, capsuleBetween(THUMB[i], THUMB[i + 1], [0.12, 0.095, 0.085][i], s, 10));
    }
  }

  #buildHandle() {
    const mat = this.materials.gear;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.2, 24), mat);
    bar.rotation.x = Math.PI / 2;
    bar.position.copy(HANDLE.center);
    this.#add('gear', this.hand, bar);
    for (const end of [HANDLE.radialEnd, HANDLE.ulnarEnd]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 8, 20), mat);
      ring.position.copy(end);
      this.#add('gear', this.hand, ring);
    }
  }

  #twistForearmSkin() {
    const pos = this.forearmSkin.attributes.position;
    const out = pos.array;
    const rest = this.skinRest;
    const { x: kx, y: ky, z: kz } = PRON_AXIS;
    const { x: px, y: py, z: pz } = RADIAL_HEAD;
    for (let i = 0; i < pos.count; i++) {
      const a = this.pron * this.skinShare[i];
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = rest[i * 3] - px;
      const y = rest[i * 3 + 1] - py;
      const z = rest[i * 3 + 2] - pz;
      const dot = (kx * x + ky * y + kz * z) * (1 - c);
      // Rodrigues: v·cos + (k×v)·sin + k(k·v)(1−cos)
      out[i * 3] = px + x * c + (ky * z - kz * y) * s + kx * dot;
      out[i * 3 + 1] = py + y * c + (kz * x - kx * z) * s + ky * dot;
      out[i * 3 + 2] = pz + z * c + (kx * y - ky * x) * s + kz * dot;
    }
    pos.needsUpdate = true;
    this.forearmSkin.computeVertexNormals();
  }
}
