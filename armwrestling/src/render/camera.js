/**
 * Camera presets with eased transitions, and framing that keeps the arm in
 * the part of the screen the header and bottom sheet leave free.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const VIEWS = [
  // World space: the arm is a right arm, so its outer (thumb/back-of-hand) side faces −x.
  { id: 'side', label: 'Сбоку', target: [0, 2.35, -0.55], dir: [-1, 0.4, 0.3], dist: 7 },
  { id: 'opponent', label: 'Соперник', target: [0, 2.35, -0.2], dir: [-0.12, 0.28, 1], dist: 7 },
  { id: 'palm', label: 'Ладонь', target: [0, 2.35, -0.2], dir: [1, 0.35, 0.35], dist: 7 },
  { id: 'top', label: 'Сверху', target: [0, 1.8, -0.6], dir: [-0.06, 1, 0.22], dist: 8.5 },
];

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class CameraRig {
  constructor(canvas) {
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      enablePan: false,
      minDistance: 4,
      maxDistance: 18,
      rotateSpeed: 0.8,
    });
    this.tween = null;
    this.fit = 1;
    this.view = null;
    // Once the user has orbited, a resize must not yank the camera back.
    this.userMoved = false;
    this.controls.addEventListener('start', () => {
      this.userMoved = true;
      this.tween = null;
    });
  }

  /** Free area: the canvas size minus what the chrome covers at the top and bottom. */
  resize(width, height, coverTop, coverBottom) {
    const free = Math.max(height - coverTop - coverBottom, 1);
    this.camera.aspect = width / height;
    // Shift the frustum so the centre of the free band is the optical centre,
    // and pull back on narrow screens so the whole arm fits across.
    const shift = (coverBottom - coverTop) / 2;
    this.camera.setViewOffset(width, height, 0, shift, width, height);
    // Distances in VIEWS frame the arm in a full-height view; scale them so it
    // fits the free band vertically and the canvas horizontally.
    this.fit = Math.max(height / free, 0.85 / this.camera.aspect) * 1.08;
    this.camera.updateProjectionMatrix();
    if (this.view && !this.tween && !this.userMoved) this.go(this.view.id, true);
  }

  /** An exercise can nudge the framing towards where its movement goes; a match pulls back to fit both arms. */
  setShift(shift = [0, 0, 0], zoom = 1) {
    this.shift = new THREE.Vector3(...shift);
    this.zoom = zoom;
  }

  go(id, instant = false) {
    const view = VIEWS.find((v) => v.id === id) ?? VIEWS[0];
    this.view = view;
    this.userMoved = false;
    const target = new THREE.Vector3(...view.target).add(this.shift ?? new THREE.Vector3());
    const position = new THREE.Vector3(...view.dir).normalize().multiplyScalar(view.dist * this.fit * (this.zoom ?? 1)).add(target);
    if (instant) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.tween = null;
      this.controls.update();
      return;
    }
    this.tween = {
      t: 0,
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: position,
      toTarget: target,
    };
  }

  update(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(tw.t + dt / 0.9, 1);
      const k = ease(tw.t);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      // Swing round the target rather than cutting through the arm.
      const from = tw.fromPos.clone().sub(tw.fromTarget);
      const to = tw.toPos.clone().sub(tw.toTarget);
      const radius = THREE.MathUtils.lerp(from.length(), to.length(), k);
      const dir = from.normalize().lerp(to.normalize(), k).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, radius);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
  }
}
