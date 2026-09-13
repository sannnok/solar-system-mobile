/**
 * Label visibility rules.
 *
 * Labels are real DOM nodes positioned by CSS2DRenderer, so they stay crisp and
 * clickable. Moons only get a label while their planet is the focus — otherwise
 * the inner system turns into a wall of text.
 */

import * as THREE from 'three';

export function createLabels({ system, camera, focus }) {
  const forward = new THREE.Vector3();
  const toBody = new THREE.Vector3();
  let enabled = true;

  return {
    get enabled() {
      return enabled;
    },

    setEnabled(value) {
      enabled = value;
    },

    update() {
      camera.getWorldDirection(forward);
      const focused = focus.focused;

      for (const body of system.focusable) {
        if (!body.label) continue;
        let visible = enabled;

        if (visible && body.kind === 'moon') {
          visible = focused === body || focused === body.parent;
        }

        if (visible) {
          // Drop anything behind the camera; a projected point there lands in
          // the wrong place entirely.
          toBody.copy(body.worldPosition).sub(camera.position);
          visible = toBody.dot(forward) > 0;
        }

        body.label.visible = visible;
        body.labelElement.classList.toggle('is-active', focused === body);
      }
    },
  };
}
