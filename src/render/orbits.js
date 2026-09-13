/**
 * Static orbit paths. The ellipse is sampled in eccentric anomaly, which gives
 * even coverage without solving Kepler's equation, then pushed through the same
 * radial compression as everything else so it lines up with the planet.
 */

import * as THREE from 'three';
import { TAU } from '../util/math.js';
import { elementsAt, positionAtEccentricAnomaly } from '../core/kepler.js';
import { auToScene } from '../core/scale.js';

const BASE_OPACITY = 0.14;
const FOCUS_OPACITY = 0.55;

export function createOrbitPaths(planets, julianDay, segments) {
  const group = new THREE.Group();
  const paths = new Map();

  for (const planet of planets) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array((segments + 1) * 3), 3)
    );
    const material = new THREE.LineBasicMaterial({
      color: planet.data.color,
      transparent: true,
      opacity: BASE_OPACITY,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    group.add(line);
    paths.set(planet.id, { line, material, planet });
  }

  const scratchAu = { x: 0, y: 0, z: 0 };
  const scratchScene = new THREE.Vector3();

  function rebuild(jd) {
    for (const { line, planet } of paths.values()) {
      const elements = elementsAt(planet.data.elements, jd);
      const array = line.geometry.attributes.position.array;
      for (let i = 0; i <= segments; i++) {
        positionAtEccentricAnomaly(elements, (i / segments) * TAU, scratchAu);
        auToScene(scratchAu, scratchScene);
        array[i * 3] = scratchScene.x;
        array[i * 3 + 1] = scratchScene.y;
        array[i * 3 + 2] = scratchScene.z;
      }
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
  }

  rebuild(julianDay);
  let builtAt = julianDay;

  return {
    group,

    setVisible(visible) {
      group.visible = visible;
    },

    /** Brightens the orbit belonging to the focused body. */
    setFocus(bodyId) {
      for (const [id, entry] of paths) {
        entry.material.opacity = id === bodyId ? FOCUS_OPACITY : BASE_OPACITY;
      }
    },

    /**
     * Elements drift slowly, so the paths only need redrawing when the clock
     * has moved by a meaningful fraction of a century.
     */
    update(jd) {
      if (Math.abs(jd - builtAt) > 1826) {
        rebuild(jd);
        builtAt = jd;
      }
    },
  };
}
