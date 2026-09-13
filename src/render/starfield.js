/**
 * Background stars. Two point clouds — a dense faint field plus a sparse set of
 * brighter stars — which is cheap and reads better than one uniform size.
 */

import * as THREE from 'three';
import { makeRng, TAU } from '../util/math.js';
import { createStarTexture } from './textures.js';

// Roughly blackbody-ish tints, weighted toward white.
const STAR_TINTS = [
  [0.66, 0.76, 1.0],
  [0.82, 0.88, 1.0],
  [1.0, 1.0, 1.0],
  [1.0, 0.97, 0.88],
  [1.0, 0.87, 0.7],
  [1.0, 0.74, 0.58],
];

function buildPoints(count, radius, rng, sizeRange, brightnessRange, texture) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: cosine-distributed latitude avoids polar clumping.
    const cosTheta = rng() * 2 - 1;
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    const phi = rng() * TAU;
    const r = radius * (0.85 + rng() * 0.3);
    positions[i * 3] = r * sinTheta * Math.cos(phi);
    positions[i * 3 + 1] = r * cosTheta;
    positions[i * 3 + 2] = r * sinTheta * Math.sin(phi);

    const tint = STAR_TINTS[Math.floor(rng() * STAR_TINTS.length)];
    const brightness =
      brightnessRange[0] + Math.pow(rng(), 2.2) * (brightnessRange[1] - brightnessRange[0]);
    colors[i * 3] = tint[0] * brightness;
    colors[i * 3 + 1] = tint[1] * brightness;
    colors[i * 3 + 2] = tint[2] * brightness;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: sizeRange,
    map: texture,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;
  return points;
}

export function createStarfield({ count, radius = 3600 }) {
  const rng = makeRng(1987);
  const texture = createStarTexture();
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;

  group.add(buildPoints(count, radius, rng, radius * 0.0055, [0.25, 0.8], texture));
  group.add(buildPoints(Math.round(count * 0.06), radius, rng, radius * 0.016, [0.7, 1.4], texture));
  return group;
}
