/**
 * Muscles as deformable tubes.
 *
 * Each muscle is a path of control points, each pinned to one of the rig's
 * frames (see rig.js). Every frame the points are resolved to world space, a
 * Catmull-Rom curve is run through them, and an elliptical tube is swept along
 * it — flattened against the limb, fat at the belly, thin along the tendons.
 *
 * Because forearm points follow the pronation twist, the flexors and extensors
 * spiral round the forearm when it turns, and because each tube keeps its
 * volume, a muscle that shortens gets visibly thicker.
 */

import * as THREE from 'three';
import { createMuscleMaterial } from './materials.js';

const RINGS = 26;
const SEGS = 14;

export class MuscleSystem {
  constructor(rig, defs, timeUniform) {
    this.group = new THREE.Group();
    this.list = defs.map((def) => new Muscle(def, rig, timeUniform));
    this.byId = new Map(this.list.map((m) => [m.id, m]));
    for (const m of this.list) this.group.add(m.mesh);
  }

  /** Run once with the rig in its rest pose: that length is the reference for bulging. */
  captureRest() {
    for (const m of this.list) m.update(0, true);
  }

  update(activations) {
    for (const m of this.list) m.update(activations[m.id] ?? 0);
  }

  /** Highlight one muscle and dim the rest; null clears. */
  select(id) {
    for (const m of this.list) {
      m.material.uniforms.uSel.value = m.id === id ? 1 : 0;
      m.material.uniforms.uDim.value = id && m.id !== id ? 0.4 : 1;
    }
  }

  /** Raycast for taps. Geometry moves every frame, so bounds are refreshed on demand. */
  pick(raycaster) {
    for (const m of this.list) m.geometry.computeBoundingSphere();
    const hit = raycaster.intersectObjects(this.list.map((m) => m.mesh), false)[0];
    return hit ? hit.object.userData.muscle : null;
  }
}

