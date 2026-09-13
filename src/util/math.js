/**
 * Small math helpers shared across the simulation.
 */

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Maps `value` from one range to another without clamping. */
export function remap(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/** Wraps an angle (radians) into [-PI, PI]. */
export function wrapAngle(radians) {
  let a = (radians + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Frame-rate independent smoothing. `smoothing` is the fraction of the
 * remaining distance left after one second, so smaller means snappier.
 */
export function damp(current, target, smoothing, dt) {
  return lerp(target, current, Math.pow(smoothing, dt));
}

/** Deterministic PRNG so procedural textures look identical on every load. */
export function makeRng(seed) {
  let t = seed >>> 0;
  return function random() {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
