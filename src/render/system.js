/**
 * Builds the scene graph for the Sun, planets, rings and moons, and advances
 * it every frame.
 *
 * Hierarchy per planet:
 *   anchor      - sits at the heliocentric position, never rotates
 *   tiltGroup   - carries the axial tilt; rings and moons live in this plane
 *   spinGroup   - the planet's own rotation
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { DEG, TAU } from '../util/math.js';
import { heliocentricPosition } from '../core/kepler.js';
import {
  auToScene,
  auDistance,
  sceneMoonOrbit,
  sceneMoonRadius,
  sceneRadiusFromKm,
} from '../core/scale.js';
import { createSurfaceTexture, createCloudTexture, createRingTexture, createGlowTexture } from './textures.js';
import { smoothstep } from './noise.js';
import { createSun } from './sun.js';

const HOURS_PER_DAY = 24;

/**
 * From an overview, Earth is about three pixels across. A soft additive halo
 * keeps every planet findable at that size and fades out as you approach, so it
 * never becomes a glow stuck to a planet you are looking at up close.
 */
const HALO_MIN_PIXELS = 13;
const HALO_FADE_START_PX = 7;
const HALO_FADE_END_PX = 30;

let haloTexture = null;

function getHaloTexture() {
  if (!haloTexture) {
    haloTexture = createGlowTexture([
      [0, 'rgba(255,255,255,0.85)'],
      [0.22, 'rgba(255,255,255,0.36)'],
      [0.55, 'rgba(255,255,255,0.08)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
  }
  return haloTexture;
}

function makeLabel(body, kind) {
  const element = document.createElement('button');
  element.className = `label label--${kind}`;
  element.type = 'button';
  element.dataset.bodyId = body.id;
  element.innerHTML = `<span class="label__dot"></span><span class="label__text">${body.name}</span>`;
  const object = new CSS2DObject(element);
  // Sit centred just above the body: tidier than hanging off one side, and it
  // halves how far a label overhangs the viewport edge on a phone.
  object.center.set(0.5, 1);
  return { element, object };
}

function createRings(spec, planetRadius, segments) {
  const inner = planetRadius * spec.innerRadii;
  const outer = planetRadius * spec.outerRadii;
  const geometry = new THREE.RingGeometry(inner, outer, segments, 1);

  // RingGeometry's default UVs are a bounding box; rewrite them so u runs
  // radially and a one-dimensional ring texture maps correctly.
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    const t = (vertex.length() - inner) / (outer - inner);
    uv.setXY(i, Math.min(1, Math.max(0, t)), 0.5);
  }
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshBasicMaterial({
    map: createRingTexture(spec),
    transparent: true,
    opacity: spec.opacity ?? 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1;
  return mesh;
}

function createMoon(data, parent, quality) {
  const radius = sceneMoonRadius(parent.data.radiusKm, parent.radius, data.radiusKm);
  const orbitRadius = sceneMoonOrbit(parent.data.radiusKm, parent.radius, data.orbitKm);

  const anchor = new THREE.Object3D();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, quality.moonSegments, quality.moonSegments >> 1),
    new THREE.MeshStandardMaterial({
      map: createSurfaceTexture(data.surface, quality.moonTextureSize),
      roughness: 0.95,
      metalness: 0,
    })
  );
  anchor.add(mesh);

  const orbitGeometry = new THREE.BufferGeometry();
  const points = new Float32Array(97 * 3);
  for (let i = 0; i < 97; i++) {
    const angle = (i / 96) * TAU;
    points[i * 3] = Math.cos(angle) * orbitRadius;
    points[i * 3 + 2] = Math.sin(angle) * orbitRadius;
  }
  orbitGeometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const orbitLine = new THREE.Line(
    orbitGeometry,
    new THREE.LineBasicMaterial({ color: data.color, transparent: true, opacity: 0.18, depthWrite: false })
  );

  const { element, object } = makeLabel(data, 'moon');
  object.position.y = radius * 2.4;
  anchor.add(object);

  return {
    id: data.id,
    name: data.name,
    kind: 'moon',
    data,
    parent,
    radius,
    orbitRadius,
    anchor,
    mesh,
    orbitLine,
    label: object,
    labelElement: element,
    moons: [],
    worldPosition: new THREE.Vector3(),
  };
}

function createPlanet(data, quality) {
  const radius = sceneRadiusFromKm(data.radiusKm);
  const anchor = new THREE.Object3D();

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: getHaloTexture(),
      color: data.color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  );
  anchor.add(halo);

  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.z = (data.axialTilt ?? 0) * DEG;
  anchor.add(tiltGroup);

  const spinGroup = new THREE.Group();
  tiltGroup.add(spinGroup);

  const segments = data.kind === 'dwarf' ? quality.moonSegments : quality.sphereSegments;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, segments >> 1),
    new THREE.MeshStandardMaterial({
      map: createSurfaceTexture(data.surface, quality.textureSize),
      roughness: data.surface.style === 'banded' ? 0.95 : 0.88,
      metalness: 0,
    })
  );
  spinGroup.add(mesh);

  let cloudMesh = null;
  if (data.surface.clouds) {
    cloudMesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.015, segments, segments >> 1),
      new THREE.MeshStandardMaterial({
        map: createCloudTexture(data.surface.clouds, quality.textureSize),
        transparent: true,
        opacity: data.surface.clouds.opacity,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
      })
    );
    tiltGroup.add(cloudMesh);
  }

  if (data.rings) tiltGroup.add(createRings(data.rings, radius, quality.ringSegments));

  const { element, object } = makeLabel(data, data.kind);
  object.position.y = radius * 1.9;
  anchor.add(object);

  const body = {
    id: data.id,
    name: data.name,
    kind: data.kind,
    data,
    radius,
    anchor,
    tiltGroup,
    spinGroup,
    mesh,
    cloudMesh,
    halo,
    label: object,
    labelElement: element,
    positionAu: { x: 0, y: 0, z: 0 },
    distanceAu: 0,
    worldPosition: new THREE.Vector3(),
    moons: [],
  };

  for (const moonData of data.moons ?? []) {
    const moon = createMoon(moonData, body, quality);
    tiltGroup.add(moon.anchor);
    tiltGroup.add(moon.orbitLine);
    body.moons.push(moon);
  }

  return body;
}

