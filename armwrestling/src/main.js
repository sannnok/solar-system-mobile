/**
 * ArmLab — interactive armwrestling biomechanics, built to run as a Telegram
 * Mini App (and in any browser).
 *
 * Each frame: advance the rep clock → pose the arm → resolve muscle tubes and
 * their activation → draw force vectors and joint readouts → render.
 */

import * as THREE from 'three';

import { MUSCLES } from './data/anatomy.js';
import { EXERCISES, activationsAt, effort, phaseAt, poseAt } from './data/exercises.js';
import { CameraRig, VIEWS } from './render/camera.js';
import { MuscleSystem } from './render/muscles.js';
import { Overlays } from './render/overlays.js';
import { Rig } from './render/rig.js';
import { createStage } from './render/stage.js';
import { telegram } from './telegram.js';
import { createUI } from './ui.js';

const BACKGROUND = '#070b12';
const PEAK_PHASE = 2;

telegram.init(BACKGROUND);

// ── scene ──────────────────────────────────────────────────────────────────

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();

// The rig is authored as a mirror image (see render/rig.js); flipping x makes it
// a right arm. three.js flips face culling for negative scale on its own.
const mirrored = new THREE.Group();
mirrored.scale.x = -1;
scene.add(mirrored);
createStage(scene, mirrored);

const rig = new Rig();
const ghost = new Rig({ ghost: true });
ghost.root.visible = false;
mirrored.add(rig.root, ghost.root);
mirrored.updateMatrixWorld(true);

// Muscles and overlays are built from world-space points, so they sit outside the mirror.
const time = { value: 0 };
const muscles = new MuscleSystem(rig, MUSCLES, time);
scene.add(muscles.group);
muscles.captureRest();

const view = new CameraRig(canvas);
const overlays = new Overlays(scene, rig, document.getElementById('labels'));
const infoById = new Map(MUSCLES.map((m) => [m.id, m]));

// ── state & UI ─────────────────────────────────────────────────────────────

const state = {
  exercise: EXERCISES[0],
  u: 0,
  playing: true,
  speed: 1,
  mode: 'technique',
  layers: { muscles: true, bones: true, skin: true, vectors: true },
  selected: null,
  phase: -1,
  acts: {},
};

const ui = createUI({
  exercises: EXERCISES,
  views: VIEWS,
  layers: state.layers,
  on: {
    exercise: selectExercise,
    view(id) {
      view.go(id);
      ui.setView(id);
      telegram.haptic('select');
    },
    layer: setLayer,
    togglePlay: () => setPlaying(!state.playing),
    speed: (s) => (state.speed = s),
    scrub(u) {
      setPlaying(false);
      state.u = u;
    },
    mode: setMode,
    closeMuscle: () => selectMuscle(null),
    fullscreen: () => telegram.toggleFullscreen(),
  },
});

function selectExercise(id) {
  const index = Math.max(EXERCISES.findIndex((e) => e.id === id), 0);
  const ex = EXERCISES[index];
  state.exercise = ex;
  state.u = 0;
  state.phase = -1;
  ui.setExercise(ex, index);
  overlays.configure(ex);
  view.setShift(ex.cameraShift);
  view.go(ex.camera, !view.view);
  ui.setView(ex.camera);
  setPlaying(true);
  telegram.haptic('select');
  requestAnimationFrame(layout); // the error card's height may have changed
}

function setPlaying(playing) {
  state.playing = playing;
  ui.setPlaying(playing);
}

function setMode(mode) {
  state.mode = mode;
  ghost.root.visible = mode === 'error';
  ui.setMode(mode);
  telegram.haptic(mode === 'error' ? (state.exercise.error.danger ? 'error' : 'warning') : 'select');
  requestAnimationFrame(layout);
}

function setLayer(id, visible) {
  state.layers[id] = visible;
  if (id === 'muscles') muscles.group.visible = visible;
  else if (id === 'vectors') overlays.setVisible(visible);
  else rig.setLayer(id, visible);
  telegram.haptic('select');
}

