/**
 * Orrery — an interactive 3D solar system.
 *
 * Planet positions come from real Keplerian elements, so the clock in the
 * corner is not decoration: what you see is roughly where the planets actually
 * are on that date.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import { PLANETS, SUN } from './data/bodies.js';
import { Simulation } from './core/simulation.js';
import { createSolarSystem } from './render/system.js';
import { createOrbitPaths } from './render/orbits.js';
import { createTrails } from './render/trails.js';
import { createStarfield } from './render/starfield.js';
import { configureTextures, createSkyTexture } from './render/textures.js';
import { createFocusController } from './camera/focus.js';
import { createLabels } from './ui/labels.js';
import { createPicker } from './ui/picker.js';
import { createInfoPanel } from './ui/infoPanel.js';
import { createControls } from './ui/controls.js';
import { dateToJulian } from './util/time.js';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Phones and low-core laptops get smaller textures and coarser geometry. The
 * texture painters are the main cost at startup, so that is where the savings
 * are worth the most.
 */
function detectQuality() {
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 700;
  const fewCores = (navigator.hardwareConcurrency ?? 4) <= 4;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const light = smallScreen || (fewCores && coarsePointer);

  return {
    light,
    textureSize: light ? 512 : 1024,
    moonTextureSize: light ? 128 : 256,
    skySize: light ? 512 : 1024,
    sphereSegments: light ? 40 : 64,
    moonSegments: light ? 20 : 32,
    ringSegments: light ? 96 : 180,
    orbitSegments: light ? 220 : 420,
    trailSegments: light ? 56 : 96,
    stars: light ? 2400 : 6000,
    pixelRatio: Math.min(window.devicePixelRatio || 1, light ? 2 : 2),
    antialias: !light,
  };
}

function showFatalError(message) {
  const loader = document.getElementById('loader');
  loader.innerHTML = `<p class="loader__text">${message}</p>`;
  loader.classList.remove('is-done');
}