/** Yields to the browser so the loading screen keeps animating while we paint. */
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function createSolarSystem({ sunData, planetData, quality, onProgress }) {
  const root = new THREE.Group();
  const totalSteps = 1 + planetData.length;
  let completed = 0;

  // Texture painting is the expensive part of setup, so each body gets its own
  // frame. The app stays responsive and the progress bar tells the truth.
  const step = async () => {
    completed += 1;
    onProgress?.(completed / totalSteps);
    await nextFrame();
  };

  const sun = createSun({
    radius: sceneRadiusFromKm(sunData.radiusKm),
    textureSize: quality.textureSize,
    segments: quality.sphereSegments,
  });
  root.add(sun.group);

  const sunBody = {
    id: sunData.id,
    name: sunData.name,
    kind: 'star',
    data: sunData,
    radius: sun.radius,
    anchor: sun.group,
    mesh: sun.mesh,
    label: null,
    labelElement: null,
    positionAu: { x: 0, y: 0, z: 0 },
    distanceAu: 0,
    worldPosition: new THREE.Vector3(),
    moons: [],
  };

  const sunLabel = makeLabel(sunData, 'star');
  sunLabel.object.position.y = sun.radius * 1.35;
  sun.group.add(sunLabel.object);
  sunBody.label = sunLabel.object;
  sunBody.labelElement = sunLabel.element;

  await step();

  const planets = [];
  for (const data of planetData) {
    const planet = createPlanet(data, quality);
    root.add(planet.anchor);
    planets.push(planet);
    await step();
  }

  const all = [sunBody, ...planets];
  const focusable = [sunBody];
  for (const planet of planets) {
    focusable.push(planet, ...planet.moons);
  }
  const pickable = focusable.map((body) => body.mesh);

  return {
    root,
    sun,
    sunBody,
    planets,
    all,
    /** Sun, planets and moons — everything you can click or focus. */
    focusable,
    pickable,

    setMoonOrbitsVisible(visible) {
      for (const planet of planets) {
        for (const moon of planet.moons) moon.orbitLine.visible = visible;
      }
    },

    /**
     * `view` carries the camera and how many world units a screen pixel covers
     * at unit distance, which is what the halo sizing needs.
     */
    update(julianDay, elapsed, view) {
      sun.update(elapsed, julianDay);
      sunBody.anchor.getWorldPosition(sunBody.worldPosition);

      for (const planet of planets) {
        heliocentricPosition(planet.data.elements, julianDay, planet.positionAu);
        planet.distanceAu = auDistance(planet.positionAu);
        auToScene(planet.positionAu, planet.anchor.position);
        planet.anchor.getWorldPosition(planet.worldPosition);

        const rotationHours = planet.data.rotationHours || 24;
        const turns = (julianDay * HOURS_PER_DAY) / rotationHours;
        planet.spinGroup.rotation.y = (turns % 1) * TAU;
        if (planet.cloudMesh) {
          // Clouds super-rotate slightly, which sells the atmosphere.
          planet.cloudMesh.rotation.y = ((turns * 1.08) % 1) * TAU;
        }

        if (view) {
          const distance = view.camera.position.distanceTo(planet.worldPosition);
          const apparentPx = planet.radius / (distance * view.pixelScale);
          const fade = smoothstep(HALO_FADE_END_PX, HALO_FADE_START_PX, apparentPx);
          planet.halo.visible = fade > 0.015;
          if (planet.halo.visible) {
            planet.halo.material.opacity = 0.72 * fade;
            planet.halo.scale.setScalar(
              Math.max(planet.radius * 4, distance * view.pixelScale * HALO_MIN_PIXELS)
            );
          }
        }

        for (const moon of planet.moons) {
          const angle = ((julianDay / moon.data.periodDays) % 1) * TAU;
          moon.anchor.position.set(
            Math.cos(angle) * moon.orbitRadius,
            0,
            Math.sin(angle) * moon.orbitRadius
          );
          // Tidally locked: the same face always points at the planet.
          moon.mesh.rotation.y = -angle;
          moon.anchor.getWorldPosition(moon.worldPosition);
        }
      }
    },
  };
}
