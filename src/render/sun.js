/**
 * The Sun: a self-lit sphere, an additive halo, and the single light source
 * everything else in the scene is lit by.
 */

import * as THREE from 'three';
import { TAU } from '../util/math.js';
import { createGlowTexture, createSunTexture } from './textures.js';

export function createSun({ radius, textureSize, segments }) {
  const group = new THREE.Group();

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, segments >> 1),
    new THREE.MeshBasicMaterial({ map: createSunTexture(textureSize), toneMapped: false })
  );
  mesh.name = 'sun-surface';
  group.add(mesh);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createGlowTexture([
        [0, 'rgba(255,246,214,0.95)'],
        [0.18, 'rgba(255,197,96,0.55)'],
        [0.45, 'rgba(255,138,40,0.16)'],
        [1, 'rgba(255,110,20,0)'],
      ]),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  );
  glow.scale.setScalar(radius * 7.5);
  group.add(glow);

  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createGlowTexture([
        [0, 'rgba(255,214,150,0.30)'],
        [0.35, 'rgba(255,150,60,0.09)'],
        [1, 'rgba(255,120,40,0)'],
      ]),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  );
  corona.scale.setScalar(radius * 15);
  group.add(corona);

  // decay 0 keeps Neptune lit; a physically correct falloff would leave the
  // outer system in total darkness.
  const light = new THREE.PointLight(0xfff3e2, 3.1, 0, 0);
  group.add(light);
  // Just enough fill that a planet's night side reads as dark blue rather
  // than a hole punched in the star field.
  group.add(new THREE.AmbientLight(0x2f3c63, 0.72));

  const spinPerDay = TAU / 25.38;

  return {
    group,
    mesh,
    radius,
    /** `elapsed` is real seconds, so the breathing continues while paused. */
    update(elapsed, julianDay) {
      mesh.rotation.y = (julianDay * spinPerDay) % TAU;
      const pulse = 1 + Math.sin(elapsed * 0.6) * 0.02 + Math.sin(elapsed * 1.37) * 0.012;
      corona.scale.setScalar(radius * 15 * pulse);
      glow.scale.setScalar(radius * 7.5 * (1 + Math.sin(elapsed * 0.9 + 1.2) * 0.015));
    },
  };
}
