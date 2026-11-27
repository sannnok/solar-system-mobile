/**
 * What the eye can't see on a real arm: the athlete's force (mint), the
 * resistance — a cable (grey) or the opponent's pull (amber) — and live
 * joint-angle readouts.
 *
 * Arrows ignore depth so they stay readable through muscle and skin.
 */

import * as THREE from 'three';
import { HANDLE, PRON_AXIS, RADIAL_HEAD } from './rig.js';
import { placeBetween, v3 } from './shapes.js';

const FORCE = 0x3cf2c0;
const RESIST = 0xb8c4d2;
const OPPONENT = 0xffa04d;

function arrowMaterial(color) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, depthWrite: false });
}

function makeArrow(color) {
  const material = arrowMaterial(color);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 12).translate(0, 0.5, 0), material);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 16).translate(0, 0.14, 0), material);
  const group = new THREE.Group();
  group.add(shaft, head);
  group.renderOrder = 10;
  shaft.renderOrder = head.renderOrder = 10;
  group.userData = { material, setLength(length) {
    shaft.scale.y = Math.max(length - 0.28, 0.01);
    head.position.y = Math.max(length - 0.28, 0.01);
  } };
  return group;
}

/** A partial ring with a head, turning positively about the group's +Z. */
function makeArcArrow(color, radius, arc = Math.PI * 1.15) {
  const material = arrowMaterial(color);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.04, 8, 64, arc), material);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 16), material);
  head.position.set(Math.cos(arc) * radius, Math.sin(arc) * radius, 0);
  head.rotation.z = arc;
  const group = new THREE.Group();
  const spin = new THREE.Group();
  spin.add(ring, head);
  group.add(spin);
  ring.renderOrder = head.renderOrder = 10;
  group.userData = { material, spin };
  return group;
}

