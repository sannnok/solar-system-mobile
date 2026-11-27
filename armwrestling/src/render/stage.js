/** The armwrestling table, elbow pad, grip peg and the lights that only they use. */

import * as THREE from 'three';

function gridTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0d131c';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(111, 208, 255, 0.10)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(111, 208, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo((i * size) / 4, 0);
    ctx.lineTo((i * size) / 4, size);
    ctx.moveTo(0, (i * size) / 4);
    ctx.lineTo(size, (i * size) / 4);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 7);
  texture.anisotropy = 4;
  return texture;
}

/** Lights go in the scene; geometry goes in `group`, which shares the rig's space. */
export function createStage(scene, group = scene) {
  scene.add(new THREE.HemisphereLight(0x9fc8ff, 0x0b0f16, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 8, 5);
  scene.add(key);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.5, 11),
    new THREE.MeshStandardMaterial({ map: gridTexture(), roughness: 0.85, metalness: 0.1 }),
  );
  top.position.set(0, -0.25, 1.2);
  group.add(top);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(top.geometry),
    new THREE.LineBasicMaterial({ color: 0x3cf2c0, transparent: true, opacity: 0.18 }),
  );
  edges.position.copy(top.position);
  group.add(edges);

  const padMat = new THREE.MeshStandardMaterial({ color: 0x1b2532, roughness: 0.9 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.14, 1.4), padMat);
  pad.position.set(0.05, 0.07, 0);
  group.add(pad);

  // The peg the free hand holds, on the athlete's left.
  const peg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 2.1, 16),
    new THREE.MeshStandardMaterial({ color: 0x3a4553, metalness: 0.85, roughness: 0.3 }),
  );
  peg.position.set(-2.6, 1.05, -0.6);
  group.add(peg);
}
