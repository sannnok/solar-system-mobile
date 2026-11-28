/**
 * ArmLab — interactive armwrestling biomechanics, built to run as a Telegram
 * Mini App (and in any browser).
 *
 * Each frame: advance the rep clock → pose the arm → resolve muscle tubes and
 * their activation → draw force vectors and joint readouts → render. With the
 * weak-link sheet open, a frameless probe rig also works out the torque on
 * every joint against the athlete's maximums a few times a second.
 */

import * as THREE from 'three';

import { MUSCLES } from './data/anatomy.js';
import { EXERCISES, activationsAt, effort, phaseAt, poseAt, variantOf } from './data/exercises.js';
import { jointDemands } from './data/mechanics.js';
import { ACTIONS, TYPICAL } from './data/strength.js';
import {
  DEFAULT_GRIP,
  GRIP_PARAMS,
  MatchSolver,
  PAD_DISTANCE,
  PROFILES,
  TECHNIQUES,
  activationsFromDemands,
  naturalRotation,
  profileCaps,
} from './data/match.js';
import { createMatchPanel } from './matchPanel.js';
import { CameraRig, VIEWS } from './render/camera.js';
import { MuscleSystem } from './render/muscles.js';
import { Overlays } from './render/overlays.js';
import { Rig } from './render/rig.js';
import { createStage } from './render/stage.js';
import { telegram } from './telegram.js';
import { createUI } from './ui.js';
import { createWeakPanel } from './weak.js';

const BACKGROUND = '#070b12';
const PEAK_PHASE = 2;
const G = 9.81;
const CAPS_KEY = 'armlab.capacities';

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

// The opponent for the match: the same arm turned 180° about the vertical
// (not mirrored — that would be a left arm), with its own pad and peg.
const oppOuter = new THREE.Group();
oppOuter.rotation.y = Math.PI;
oppOuter.position.set(0, 0, PAD_DISTANCE);
const oppMirror = new THREE.Group();
oppMirror.scale.x = -1;
oppOuter.add(oppMirror);
scene.add(oppOuter);
const oppRig = new Rig();
oppMirror.add(oppRig.root);
const oppPad = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 1.4), new THREE.MeshStandardMaterial({ color: 0x1b2532, roughness: 0.9 }));
oppPad.position.set(0.05, 0.07, 0);
const oppPeg = new THREE.Mesh(
  new THREE.CylinderGeometry(0.11, 0.11, 2.1, 16),
  new THREE.MeshStandardMaterial({ color: 0x3a4553, metalness: 0.85, roughness: 0.3 }),
);
oppPeg.position.set(-2.6, 1.05, -0.6);
oppMirror.add(oppPad, oppPeg);
oppOuter.updateMatrixWorld(true);
const oppMuscles = new MuscleSystem(oppRig, MUSCLES, time);
scene.add(oppMuscles.group);
oppMuscles.captureRest();
oppOuter.visible = false;
oppMuscles.group.visible = false;
const solver = new MatchSolver();

const view = new CameraRig(canvas);
const overlays = new Overlays(scene, rig, document.getElementById('labels'));
const infoById = new Map(MUSCLES.map((m) => [m.id, m]));
const LEVERAGE = Object.fromEntries(MUSCLES.filter((m) => m.leverage).map((m) => [m.id, m.leverage]));
const probe = new Rig({ probe: true });

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
  variant: EXERCISES[0].variants[0],
  forceKg: 15,
  caps: { ...TYPICAL },
  ownCaps: false,
  match: {
    on: false,
    me: 'hook',
    opp: 'top',
    profile: 'same',
    grip: { ...DEFAULT_GRIP, rotation: naturalRotation('hook', 'top') },
    result: null,
    oppActs: {},
    anim: null,
  },
};

const ui = createUI({
  exercises: EXERCISES,
  views: VIEWS,
  layers: state.layers,
  on: {
    exercise: selectExercise,
    match: enterMatch,
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
    variant: selectVariant,
    weak: () => setWeak(!weak.open),
    closeMuscle: () => selectMuscle(null),
    fullscreen: () => telegram.toggleFullscreen(),
  },
});

const weak = createWeakPanel({
  actions: ACTIONS,
  typical: TYPICAL,
  on: {
    close: () => setWeak(false),
    force(kg) {
      state.forceKg = kg;
      weak.setForce(kg, state.variant.resist.kind === 'cable');
      updateWeak();
    },
    save(caps) {
      state.caps = caps;
      state.ownCaps = true;
      weak.setCapacities(caps, true);
      telegram.storage.set(CAPS_KEY, JSON.stringify(caps));
      telegram.haptic('success');
      updateWeak();
      if (state.match.on) solveMatch(true);
    },
  },
});
weak.setCapacities(state.caps, false);
telegram.storage.get(CAPS_KEY).then((raw) => {
  try {
    const saved = raw ? JSON.parse(raw) : null;
    if (!saved) return;
    state.caps = { ...TYPICAL, ...saved };
    state.ownCaps = true;
    weak.setCapacities(state.caps, true);
    if (state.match.on) solveMatch(true);
  } catch {
    // A corrupt value just means typical maximums.
  }
});