export class Overlays {
  constructor(scene, rig, labelLayer) {
    this.scene = scene;
    this.rig = rig;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.resist = makeArrow(RESIST);
    this.opponent = makeArrow(OPPONENT);
    this.group.add(this.resist, this.opponent);
    this.linears = []; // pool of athlete-force arrows
    this.arcs = new Map();
    this.active = []; // [{ def, arrow }] for the current exercise

    const cableMat = new THREE.MeshStandardMaterial({ color: 0x9aa6b4, metalness: 0.6, roughness: 0.4 });
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 8).translate(0, 0.5, 0), cableMat);
    this.pulley = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 10, 28), cableMat);
    this.post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1, 12).translate(0, 0.5, 0), cableMat);
    scene.add(this.cable, this.pulley, this.post);

    this.labels = {
      joint: label(labelLayer, 'label label--joint'),
      elbow: label(labelLayer, 'label'),
      danger: label(labelLayer, 'label label--danger'),
      opponent: label(labelLayer, 'label label--opponent'),
    };
    this.visible = true;
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  configure(exercise, variant) {
    this.exercise = exercise;
    this.resistDef = variant.resist;
    for (const arrow of [...this.linears, ...this.arcs.values()]) arrow.visible = false;

    // An exercise has one athlete force (`force`) or several (`forces`).
    let linear = 0;
    this.active = [].concat(exercise.forces ?? exercise.force).map((def) => {
      if (def.kind === 'linear') {
        if (!this.linears[linear]) {
          this.linears[linear] = makeArrow(FORCE);
          this.group.add(this.linears[linear]);
        }
        return { def, arrow: this.linears[linear++] };
      }
      return { def, arrow: this.#arc(def) };
    });
    for (const { arrow } of this.active) arrow.visible = this.visible;

    // A cable needs its pulley; an opponent's pull is just an arrow at the grip.
    const cable = this.resistDef.kind === 'cable';
    for (const mesh of [this.cable, this.pulley, this.post]) mesh.visible = cable;
    this.resist.visible = cable && this.visible;
    this.opponent.visible = !cable && this.visible;
    if (cable) {
      // Anchors are in rig space; the rig root may be mirrored.
      const anchor = this.rig.root.localToWorld(v3(...this.resistDef.anchor));
      this.anchor = anchor;
      this.pulley.position.copy(anchor);
      this.pulley.lookAt(0, anchor.y, 0);
      this.post.position.set(anchor.x, 0, anchor.z);
      this.post.scale.set(1, Math.max(anchor.y - 0.18, 0.01), 1);
    }
  }

  /**
   * A rotation arrow lives in the frame it turns in. `about: 'pronation'`
   * turns it about the real forearm rotation axis (radial head → ulnar head)
   * at the given height, rather than the forearm's long axis.
   */
  #arc(def) {
    const frame = def.about === 'pronation' ? 'forearm' : def.frame;
    const key = `${frame}:${def.radius}`;
    if (!this.arcs.has(key)) {
      const arc = makeArcArrow(FORCE, def.radius);
      this.rig[frame].add(arc);
      this.arcs.set(key, arc);
    }
    const arc = this.arcs.get(key);
    let axis;
    if (def.about === 'pronation') {
      axis = PRON_AXIS.clone();
      arc.position.copy(RADIAL_HEAD).addScaledVector(PRON_AXIS, (def.height - RADIAL_HEAD.y) / PRON_AXIS.y);
    } else {
      axis = v3(...def.axis).normalize();
      arc.position.set(...def.at);
    }
    // Point the arc's +Z along the axis it turns about (flipped for negative turns).
    arc.quaternion.setFromUnitVectors(v3(0, 0, 1), axis.multiplyScalar(def.sign));
    arc.userData.spin.rotation.z = def.start ?? 0;
    return arc;
  }

  setVisible(visible) {
    this.visible = visible;
    const cable = this.resistDef?.kind === 'cable';
    this.resist.visible = visible && cable;
    this.opponent.visible = visible && !cable;
    for (const { arrow } of this.active) arrow.visible = visible;
  }

  update({ pose, effort, camera, width, height, ghost, danger }) {
    const ex = this.exercise;
    const rig = this.rig;
    const { _a: a, _b: b, _d: d } = this;
    const strength = 0.3 + 0.7 * effort;

    // Screen-space labels.
    const show = (lbl, world, text) => {
      if (!text) return hide(lbl);
      const p = world.clone().project(camera);
      if (p.z > 1) return hide(lbl);
      lbl.hidden = false;
      if (lbl.textContent !== text) {
        lbl.textContent = text;
        lbl.dataset.w = String(lbl.offsetWidth);
      }
      // Keep labels on screen: near an edge they slide in rather than clip.
      const w = Number(lbl.dataset.w) || 0;
      const x = THREE.MathUtils.clamp(((p.x + 1) / 2) * width, 8, width - w - 14);
      lbl.style.transform = `translate(${x}px, ${((1 - p.y) / 2) * height}px)`;
    };
    const r = this.resistDef;
    if (r.kind === 'cable') {
      // Cable from the handle to the pulley; resistance arrow along it.
      rig.hand.localToWorld(a.copy(HANDLE[r.attach]));
      placeBetween(this.cable, a, this.anchor);
      this.cable.scale.y = a.distanceTo(this.anchor);
      d.subVectors(this.anchor, a).normalize();
      this.resist.position.copy(a);
      this.resist.quaternion.setFromUnitVectors(v3(0, 1, 0), d);
      this.resist.userData.setLength(0.5 + 0.5 * effort);
      this.resist.userData.material.opacity = 0.55;
      hide(this.labels.opponent);
    } else {
      // The opponent's pull, from the point where his hand grips yours.
      rig.hand.localToWorld(a.copy(v3(...r.at)));
      d.set(...r.dir).transformDirection(rig.root.matrixWorld);
      const length = 0.7 + 0.7 * effort;
      this.opponent.position.copy(a);
      this.opponent.quaternion.setFromUnitVectors(v3(0, 1, 0), d);
      this.opponent.userData.setLength(length);
      this.opponent.userData.material.opacity = 0.85;
      if (this.visible) show(this.labels.opponent, b.copy(a).addScaledVector(d, length + 0.15), 'Соперник');
      else hide(this.labels.opponent);
    }

    for (const { def: f, arrow } of this.active) {
      if (f.kind === 'linear') {
        rig.hand.localToWorld(a.copy(HANDLE[f.at]));
        d.set(...f.dir);
        // `world` directions are given in rig space, so they go through the (mirrored) root.
        d.transformDirection((f.world ? rig.root : rig.hand).matrixWorld);
        arrow.position.copy(a);
        arrow.quaternion.setFromUnitVectors(v3(0, 1, 0), d);
        arrow.userData.setLength(0.55 + 0.6 * effort);
      } else {
        const k = 0.9 + 0.15 * effort;
        arrow.scale.set(k, k, k);
      }
      arrow.userData.material.opacity = strength;
    }

    show(this.labels.joint, rig.hand.localToWorld(b.set(0.45, 0.3, 0)), ex.readout(pose));
    const elbow = Math.round(THREE.MathUtils.radToDeg(rig.elbowAngle()));
    show(this.labels.elbow, rig.forearm.localToWorld(b.set(0.55, -0.1, 0.3)), `Локоть ${elbow}°`);
    if (danger && ghost) {
      show(this.labels.danger, ghost.upper.localToWorld(b.set(-0.5, 1.4, 0)), '⚠ Скручивание плечевой кости');
    } else hide(this.labels.danger);
  }
}

function label(layer, className) {
  const el = document.createElement('div');
  el.className = className;
  el.hidden = true;
  layer.append(el);
  return el;
}

function hide(el) {
  el.hidden = true;
}
