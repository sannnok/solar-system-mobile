/**
 * Turning taps into bodies.
 *
 * A plain raycast is unforgiving when Mercury is three pixels wide, so a miss
 * falls back to the nearest body within a generous screen-space radius. Drags
 * are filtered out by distance and duration so orbiting the camera never
 * selects something by accident.
 */

import * as THREE from 'three';

const TAP_SLOP_PX = 9;
const TAP_TIMEOUT_MS = 600;
const PROXIMITY_PX = 34;

export function createPicker({ canvas, camera, system, onPick, onHoverChange }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const toBody = new THREE.Vector3();

  const bodyByMesh = new Map();
  for (const body of system.focusable) bodyByMesh.set(body.mesh, body);

  let downX = 0;
  let downY = 0;
  let downAt = 0;
  let hovered = null;

  function pickAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    pointer.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(system.pickable, false);
    if (hits.length > 0) {
      const body = bodyByMesh.get(hits[0].object);
      if (body) return body;
    }

    // Nothing under the cursor — accept the closest body within a finger's width.
    camera.getWorldDirection(forward);
    let best = null;
    let bestDistance = PROXIMITY_PX;

    for (const body of system.focusable) {
      if (body.kind === 'moon' && body.label && !body.label.visible) continue;
      toBody.copy(body.worldPosition).sub(camera.position);
      if (toBody.dot(forward) <= 0) continue;

      projected.copy(body.worldPosition).project(camera);
      const screenX = ((projected.x + 1) / 2) * rect.width;
      const screenY = ((1 - projected.y) / 2) * rect.height;
      const distance = Math.hypot(screenX - x, screenY - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = body;
      }
    }
    return best;
  }

  function handlePointerDown(event) {
    downX = event.clientX;
    downY = event.clientY;
    downAt = performance.now();
  }

  function handlePointerUp(event) {
    const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
    if (moved > TAP_SLOP_PX || performance.now() - downAt > TAP_TIMEOUT_MS) return;
    const body = pickAt(event.clientX, event.clientY);
    if (body) onPick(body);
  }

  function handlePointerMove(event) {
    if (event.pointerType !== 'mouse' || event.buttons !== 0) return;
    const body = pickAt(event.clientX, event.clientY);
    if (body !== hovered) {
      hovered = body;
      onHoverChange?.(body);
    }
  }

  canvas.addEventListener('pointerdown', handlePointerDown);
  canvas.addEventListener('pointerup', handlePointerUp);
  canvas.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerleave', () => {
    if (hovered) {
      hovered = null;
      onHoverChange?.(null);
    }
  });

  return { pickAt };
}