let gripHaptic = 0;
const matchPanel = createMatchPanel({
  techniques: TECHNIQUES,
  profiles: PROFILES,
  params: GRIP_PARAMS,
  initial: state.match,
  on: {
    change(patch) {
      const m = state.match;
      Object.assign(m, patch);
      // New techniques settle the lock's rotation afresh, halfway between them.
      if (patch.me || patch.opp) m.grip.rotation = naturalRotation(m.me, m.opp);
      matchPanel.setGrip(m.grip);
      solveMatch(true);
      telegram.haptic('select');
    },
    grip(patch, final) {
      Object.assign(state.match.grip, patch);
      matchPanel.setGrip(state.match.grip);
      solveMatch(final);
      const now = performance.now();
      if (final || now - gripHaptic > 120) {
        gripHaptic = now;
        telegram.haptic('select');
      }
    },
    play: playBreak,
    tab: () => requestAnimationFrame(layout),
  },
});
matchPanel.setGrip(state.match.grip);

/** The match: both arms locked in a grip, solved by statics (data/match.js). */
function enterMatch() {
  state.match.on = true;
  selectMuscle(null);
  setWeak(false);
  ghost.root.visible = false;
  ui.setMatchMode(true);
  matchPanel.hidden = false;
  oppOuter.visible = true;
  oppMuscles.group.visible = state.layers.muscles;
  rig.setLayer('gear', false);
  oppRig.setLayer('gear', false);
  document.getElementById('now').hidden = true; // the sheet lists both athletes' links instead
  solveMatch(true);
  // Aim at the grip, a little below it so both elbows stay in frame.
  const c = state.match.result.contact;
  view.setShift([c.x, c.y - 0.7 - 2.35, c.z + 0.2], 1.3);
  view.go('side');
  ui.setView('side');
  telegram.haptic('select');
  requestAnimationFrame(layout);
}

function leaveMatch() {
  if (!state.match.on) return;
  stopBreak();
  state.match.on = false;
  document.getElementById('now').hidden = false;
  ui.setMatchMode(false);
  matchPanel.hidden = true;
  oppOuter.visible = false;
  oppMuscles.group.visible = false;
  rig.setLayer('gear', true);
  overlays.setMatch(null);
  ghost.root.visible = state.mode === 'error';
  ui.setMode(state.mode);
}

const matchSettings = () => {
  const m = state.match;
  return { me: m.me, opp: m.opp, grip: { ...m.grip }, capsMe: state.caps, capsOpp: profileCaps(m.profile, state.caps) };
};

/** Solve the lock-up and show it; `sweeps` also redraws the grip curves (a few dozen solves). */
function solveMatch(sweeps = false) {
  const m = state.match;
  stopBreak();
  const result = solver.solve(matchSettings());
  m.result = result;
  showLock(result.poses.meRad, result.poses.oppRad, result);
  state.acts = activationsFromDemands(result.me, result.poses.me, LEVERAGE);
  m.oppActs = activationsFromDemands(result.opp, result.poses.opp, LEVERAGE);
  muscles.update(state.acts);
  oppMuscles.update(m.oppActs);
  overlays.setMatch({ contact: result.contact.clone(), fMe: result.efforts.me.F, fOpp: result.efforts.opp.F, oppRig });
  matchPanel.render(result);
  if (sweeps) scheduleSweeps();
}

function showLock(poseMe, poseOpp, result) {
  rig.update(poseMe);
  oppOuter.position.copy(result.offset);
  oppOuter.updateMatrixWorld(true);
  oppRig.update(poseOpp);
}

// The grip curves: one parameter per task, so a slider never waits on them.
let sweepRun = 0;
function scheduleSweeps() {
  const run = ++sweepRun;
  const settings = matchSettings();
  const out = {};
  const keys = GRIP_PARAMS.map((p) => p.key);
  const next = () => {
    if (run !== sweepRun || !state.match.on) return;
    const key = keys.shift();
    out[key] = solver.sweep(settings, key);
    if (keys.length) setTimeout(next, 0);
    else matchPanel.renderSweeps(out, settings.grip, state.match.result.margin);
  };
  setTimeout(next, 30);
}

/**
 * How the lock-up breaks: the loser's link gives way and the winner drives
 * through it (or the grip opens). Keyframes from MatchSolver.breakdown(),
 * played by the frame loop, then back to the lock.
 */
const BREAK = { push: 1.5, hold: 0.8, back: 0.6 };
function playBreak() {
  const m = state.match;
  if (!m.result || m.anim) return;
  m.anim = { ...solver.breakdown(m.result), t: 0, buzzed: false };
  matchPanel.setPlaying(true);
  telegram.haptic('medium');
}

function stopBreak() {
  if (!state.match.anim) return;
  state.match.anim = null;
  matchPanel.setPlaying(false);
}

