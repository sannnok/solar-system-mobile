/**
 * Tiny value-noise toolkit for the procedural planet textures.
 *
 * Everything here works in equirectangular UV space: `u` wraps around the
 * sphere, `v` runs pole to pole. Noise grids wrap in u so there is no seam
 * down the back of a planet.
 */

import { makeRng } from '../util/math.js';

function buildLayer(width, height, rng) {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rng();
  return { width, height, data };
}

function sampleLayer(layer, u, v) {
  const { width, height, data } = layer;
  const x = u * width;
  const y = v * (height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  // Smoothstep the interpolation so the noise has no grid-aligned creases.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const xi = ((x0 % width) + width) % width;
  const xj = (xi + 1) % width;
  const yi = Math.max(0, Math.min(height - 1, y0));
  const yj = Math.max(0, Math.min(height - 1, y0 + 1));

  const top = data[yi * width + xi] + (data[yi * width + xj] - data[yi * width + xi]) * sx;
  const bottom = data[yj * width + xi] + (data[yj * width + xj] - data[yj * width + xi]) * sx;
  return top + (bottom - top) * sy;
}

/**
 * Returns an fBm sampler: `noise(u, v)` in roughly [0, 1].
 *
 * `baseWidth` sets the largest feature size; each octave doubles the detail.
 * `baseHeight` defaults to an equirect-correct half of the width, but passing a
 * taller grid stretches features along longitude — which is what the zonal
 * streaks on a gas giant look like.
 */
export function createNoise(seed, octaves = 5, baseWidth = 6, baseHeight = 0) {
  const rng = makeRng(seed);
  const layers = [];
  const rootHeight = baseHeight || Math.max(2, baseWidth >> 1);
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const width = baseWidth << o;
    const height = rootHeight << o;
    layers.push({ layer: buildLayer(width, height, rng), amplitude });
    total += amplitude;
    amplitude *= 0.5;
  }
  return function noise(u, v) {
    let sum = 0;
    for (let i = 0; i < layers.length; i++) {
      sum += sampleLayer(layers[i].layer, u, v) * layers[i].amplitude;
    }
    return sum / total;
  };
}

/** Ridged noise — good for cloud filaments and crater ejecta. */
export function ridged(noise) {
  return (u, v) => {
    const n = noise(u, v);
    return 1 - Math.abs(n * 2 - 1);
  };
}

export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Shortest signed distance between two u coordinates on a wrapping surface. */
export function wrapDelta(delta) {
  let d = delta % 1;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return d;
}

export function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Samples a list of hex colours as an evenly spaced gradient. */
export function makeRamp(palette) {
  const stops = palette.map(hexToRgb);
  const last = stops.length - 1;
  return function ramp(t, out) {
    const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const scaled = clamped * last;
    const index = Math.min(last - 1, Math.floor(scaled));
    const f = scaled - index;
    const a = stops[index];
    const b = stops[index + 1];
    out[0] = a[0] + (b[0] - a[0]) * f;
    out[1] = a[1] + (b[1] - a[1]) * f;
    out[2] = a[2] + (b[2] - a[2]) * f;
    return out;
  };
}