async function start() {
  const canvas = document.getElementById('scene');
  const loader = document.getElementById('loader');
  const loaderFill = document.getElementById('loader-fill');
  const hint = document.getElementById('hint');
  const quality = detectQuality();

  const setProgress = (fraction) => {
    loaderFill.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
  };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      powerPreference: 'high-performance',
      alpha: false,
    });
  } catch (error) {
    showFatalError('WebGL is unavailable in this browser.');
    throw error;
  }

  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  configureTextures(renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    50,
    canvas.clientWidth / canvas.clientHeight,
    0.02,
    12000
  );

  const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });
  labelRenderer.setSize(canvas.clientWidth, canvas.clientHeight);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.5;
  controls.zoomSpeed = 0.85;
  // Panning would fight the follow-the-planet camera, and it is an easy way to
  // get lost in a scene this empty.
  controls.enablePan = false;
  controls.minDistance = 3;
  controls.maxDistance = 1400;

  setProgress(0.06);
  await new Promise((resolve) => requestAnimationFrame(resolve));

  scene.background = createSkyTexture(quality.skySize);
  scene.backgroundIntensity = 1;
  setProgress(0.18);
  await new Promise((resolve) => requestAnimationFrame(resolve));

  scene.add(createStarfield({ count: quality.stars }));
  setProgress(0.26);
  await new Promise((resolve) => requestAnimationFrame(resolve));

  const system = await createSolarSystem({
    sunData: SUN,
    planetData: PLANETS,
    quality,
    onProgress: (fraction) => setProgress(0.26 + fraction * 0.64),
  });
  scene.add(system.root);

  const simulation = new Simulation({ startJd: dateToJulian(new Date()) });
  const view = { camera, pixelScale: 0.001 };
  system.update(simulation.julianDay, 0, view);

  const orbitPaths = createOrbitPaths(system.planets, simulation.julianDay, quality.orbitSegments);
  scene.add(orbitPaths.group);
  const trails = createTrails(system.planets, quality.trailSegments);
  scene.add(trails.group);
  setProgress(0.97);

  const focusController = createFocusController({
    camera,
    controls,
    reducedMotion: prefersReducedMotion,
  });
  focusController.snapToOverview();

  const labels = createLabels({ system, camera, focus: focusController });
  const infoPanel = createInfoPanel({ onClose: () => selectBody(null) });
  const panelElement = document.getElementById('info-panel');
  const topbarElement = document.querySelector('.topbar');
  const dockElement = document.querySelector('.dock');

  /**
   * The chrome is not symmetrical: a top bar, a tall dock, and on narrow
   * screens an info sheet that would otherwise sit right on top of the planet
   * you just tapped. Skewing the frustum centres the scene in whatever space is
   * actually visible — and because it works through the projection matrix,
   * labels and picking stay in agreement with what is drawn.
   */
  function updateViewOffset() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    const headerBottom = topbarElement.getBoundingClientRect().bottom;
    let bottom = dockElement.getBoundingClientRect().top;
    if (window.innerWidth < 860 && !panelElement.hidden) {
      bottom = Math.min(bottom, panelElement.getBoundingClientRect().top);
    }

    const visibleCentre = (headerBottom + bottom) / 2;
    const shift = height / 2 - visibleCentre;
    if (Math.abs(shift) < 2) camera.clearViewOffset();
    else camera.setViewOffset(width, height, 0, shift, width, height);
  }

  if (!window.matchMedia('(pointer: coarse)').matches) {
    hint.textContent = 'Click a planet to follow it';
  }

  let hintDismissed = false;
  function dismissHint() {
    if (hintDismissed) return;
    hintDismissed = true;
    hint.classList.add('is-hidden');
  }

  function selectBody(body) {
    focusController.focus(body);
    orbitPaths.setFocus(body?.kind === 'moon' ? body.parent.id : body?.id ?? null);
    hud.setFocus(body?.kind === 'moon' ? body.parent : body);
    if (body) {
      infoPanel.show(body);
      dismissHint();
    } else {
      infoPanel.hide();
    }
    updateViewOffset();
  }

  const layers = { labels: true, orbits: true, trails: true };
  function setLayer(name, on) {
    layers[name] = on;
    if (name === 'labels') labels.setEnabled(on);
    if (name === 'orbits') {
      orbitPaths.setVisible(on);
      system.setMoonOrbitsVisible(on);
    }
    if (name === 'trails') trails.setVisible(on);
    hud.setToggleState(name, on);
  }

  const hud = createControls({
    simulation,
    system,
    actions: {
      focus: (body) => selectBody(body),
      resetView: () => selectBody(null),
      jumpToNow: () => simulation.setJulianDay(dateToJulian(new Date())),
      toggleLabels: () => setLayer('labels', !layers.labels),
      toggleOrbits: () => setLayer('orbits', !layers.orbits),
      toggleTrails: () => setLayer('trails', !layers.trails),
    },
  });
  for (const name of Object.keys(layers)) hud.setToggleState(name, layers[name]);
  // Paint the clock once up front; the loop only refreshes it ten times a second.
  hud.updateClock(simulation.julianDay);

  createPicker({
    canvas,
    camera,
    system,
    onPick: (body) => selectBody(body),
    onHoverChange: (body) => canvas.classList.toggle('is-hovering', Boolean(body)),
  });

  // Labels are buttons, so clicking one selects its body.
  document.getElementById('labels').addEventListener('click', (event) => {
    const element = event.target.closest('[data-body-id]');
    if (!element) return;
    const body = system.focusable.find((candidate) => candidate.id === element.dataset.bodyId);
    if (body) selectBody(body);
  });

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    const onSlider = target instanceof HTMLInputElement;
    // Space activates a focused button on its own; handling it here as well
    // would toggle the simulation twice.
    const onControl =
      target instanceof HTMLElement && target.closest('button, input, select, textarea') !== null;

    switch (event.key) {
      case ' ':
        if (onControl) return;
        event.preventDefault();
        simulation.togglePaused();
        break;
      case 'ArrowRight':
      case 'ArrowLeft': {
        if (onSlider) return;
        event.preventDefault();
        const order = system.all;
        const index = order.indexOf(focusController.focused);
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = (index + step + order.length) % order.length;
        selectBody(order[index === -1 && step === -1 ? order.length - 1 : next]);
        break;
      }
      case 'Escape':
        selectBody(null);
        break;
      case 'l':
      case 'L':
        if (onSlider) return;
        setLayer('labels', !layers.labels);
        break;
      case 'o':
      case 'O':
        if (onSlider) return;
        setLayer('orbits', !layers.orbits);
        break;
      case 't':
      case 'T':
        if (onSlider) return;
        setLayer('trails', !layers.trails);
        break;
      default:
        break;
    }
  });

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    renderer.setSize(width, height, false);
    labelRenderer.setSize(width, height);
    updateViewOffset();
    focusController.handleResize();
  }

  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(canvas);
  resize();

  let elapsed = 0;
  let lastFrame = performance.now();
  let hudAccumulator = 0;
  const startedAt = performance.now();

  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    elapsed += dt;

    simulation.advance(dt);
    view.pixelScale = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, canvas.clientHeight);
    system.update(simulation.julianDay, elapsed, view);
    orbitPaths.update(simulation.julianDay);
    // Target rate, not the eased one: pausing should freeze the trails, not
    // shrink them as the eased rate falls to zero.
    trails.update(simulation.julianDay, simulation.targetRate);

    focusController.update(dt);
    controls.update();

    // A near plane tied to the viewing distance keeps depth precision sane
    // across a scene that spans four orders of magnitude.
    const viewDistance = camera.position.distanceTo(controls.target);
    const near = Math.max(0.008, viewDistance * 0.004);
    if (Math.abs(near - camera.near) > near * 0.05) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }

    labels.update();

    // Text only needs to keep up with reading speed, not frame rate.
    hudAccumulator += dt;
    if (hudAccumulator > 0.1) {
      hudAccumulator = 0;
      hud.updateClock(simulation.julianDay);
      infoPanel.updateLive(system);
    }

    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);

    if (!hintDismissed && performance.now() - startedAt > 11000) dismissHint();
  });

  setProgress(1);
  loader.classList.add('is-done');
  window.setTimeout(() => {
    loader.hidden = true;
  }, 800);
}

start().catch((error) => {
  console.error(error);
  showFatalError('Something went wrong starting the orrery.');
});
