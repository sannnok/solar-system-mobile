/** Small geometry builders shared by the skeleton, skin and overlays. */

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** Place a mesh built along +Y from the origin so it spans a → b. */
export function placeBetween(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

/**
 * A long bone: rounded caps, bulging ends (the epiphyses) and a slimmer shaft.
 * Rings are packed towards the ends where the profile changes fastest.
 */
export function boneBetween(a, b, rA, rShaft, rB, material, segments = 14) {
  const length = a.distanceTo(b);
  const points = [];
  const n = 30;
  for (let i = 0; i <= n; i++) {
    const y = ((1 - Math.cos((Math.PI * i) / n)) / 2) * length;
    const wA = Math.exp(-((y / (rA * 1.7)) ** 2));
    const wB = Math.exp(-(((length - y) / (rB * 1.7)) ** 2));
    let r = rShaft + (rA - rShaft) * wA + (rB - rShaft) * wB;
    const capA = y < rA ? Math.sqrt(Math.max(0, 1 - ((rA - y) / rA) ** 2)) : 1;
    const capB = length - y < rB ? Math.sqrt(Math.max(0, 1 - ((rB - (length - y)) / rB) ** 2)) : 1;
    r *= Math.min(capA, capB);
    points.push(new THREE.Vector2(Math.max(r, 0.002), y));
  }
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(points, segments), material);
  return placeBetween(mesh, a, b);
}

export function capsuleBetween(a, b, radius, material, radial = 10) {
  const length = Math.max(a.distanceTo(b) - 2 * radius, 0.001);
  const geometry = new THREE.CapsuleGeometry(radius, length, 4, radial);
  geometry.translate(0, length / 2 + radius, 0);
  return placeBetween(new THREE.Mesh(geometry, material), a, b);
}

export function ellipsoid(center, radii, material, detail = 24) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, detail, Math.round(detail * 0.75)), material);
  mesh.position.copy(center);
  mesh.scale.copy(radii);
  return mesh;
}

/**
 * An open tube around +Y with an elliptical cross-section.
 * `profile(s)` returns { y, cx, cz, rx, rz } for s in [0, 1].
 */
export function ellipseTube(profile, rings = 40, segments = 28) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < rings; i++) {
    const { y, cx, cz, rx, rz } = profile(i / (rings - 1));
    for (let j = 0; j <= segments; j++) {
      const phi = (j / segments) * Math.PI * 2;
      positions.push(cx + Math.cos(phi) * rx, y, cz + Math.sin(phi) * rz);
    }
  }
  const row = segments + 1;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * row + j;
      const b = a + row;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Piecewise-smooth interpolation through [t, value] keys. */
export function keyed(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i];
      const [t0, v0] = keys[i - 1];
      if (t <= t1) {
        const k = (t - t0) / (t1 - t0);
        return v0 + (v1 - v0) * k * k * (3 - 2 * k);
      }
    }
    return keys[keys.length - 1][1];
  };
}
