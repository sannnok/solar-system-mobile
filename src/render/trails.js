/**
 * Orbital trails.
 *
 * Rather than recording where a planet has been, each trail is solved backwards
 * from the current time. That makes it exact at any simulation speed, immune to
 * frame-rate hitches, and correct the instant the clock is scrubbed or paused.
 *
 * Trail length follows the simulation rate — fast-moving inner planets streak,
 * Neptune leaves a short arc — with floor and ceiling clamps so every body
 * always shows something and nothing ever laps its own orbit.
 */

import * as THREE from 'three';
import { clamp } from '../util/math.js';
import { heliocentricPosition, orbitalPeriodDays } from '../core/kepler.js';
import { auToScene } from '../core/scale.js';

const TRAIL_SECONDS = 6;
const MIN_FRACTION = 0.035;
const MAX_FRACTION = 0.32;

export function createTrails(planets, segments) {
  const group = new THREE.Group();
  const trails = [];

  for (const planet of planets) {
    const count = segments + 1;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;

    const color = new THREE.Color(planet.data.color);
    // Additive blending means fading to black is fading to invisible.
    const colors = geometry.attributes.color.array;
    for (let i = 0; i <= segments; i++) {
      const fade = Math.pow(1 - i / segments, 1.7);
      colors[i * 3] = color.r * fade;
      colors[i * 3 + 1] = color.g * fade;
      colors[i * 3 + 2] = color.b * fade;
    }
    geometry.attributes.color.needsUpdate = true;

    group.add(line);
    trails.push({ planet, line, period: orbitalPeriodDays(planet.data.elements.a[0]) });
  }

  const scratchAu = { x: 0, y: 0, z: 0 };
  const scratchScene = new THREE.Vector3();
  let lastJulianDay = NaN;
  let lastRate = NaN;

  return {
    group,

    setVisible(visible) {
      group.visible = visible;
      if (visible) lastJulianDay = NaN;
    },

    update(julianDay, daysPerSecond) {
      if (!group.visible) return;
      // Nothing to redraw while the clock and the rate are both holding still.
      if (julianDay === lastJulianDay && daysPerSecond === lastRate) return;
      lastJulianDay = julianDay;
      lastRate = daysPerSecond;

      for (const trail of trails) {
        const span = clamp(
          Math.abs(daysPerSecond) * TRAIL_SECONDS,
          trail.period * MIN_FRACTION,
          trail.period * MAX_FRACTION
        );
        const array = trail.line.geometry.attributes.position.array;
        for (let i = 0; i <= segments; i++) {
          const jd = julianDay - (i / segments) * span;
          heliocentricPosition(trail.planet.data.elements, jd, scratchAu);
          auToScene(scratchAu, scratchScene);
          array[i * 3] = scratchScene.x;
          array[i * 3 + 1] = scratchScene.y;
          array[i * 3 + 2] = scratchScene.z;
        }
        trail.line.geometry.attributes.position.needsUpdate = true;
        trail.line.geometry.computeBoundingSphere();
      }
    },
  };
}