function selectMuscle(id) {
  state.selected = id;
  muscles.select(id);
  if (id) {
    ui.openMuscle(infoById.get(id));
    ui.setMuscleLoad(state.acts[id] ?? 0);
    telegram.backButton(true, () => selectMuscle(null));
    telegram.haptic('light');
  } else {
    ui.closeMuscle();
    telegram.backButton(false);
  }
}

// ── Telegram chrome ────────────────────────────────────────────────────────

if (telegram.user?.first_name) {
  ui.el.hello.textContent = `Привет, ${telegram.user.first_name}! Разберём технику`;
}
if (!telegram.inside) ui.el.badge.textContent = 'прототип · браузер';
ui.el.fullscreen.hidden = !telegram.canFullscreen;
telegram.mainButton('Добавить в мою программу', () =>
  telegram.popup(
    'Это прототип',
    'В полной версии упражнение попадёт в твою программу, а бот напомнит о тренировке и запишет результат. Персональные программы — по подписке в Telegram Stars.',
  ),
);
telegram.on('viewportChanged', () => layout());
telegram.on('fullscreenChanged', () => requestAnimationFrame(layout));

// ── input: tap a muscle, keys ──────────────────────────────────────────────

const raycaster = new THREE.Raycaster();
let down = null;
canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 400;
  down = null;
  if (moved > 8 || !quick) return;
  if (!state.layers.muscles) return;
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, view.camera);
  const hit = muscles.pick(raycaster);
  if (hit) selectMuscle(hit.id);
  else if (state.selected) selectMuscle(null);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!state.playing);
  } else if (e.code === 'Escape') selectMuscle(null);
});

// ── layout ─────────────────────────────────────────────────────────────────

let width = 1;
let height = 1;

function layout() {
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  const covers = ui.covers();
  view.resize(width, height, covers.top, covers.bottom);
  const root = document.documentElement.style;
  root.setProperty('--now-top', `${Math.round(covers.top + 2)}px`);
  root.setProperty('--sheet-h', `${Math.round(covers.bottom)}px`);
}

new ResizeObserver(layout).observe(document.getElementById('app'));
new ResizeObserver(layout).observe(ui.el.sheet);

// ── loop ───────────────────────────────────────────────────────────────────

let last = performance.now();
let nowTimer = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time.value += dt;

  const ex = state.exercise;
  if (state.playing) state.u = (state.u + (dt * state.speed) / ex.duration) % 1;

  const { deg, rad } = poseAt(ex, state.u);
  rig.update(rad);
  state.acts = activationsAt(ex, state.u);
  muscles.update(state.acts);

  const danger = state.mode === 'error' && Boolean(ex.error.danger);
  if (state.mode === 'error') {
    ghost.update(poseAt(ex, state.u, 'error').rad);
    ghost.setDanger(danger ? 0.5 + 0.5 * Math.sin(time.value * 6) : 0);
  }

  view.update(dt);
  view.camera.updateMatrixWorld();
  overlays.update({
    pose: deg,
    effort: effort(state.u),
    camera: view.camera,
    width,
    height,
    ghost: state.mode === 'error' ? ghost : null,
    danger,
  });

  const phase = phaseAt(ex, state.u);
  if (phase !== state.phase) {
    state.phase = phase;
    ui.setPhase(ex, phase);
    // One firm tap at the top of every rep: feel the hold.
    if (state.playing && phase === PEAK_PHASE) telegram.haptic('medium');
  }
  ui.setProgress(state.u);

  nowTimer -= dt;
  if (nowTimer <= 0) {
    nowTimer = 0.15;
    const top = Object.entries(state.acts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, value]) => ({ id, value, name: infoById.get(id).short }));
    ui.setNow(top, selectMuscle);
    if (state.selected) ui.setMuscleLoad(state.acts[state.selected] ?? 0);
  }

  renderer.render(scene, view.camera);
  requestAnimationFrame(frame);
}

// `?debug` exposes the internals in the console.
if (new URLSearchParams(location.search).has('debug')) {
  window.armlab = { THREE, rig, ghost, muscles, view, state, renderer, scene };
}

layout();
selectExercise(EXERCISES[0].id);
ui.setMode(state.mode);
requestAnimationFrame(frame);
