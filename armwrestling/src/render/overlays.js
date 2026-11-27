/**
 * What the eye can't see on a real arm: the athlete's force (mint), the
 * resistance from the cable (grey), and live joint-angle readouts.
 *
 * Arrows ignore depth so they stay readable through muscle and skin.
 */

import * as THREE from 'three';
import { HANDLE } from './rig.js';
import { placeBetween, v3 } from './shapes.js';

const FORCE = 0x3cf2c0;
const RESIST = 0xb8c4d2;

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

    this.force = makeArrow(FORCE);
    this.resist = makeArrow(RESIST);
    this.group.add(this.force, this.resist);
    this.arcs = new Map();

    const cableMat = new THREE.MeshStandardMaterial({ color: 0x9aa6b4, metalness: 0.6, roughness: 0.4 });
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 8).translate(0, 0.5, 0), cableMat);
    this.pulley = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 10, 28), cableMat);
    this.post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1, 12).translate(0, 0.5, 0), cableMat);
    scene.add(this.cable, this.pulley, this.post);

    this.labels = {
      joint: label(labelLayer, 'label label--joint'),
      elbow: label(labelLayer, 'label'),
      danger: label(labelLayer, 'label label--danger'),
    };
    this.visible = true;
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  configure(exercise) {
    this.exercise = exercise;
    const f = exercise.force;
    for (const arc of this.arcs.values()) arc.visible = false;
    this.force.visible = f.kind === 'linear' && this.visible;

    if (f.kind === 'arc') {
      const key = `${f.frame}:${f.radius}`;
      if (!this.arcs.has(key)) {
        const arc = makeArcArrow(FORCE, f.radius);
        this.rig[f.frame].add(arc);
        this.arcs.set(key, arc);
      }
      const arc = this.arcs.get(key);
      arc.position.set(...f.at);
      // Point the arc's +Z along the axis it turns about (flipped for negative turns).
      const axis = v3(...f.axis).multiplyScalar(f.sign);
      arc.quaternion.setFromUnitVectors(v3(0, 0, 1), axis);
      arc.userData.spin.rotation.z = f.start ?? 0;
      arc.visible = this.visible;
      this.arc = arc;
    } else {
      this.arc = null;
    }

    // Anchors are in rig space; the rig root may be mirrored.
    const anchor = this.rig.root.localToWorld(v3(...exercise.cable.anchor));
    this.anchor = anchor;
    this.pulley.position.copy(anchor);
    this.pulley.lookAt(0, anchor.y, 0);
    this.post.position.set(anchor.x, 0, anchor.z);
    this.post.scale.set(1, Math.max(anchor.y - 0.18, 0.01), 1);
  }

  setVisible(visible) {
    this.visible = visible;
    this.resist.visible = visible;
    this.force.visible = visible && this.exercise?.force.kind === 'linear';
    if (this.arc) this.arc.visible = visible;
  }

  update({ pose, effort, camera, width, height, ghost, danger }) {
    const ex = this.exercise;
    const rig = this.rig;
    const { _a: a, _b: b, _d: d } = this;
    const strength = 0.3 + 0.7 * effort;

    // Cable from the handle to the pulley; resistance arrow along it.
    rig.hand.localToWorld(a.copy(HANDLE[ex.cable.attach]));
    placeBetween(this.cable, a, this.anchor);
    this.cable.scale.y = a.distanceTo(this.anchor);
    d.subVectors(this.anchor, a).normalize();
    this.resist.position.copy(a);
    this.resist.quaternion.setFromUnitVectors(v3(0, 1, 0), d);
    this.resist.userData.setLength(0.5 + 0.5 * effort);
    this.resist.userData.material.opacity = 0.55;

    const f = ex.force;
    if (f.kind === 'linear') {
      rig.hand.localToWorld(a.copy(HANDLE[f.at]));
      d.set(...f.dir);
      d.transformDirection((f.world ? rig.root : rig.hand).matrixWorld);
      this.force.position.copy(a);
      this.force.quaternion.setFromUnitVectors(v3(0, 1, 0), d);
      this.force.userData.setLength(0.55 + 0.6 * effort);
      this.force.userData.material.opacity = strength;
    } else if (this.arc) {
      this.arc.userData.material.opacity = strength;
      const s = 0.9 + 0.15 * effort;
      this.arc.scale.set(s, s, s);
    }

    // Readouts.
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
