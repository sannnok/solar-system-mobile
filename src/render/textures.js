/**
 * Every surface in the scene is painted at runtime onto a canvas.
 *
 * Nothing is downloaded, so the app works offline and the whole repository
 * stays text. Each painter returns an `(u, v, out)` function sampled across an
 * equirectangular map; craters and ice cracks are stamped on afterwards with
 * ordinary canvas drawing, which is far cheaper than doing them per pixel.
 */

import * as THREE from 'three';
import { clamp, makeRng, TAU } from '../util/math.js';
import { createNoise, makeRamp, hexToRgb, smoothstep, wrapDelta } from './noise.js';

let maxAnisotropy = 4;

export function configureTextures(anisotropy) {
  maxAnisotropy = Math.max(1, anisotropy);
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toTexture(canvas, { repeat = true, srgb = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  if (repeat) texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** Palettes are authored for readability, not ordering; sort them into a ramp. */
function luminanceSorted(palette) {
  return [...palette].sort((a, b) => luminance(a) - luminance(b));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mixInto(out, rgb, amount) {
  out[0] += (rgb[0] - out[0]) * amount;
  out[1] += (rgb[1] - out[1]) * amount;
  out[2] += (rgb[2] - out[2]) * amount;
}

function scaleRgb(out, factor) {
  out[0] *= factor;
  out[1] *= factor;
  out[2] *= factor;
}

/** fBm clusters around 0.5; stretch it so palettes actually get used. */
function contrast(value, amount, center = 0.5) {
  return (value - center) * amount + 0.5;
}

const ICE = [236, 242, 248];

// --- surface painters -------------------------------------------------------

function rockyPainter(surface) {
  const ramp = makeRamp(luminanceSorted(surface.palette));
  const base = createNoise(surface.seed, 5, 6);
  const detail = createNoise(surface.seed + 101, 4, 22);
  const basins = createNoise(surface.seed + 211, 3, 3);
  const caps = surface.iceCaps ?? 0;

  return (u, v, out) => {
    let value = contrast(base(u, v), 2.1, 0.45);
    value += (detail(u, v) - 0.5) * 0.26;
    const basin = basins(u, v);
    if (basin < 0.46) value -= (0.46 - basin) * 1.3;
    ramp(clamp(value, 0, 1), out);

    if (caps > 0) {
      const polar = Math.abs(v - 0.5) * 2;
      const edge = 1 - caps;
      const ice = smoothstep(edge, edge + 0.09, polar + (detail(u, v) - 0.5) * 0.1);
      if (ice > 0) mixInto(out, ICE, ice * 0.9);
    }
  };
}

function bandedPainter(surface) {
  const ramp = makeRamp(luminanceSorted(surface.palette));
  const warp = createNoise(surface.seed + 11, 4, 10, 4);
  // A grid far taller than it is wide smears detail along longitude, which is
  // exactly how zonal wind bands look.
  const streaks = createNoise(surface.seed + 307, 5, 10, 40);
  const mottle = createNoise(surface.seed + 409, 4, 22, 22);
  const bands = surface.bands ?? 8;
  const turbulence = surface.turbulence ?? 0.3;
  const bandContrast = surface.bandContrast ?? 1;
  const spot = surface.spot ? { ...surface.spot, rgb: hexToRgb(surface.spot.color) } : null;

  return (u, v, out) => {
    const shear = (warp(u, v) - 0.5) * turbulence;
    const lat = clamp(v + shear * 0.03, 0, 1);

    // Three incommensurate frequencies: bands end up at irregular widths and
    // strengths instead of the barcode a single sine gives.
    const profile =
      Math.sin(lat * Math.PI * bands * 2) * 0.5 +
      Math.sin(lat * Math.PI * bands * 1.31 + 1.9) * 0.3 +
      Math.sin(lat * Math.PI * bands * 0.57 + 0.6) * 0.26;

    let value =
      (0.5 + 0.5 * clamp(profile, -1, 1)) * 0.55 +
      streaks(u + shear * 0.2, lat) * 0.36 +
      (mottle(u, v) - 0.5) * 0.14 +
      0.06;
    value = 0.5 + (value - 0.5) * bandContrast;
    ramp(clamp(value, 0, 1), out);

    if (spot) {
      const du = wrapDelta(u - spot.u);
      const dv = v - spot.v;
      const q = (du / spot.rx) ** 2 + (dv / spot.ry) ** 2;
      if (q < 1.7) {
        const k = smoothstep(1.7, 0.2, q);
        mixInto(out, spot.rgb, k * 0.8);
      }
    }

    // Gas giants darken toward the poles; it also hides equirect stretching.
    const polar = Math.abs(v - 0.5) * 2;
    scaleRgb(out, 1 - smoothstep(0.66, 1, polar) * 0.34);
  };
}

function terranPainter(surface) {
  const [deep, shallow, forest, sand, ice] = surface.palette.map(hexToRgb);
  const continents = createNoise(surface.seed, 6, 5);
  const warp = createNoise(surface.seed + 53, 4, 7);
  const detail = createNoise(surface.seed + 149, 5, 26);
  const seaLevel = 0.52;

  return (u, v, out) => {
    // Domain warping breaks up the blobby look of raw fBm into real coastlines.
    const wu = u + (warp(u, v) - 0.5) * 0.09;
    const wv = clamp(v + (warp(u + 0.37, v) - 0.5) * 0.05, 0, 1);
    const elevation = contrast(continents(wu, wv), 2.6, 0.47) + (detail(u, v) - 0.5) * 0.08;

    if (elevation < seaLevel) {
      const shelf = smoothstep(seaLevel - 0.2, seaLevel, elevation);
      out[0] = deep[0] + (shallow[0] - deep[0]) * shelf;
      out[1] = deep[1] + (shallow[1] - deep[1]) * shelf;
      out[2] = deep[2] + (shallow[2] - deep[2]) * shelf;
    } else {
      const latitude = Math.abs((v - 0.5) * 180);
      // Deserts cluster around the horse latitudes, give or take some noise.
      const desert = Math.exp(-(((latitude - 24) / 16) ** 2));
      const arid = clamp(desert * 0.8 + (detail(u, v) - 0.5) * 0.95 + 0.12, 0, 1);
      out[0] = forest[0] + (sand[0] - forest[0]) * arid;
      out[1] = forest[1] + (sand[1] - forest[1]) * arid;
      out[2] = forest[2] + (sand[2] - forest[2]) * arid;
      const highland = smoothstep(seaLevel + 0.22, seaLevel + 0.38, elevation);
      if (highland > 0) mixInto(out, ice, highland * 0.3);
    }

    const polar = Math.abs(v - 0.5) * 2;
    const frost = smoothstep(0.87, 0.975, polar + (detail(u, v) - 0.5) * 0.08);
    if (frost > 0) mixInto(out, ice, frost * 0.92);
  };
}

function cloudyPainter(surface) {
  const ramp = makeRamp(luminanceSorted(surface.palette));
  const base = createNoise(surface.seed, 5, 8);
  const swirlNoise = createNoise(surface.seed + 73, 4, 6);
  const swirl = surface.swirl ?? 2;

  return (u, v, out) => {
    // Shear the sample along latitude so the cloud deck looks super-rotated.
    const shear = (swirlNoise(u, v) - 0.5) * 0.18 + Math.sin(v * Math.PI * swirl) * 0.06;
    let value = contrast(base(u + shear, v * 0.92 + 0.04), 2.0, 0.45);
    value += Math.sin(v * Math.PI * 7) * 0.045;
    ramp(clamp(value, 0, 1), out);
    const polar = Math.abs(v - 0.5) * 2;
    scaleRgb(out, 1 - smoothstep(0.7, 1, polar) * 0.28);
  };
}

function icyPainter(surface) {
  const ramp = makeRamp(luminanceSorted(surface.palette));
  const base = createNoise(surface.seed, 5, 7);
  const detail = createNoise(surface.seed + 89, 4, 20);

  return (u, v, out) => {
    const value = contrast(base(u, v), 1.35, 0.47) + (detail(u, v) - 0.5) * 0.12;
    ramp(clamp(value, 0, 1), out);
  };
}

const PAINTERS = {
  rocky: rockyPainter,
  banded: bandedPainter,
  terran: terranPainter,
  cloudy: cloudyPainter,
  icy: icyPainter,
};

// --- stamped detail ---------------------------------------------------------

function drawCraters(ctx, surface, width, height) {
  const rng = makeRng(surface.seed * 97 + 5);
  const scale = surface.craterScale ?? 1;

  for (let i = 0; i < surface.craters; i++) {
    const u = rng();
    const v = 0.5 + (rng() * 2 - 1) * 0.44;
    // A steep power keeps most craters small with a few basin-sized outliers.
    const radius = (0.0025 + Math.pow(rng(), 3.4) * 0.045) * width * scale;
    // Every crater at the same contrast reads as bubble wrap, so vary it.
    const strength = 0.3 + rng() * 0.7;
    // Equirectangular maps stretch horizontally near the poles; widen to match.
    const stretch = Math.min(4, 1 / Math.max(0.25, Math.sin(v * Math.PI)));
    const x = u * width;
    const y = v * height;

    for (const offset of [-width, 0, width]) {
      if (x + offset < -radius * stretch || x + offset > width + radius * stretch) continue;
      ctx.save();
      ctx.translate(x + offset, y);
      ctx.scale(stretch, 1);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      gradient.addColorStop(0, `rgba(0,0,0,${(0.17 * strength).toFixed(3)})`);
      gradient.addColorStop(0.62, `rgba(0,0,0,${(0.09 * strength).toFixed(3)})`);
      gradient.addColorStop(0.84, `rgba(255,255,255,${(0.045 * strength).toFixed(3)})`);
      gradient.addColorStop(0.95, `rgba(255,255,255,${(0.075 * strength).toFixed(3)})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawCracks(ctx, surface, width, height) {
  const rng = makeRng(surface.seed * 31 + 11);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < surface.cracks; i++) {
    let x = rng() * width;
    let y = (0.14 + rng() * 0.72) * height;
    let angle = rng() * TAU;
    const length = (0.12 + rng() * 0.5) * width;
    const steps = 26;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < steps; s++) {
      angle += (rng() - 0.5) * 0.45;
      x += (Math.cos(angle) * length) / steps;
      y += ((Math.sin(angle) * length) / steps) * 0.45;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(146,92,60,${(0.16 + rng() * 0.22).toFixed(3)})`;
    ctx.lineWidth = 1 + rng() * 2.4;
    ctx.stroke();
  }
}

// --- public generators ------------------------------------------------------

export function createSurfaceTexture(surface, width) {
  const height = width >> 1;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const paint = (PAINTERS[surface.style] ?? rockyPainter)(surface);
  const rgb = [0, 0, 0];

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      paint((x + 0.5) / width, v, rgb);
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  if (surface.craters) drawCraters(ctx, surface, width, height);
  if (surface.cracks) drawCracks(ctx, surface, width, height);
  return toTexture(canvas);
}

export function createCloudTexture(spec, width) {
  const height = width >> 1;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const broad = createNoise(spec.seed, 6, 6);
  const wisps = createNoise(spec.seed + 17, 4, 14);
  const threshold = 1 - spec.coverage;

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    // Cloud bands: thick at the equator and mid-latitudes, thin over the subtropics.
    const banding = Math.sin(v * Math.PI * 7) * 0.05;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const value = contrast(broad(u, v) * 0.72 + wisps(u, v) * 0.28, 2.2, 0.48) + banding;
      const alpha = smoothstep(threshold - 0.08, threshold + 0.18, value);
      const i = (y * width + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return toTexture(canvas);
}

/**
 * Rings are a one-dimensional strip: UVs on the ring mesh are rewritten so `u`
 * runs from the inner edge to the outer edge.
 */
export function createRingTexture(spec) {
  const width = 1024;
  const canvas = createCanvas(width, 1);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, 1);
  const data = image.data;
  const ramp = makeRamp(luminanceSorted(spec.palette));
  const coarse = createNoise(spec.seed, 4, 6);
  const fine = createNoise(spec.seed + 19, 5, 40);
  const rgb = [0, 0, 0];

  for (let x = 0; x < width; x++) {
    const t = x / (width - 1);
    const ringlets = 0.5 + 0.5 * Math.sin(t * 190 + fine(t, 0.5) * 9);
    let density = coarse(t, 0.5) * 0.6 + ringlets * 0.4;
    density *= smoothstep(0, 0.05, t) * (1 - smoothstep(0.9, 1, t));
    // The Cassini division and a softer inner gap.
    density *= 1 - 0.95 * Math.exp(-(((t - 0.63) / 0.022) ** 2));
    density *= 1 - 0.55 * Math.exp(-(((t - 0.24) / 0.018) ** 2));

    ramp(clamp(density * 1.35, 0, 1), rgb);
    const i = x * 4;
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = Math.round(clamp(density * 1.6, 0, 1) * 255);
  }
  ctx.putImageData(image, 0, 0);
  return toTexture(canvas, { repeat: false });
}

export function createSunTexture(width) {
  const height = width >> 1;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const granules = createNoise(401, 5, 26);
  const cells = createNoise(97, 4, 9);
  const ramp = makeRamp(['#7d2403', '#c94c08', '#f88b1c', '#ffd07a', '#fff4d6']);
  const rgb = [0, 0, 0];

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const value = contrast(granules(u, v) * 0.55 + cells(u, v) * 0.45, 1.9, 0.46);
      ramp(clamp(value * 0.82 + 0.24, 0, 1), rgb);
      const i = (y * width + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return toTexture(canvas);
}

/** Soft additive halo used for the Sun's glow and corona. */
export function createGlowTexture(stops) {
  const size = 256;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas, { repeat: false });
}

export function createStarTexture() {
  const size = 64;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  gradient.addColorStop(0.55, 'rgba(190,215,255,0.18)');
  gradient.addColorStop(1, 'rgba(140,170,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas, { repeat: false });
}

/**
 * A faint galactic band for the sky background. The band is defined against a
 * tilted plane in 3D, so it reads as a great circle rather than a UV stripe.
 */
export function createSkyTexture(width) {
  const height = width >> 1;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const clouds = createNoise(613, 6, 9);
  const dust = createNoise(929, 5, 20);

  // Normal of the galactic plane, tilted so the band cuts the view diagonally.
  const nx = 0.39;
  const ny = 0.83;
  const nz = -0.4;
  const norm = Math.hypot(nx, ny, nz);

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const theta = u * TAU;
      const dx = sinPhi * Math.cos(theta);
      const dy = cosPhi;
      const dz = sinPhi * Math.sin(theta);
      const distance = (dx * nx + dy * ny + dz * nz) / norm;

      const band = Math.exp(-((distance / 0.15) ** 2));
      const texture = clouds(u, v) * 0.65 + dust(u, v) * 0.35;
      const intensity = band * (0.25 + texture * 0.95);
      const lane = 1 - 0.45 * Math.exp(-((distance / 0.045) ** 2)) * texture;

      const i = (y * width + x) * 4;
      // Keep the off-band sky nearly black: a visible ambient tint reads as a
      // rendering artefact rather than as the galaxy.
      data[i] = Math.round(clamp(intensity * lane * 40 + texture * 1.5, 0, 255));
      data[i + 1] = Math.round(clamp(intensity * lane * 35 + texture * 1.8, 0, 255));
      data[i + 2] = Math.round(clamp(intensity * lane * 58 + texture * 3.4, 0, 255));
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = toTexture(canvas, { repeat: false });
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}