class Muscle {
  constructor(def, rig, timeUniform) {
    this.id = def.id;
    this.def = def;
    this.rig = rig;
    this.activation = 0;
    this.restLength = null;

    this.points = def.pts.map(([frame, p]) => ({ frame, local: new THREE.Vector3(...p) }));
    this.P = this.points.map(() => new THREE.Vector3());
    this.O = this.points.map(() => new THREE.Vector3());
    this.chord = new Float32Array(this.points.length);
    this.centers = Array.from({ length: RINGS }, () => new THREE.Vector3());
    this.outs = Array.from({ length: RINGS }, () => new THREE.Vector3());
    this.mid = new THREE.Vector3();

    // Static per-ring belly profile: 0 along tendons, 1 at the widest point.
    const [b0, b1] = def.belly;
    this.bump = new Float32Array(RINGS);
    for (let i = 0; i < RINGS; i++) {
      const s = i / (RINGS - 1);
      this.bump[i] = s <= b0 || s >= b1 ? 0 : Math.sin((Math.PI * (s - b0)) / (b1 - b0)) ** 0.7;
    }

    const count = RINGS * (SEGS + 1);
    this.position = new Float32Array(count * 3);
    this.normal = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const belly = new Float32Array(count);
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j <= SEGS; j++) {
        const k = i * (SEGS + 1) + j;
        uv[k * 2] = j / SEGS;
        uv[k * 2 + 1] = i / (RINGS - 1);
        belly[k] = this.bump[i];
      }
    }
    const index = [];
    for (let i = 0; i < RINGS - 1; i++) {
      for (let j = 0; j < SEGS; j++) {
        const a = i * (SEGS + 1) + j;
        const b = a + SEGS + 1;
        // Wound so the outside faces out: ring step × around step = outward.
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normal, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setAttribute('aBelly', new THREE.BufferAttribute(belly, 1));
    this.geometry.setIndex(index);

    this.material = createMuscleMaterial(timeUniform);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.muscle = this;
  }

  update(activation, capturing = false) {
    const { rig, points, P, O, chord, centers, outs } = this;
    const n = points.length;

    for (let k = 0; k < n; k++) {
      rig.pointToWorld(points[k].frame, points[k].local, P[k]);
      rig.outwardToWorld(points[k].frame, points[k].local, O[k]);
    }
    chord[0] = 0;
    for (let k = 1; k < n; k++) chord[k] = chord[k - 1] + P[k].distanceTo(P[k - 1]);
    const total = chord[n - 1];

    // Ring centres, spaced by chord length along a Catmull-Rom spline.
    let k = 0;
    for (let i = 0; i < RINGS; i++) {
      const target = (i / (RINGS - 1)) * total;
      while (k < n - 2 && chord[k + 1] < target) k++;
      const span = Math.max(chord[k + 1] - chord[k], 1e-6);
      const t = THREE.MathUtils.clamp((target - chord[k]) / span, 0, 1);
      catmullRom(P[Math.max(k - 1, 0)], P[k], P[k + 1], P[Math.min(k + 2, n - 1)], t, centers[i]);
      outs[i].copy(O[k]).lerp(O[k + 1], t).normalize();
    }

    let length = 0;
    for (let i = 1; i < RINGS; i++) length += centers[i].distanceTo(centers[i - 1]);
    if (capturing || this.restLength === null) this.restLength = length;

    // Shortening thickens the belly (constant volume); effort adds a little more.
    const bulge = THREE.MathUtils.clamp(Math.sqrt(this.restLength / length), 0.8, 1.35) * (1 + 0.14 * activation);
    const { r, t: tendon, flat } = this.def;

    const tangent = _t;
    const bx = _bx;
    const by = _by;
    bx.set(0, 0, 0);
    for (let i = 0; i < RINGS; i++) {
      const a = centers[Math.max(i - 1, 0)];
      const b = centers[Math.min(i + 1, RINGS - 1)];
      tangent.subVectors(b, a).normalize();

      // Outward direction made perpendicular to the curve; keep the last good one if degenerate.
      _tmp.copy(outs[i]).addScaledVector(tangent, -outs[i].dot(tangent));
      if (_tmp.lengthSq() > 1e-6) bx.copy(_tmp.normalize());
      else if (bx.lengthSq() === 0) bx.set(1, 0, 0);
      by.crossVectors(tangent, bx);

      const radius = tendon + (r - tendon) * this.bump[i] * bulge;
      const thick = Math.max(radius * flat, 0.012);
      const wide = Math.max(radius, 0.012);
      const c = centers[i];
      for (let j = 0; j <= SEGS; j++) {
        const phi = (j / SEGS) * Math.PI * 2;
        const cs = Math.cos(phi);
        const sn = Math.sin(phi);
        const v = (i * (SEGS + 1) + j) * 3;
        this.position[v] = c.x + bx.x * cs * thick + by.x * sn * wide;
        this.position[v + 1] = c.y + bx.y * cs * thick + by.y * sn * wide;
        this.position[v + 2] = c.z + bx.z * cs * thick + by.z * sn * wide;
        let nx = (bx.x * cs) / thick + (by.x * sn) / wide;
        let ny = (bx.y * cs) / thick + (by.y * sn) / wide;
        let nz = (bx.z * cs) / thick + (by.z * sn) / wide;
        const len = Math.hypot(nx, ny, nz) || 1;
        this.normal[v] = nx / len;
        this.normal[v + 1] = ny / len;
        this.normal[v + 2] = nz / len;
      }
    }

    this.mid.copy(centers[Math.round((RINGS - 1) * (this.def.belly[0] + this.def.belly[1]) * 0.5)]);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.activation = activation;
    this.material.uniforms.uAct.value = activation;
  }
}

const _t = new THREE.Vector3();
const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _tmp = new THREE.Vector3();

function catmullRom(p0, p1, p2, p3, t, out) {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a, b, c, d) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}