const _grip = new THREE.Vector3();
function stepBreak(dt) {
  const m = state.match;
  const a = m.anim;
  a.t += dt;
  const { push, hold, back } = BREAK;
  let u;
  if (a.t < push) {
    const x = a.t / push;
    u = x * x * (3 - 2 * x); // slow start, then it goes
  } else if (a.t < push + hold) {
    u = 1;
    if (!a.buzzed) {
      a.buzzed = true;
      telegram.haptic(a.loser === 'me' ? 'error' : 'success');
    }
  } else if (a.t < push + hold + back) u = 1 - (a.t - push - hold) / back;
  else {
    showLock(m.result.poses.meRad, m.result.poses.oppRad, m.result);
    overlays.match.contact.copy(m.result.contact);
    stopBreak();
    return;
  }
  const f = u * (a.frames.length - 1);
  const i = Math.min(Math.floor(f), a.frames.length - 2);
  const w = f - i;
  const mix = (p, q) => Object.fromEntries(Object.keys(p).map((k) => [k, p[k] + (q[k] - p[k]) * w]));
  showLock(mix(a.frames[i].me, a.frames[i + 1].me), mix(a.frames[i].opp, a.frames[i + 1].opp), m.result);
  overlays.match.contact.copy(rig.hand.localToWorld(_grip.copy(m.result.at.me)));
}

function selectExercise(id) {
  leaveMatch();
  const index = Math.max(EXERCISES.findIndex((e) => e.id === id), 0);
  const ex = EXERCISES[index];
  state.exercise = ex;
  state.u = 0;
  state.phase = -1;
  ui.setExercise(ex, index);
  state.variant = ex.variants[0];
  ui.setVariants(ex.variants, state.variant.id);
  overlays.configure(ex, state.variant);
  weak.setForce(state.forceKg, state.variant.resist.kind === 'cable');
  view.setShift(ex.cameraShift);
  view.go(ex.camera, !view.view);
  ui.setView(ex.camera);
  setPlaying(true);
  telegram.haptic('select');
  requestAnimationFrame(layout); // the error card's height may have changed
}

function selectVariant(id) {
  state.variant = variantOf(state.exercise, id);
  ui.setVariant(state.variant.id);
  overlays.configure(state.exercise, state.variant);
  weak.setForce(state.forceKg, state.variant.resist.kind === 'cable');
  updateWeak();
  telegram.haptic('select');
}

/** Only one sheet over the controls at a time; Telegram's back button closes it. */
function setWeak(open) {
  if (open) {
    selectMuscle(null);
    weak.show();
    updateWeak();
    telegram.backButton(true, () => setWeak(false));
    telegram.haptic('light');
  } else {
    weak.hide();
    telegram.backButton(false);
  }
}

function updateWeak() {
  if (!weak.open) return;
  const ex = state.exercise;
  const demands = jointDemands(probe, poseAt(ex, state.u).rad, state.variant.resist, state.forceKg * G, state.caps);
  const phase = ex.phases[phaseAt(ex, state.u)].name;
  const against = ex.variants.length > 1 ? ` · ${state.variant.label.toLowerCase()}` : '';
  weak.render(`${ex.title}${against} · ${phase}`, demands);
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
  if (id === 'muscles') {
    muscles.group.visible = visible;
    oppMuscles.group.visible = visible && state.match.on;
  } else if (id === 'vectors') overlays.setVisible(visible);
  else {
    rig.setLayer(id, visible);
    oppRig.setLayer(id, visible);
  }
  telegram.haptic('select');
}

function selectMuscle(id) {
  state.selected = id;
  muscles.select(id);
  if (id) {
    if (weak.open) weak.hide();
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
  } else if (e.code === 'Escape') {
    selectMuscle(null);
    setWeak(false);
  }
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
  root.setProperty('--now-top', `${Math.round(covers.header + 2)}px`);
  root.setProperty('--sheet-h', `${Math.round(covers.bottom)}px`);
}

new ResizeObserver(layout).observe(document.getElementById('app'));
new ResizeObserver(layout).observe(ui.el.sheet);
new ResizeObserver(layout).observe(document.getElementById('now'));

// ── loop ───────────────────────────────────────────────────────────────────

let last = performance.now();
let nowTimer = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time.value += dt;

  const ex = state.exercise;
  const inMatch = state.match.on;
  if (state.playing && !inMatch) state.u = (state.u + (dt * state.speed) / ex.duration) % 1;

  // A match is a static lock-up: its poses and muscles are set by solveMatch().
  const { deg, rad } = poseAt(ex, state.u);
  if (!inMatch) {
    rig.update(rad);
    state.acts = activationsAt(ex, state.u, { variant: state.variant, leverage: LEVERAGE });
    muscles.update(state.acts);
  } else if (state.match.anim) {
    stepBreak(dt);
    muscles.update(state.acts);
    oppMuscles.update(state.match.oppActs);
  }

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
  if (!inMatch && phase !== state.phase) {
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
    updateWeak();
  }

  renderer.render(scene, view.camera);
  requestAnimationFrame(frame);
}

// `?debug` exposes the internals in the console.
if (new URLSearchParams(location.search).has('debug')) {
  window.armlab = { THREE, rig, ghost, probe, oppRig, solver, muscles, oppMuscles, view, state, renderer, scene, playBreak };
}

layout();
selectExercise(EXERCISES[0].id);
ui.setMode(state.mode);
requestAnimationFrame(frame);
