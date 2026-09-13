/**
 * Click-to-focus camera moves.
 *
 * Focusing eases the camera to an offset from the target and then *follows* it:
 * once the move finishes, the camera and the orbit pivot are translated by the
 * body's own motion each frame, so you keep full orbit/zoom control while the
 * planet carries on around the Sun.
 */

import * as THREE from 'three';
import { DEG, TAU, clamp, easeInOutCubic } from '../util/math.js';

const TRANSITION_SECONDS = 1.15;
const OVERVIEW_RADIUS = 70;
const FIT_SAMPLES = 48;
const FIT_MARGIN = 0.92;
// How far off the Sun-body line the camera settles. Straight down the line is
// a flat, fully lit disc; too far round and you arrive looking at the night side.
const PHASE_ANGLE = 38 * DEG;
const OVERVIEW_ELEVATION = 32 * DEG;
const OVERVIEW_AZIMUTH = 0.38;

export function createFocusController({ camera, controls, reducedMotion = false }) {
  const goalTarget = new THREE.Vector3();
  const goalPosition = new THREE.Vector3();
  const startPosition = new THREE.Vector3();
  const startTarget = new THREE.Vector3();
  const offsetDirection = new THREE.Vector3();
  const previousTargetPosition = new THREE.Vector3();
  const savedCamera = new THREE.Vector3();
  const sunward = new THREE.Vector3();
  const perpendicular = new THREE.Vector3();

  let focused = null;
  let transition = 0;
  let transitioning = false;
  let followDistance = 0;

  function placeAtDistance(distance, out) {
    const horizontal = Math.cos(OVERVIEW_ELEVATION) * distance;
    return out.set(
      Math.sin(OVERVIEW_AZIMUTH) * horizontal,
      Math.sin(OVERVIEW_ELEVATION) * distance,
      Math.cos(OVERVIEW_AZIMUTH) * horizontal
    );
  }

  /**
   * Distance that frames the whole system.
   *
   * The orbits form a disc seen at an angle, so the edge nearest the camera
   * projects far larger than the far edge — closed-form framing from the field
   * of view alone gets this wrong in both directions. Instead, project a ring
   * of sample points and binary-search the closest distance that still fits.
   * Monotonic in distance, so a dozen iterations is exact enough.
   */
  function overviewDistance() {
    const restore = savedCamera.copy(camera.position);
    const probe = new THREE.Vector3();

    const fits = (distance) => {
      placeAtDistance(distance, camera.position);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      for (let i = 0; i < FIT_SAMPLES; i++) {
        const angle = (i / FIT_SAMPLES) * TAU;
        probe
          .set(Math.cos(angle) * OVERVIEW_RADIUS, 0, Math.sin(angle) * OVERVIEW_RADIUS)
          .project(camera);
        if (Math.abs(probe.x) > FIT_MARGIN || Math.abs(probe.y) > FIT_MARGIN) return false;
      }
      return true;
    };

    let low = OVERVIEW_RADIUS;
    let high = OVERVIEW_RADIUS * 24;
    for (let i = 0; i < 14; i++) {
      const mid = (low + high) / 2;
      if (fits(mid)) high = mid;
      else low = mid;
    }

    camera.position.copy(restore);
    camera.updateMatrixWorld(true);
    return high;
  }

  function overviewPosition(out) {
    return placeAtDistance(overviewDistance(), out);
  }

  function currentTargetPosition(out) {
    if (!focused) return out.set(0, 0, 0);
    return out.copy(focused.worldPosition);
  }

  function beginTransition() {
    startPosition.copy(camera.position);
    startTarget.copy(controls.target);
    transition = 0;
    transitioning = true;
    controls.enabled = false;

    if (focused) {
      currentTargetPosition(goalTarget);

      // Start from where the user is already looking, lifted a little so the
      // body is never edge-on against its own orbit.
      offsetDirection.copy(camera.position).sub(goalTarget);
      if (offsetDirection.lengthSq() < 1e-6) offsetDirection.set(0, 0.35, 1);
      offsetDirection.normalize();
      offsetDirection.y += 0.3;
      offsetDirection.normalize();

      // Then swing round to the sunlit side, keeping the user's approach as the
      // direction we lean away from the Sun-body line.
      sunward.copy(goalTarget).negate();
      if (sunward.lengthSq() > 1e-8) {
        sunward.normalize();
        perpendicular
          .copy(offsetDirection)
          .addScaledVector(sunward, -offsetDirection.dot(sunward));
        if (perpendicular.lengthSq() < 1e-6) {
          perpendicular.set(0, 1, 0).addScaledVector(sunward, -sunward.y);
        }
        perpendicular.normalize();
        offsetDirection
          .copy(sunward)
          .multiplyScalar(Math.cos(PHASE_ANGLE))
          .addScaledVector(perpendicular, Math.sin(PHASE_ANGLE))
          .normalize();
      }

      followDistance = clamp(focused.radius * 9, focused.radius * 3.2, 42);
    } else {
      goalTarget.set(0, 0, 0);
      overviewPosition(goalPosition);
      followDistance = goalPosition.length();
      offsetDirection.copy(goalPosition).normalize();
    }
  }

  function applyDistanceLimits() {
    if (focused) {
      controls.minDistance = Math.max(0.02, focused.radius * 1.45);
      controls.maxDistance = 1400;
    } else {
      controls.minDistance = 3;
      controls.maxDistance = 1400;
    }
  }

  function settle() {
    transitioning = false;
    controls.enabled = true;
    applyDistanceLimits();
    currentTargetPosition(previousTargetPosition);
  }

  return {
    get focused() {
      return focused;
    },

    focus(body) {
      // Re-focusing the current body is a no-op, but re-framing the overview
      // from a wandered-off camera is not.
      if (body && focused === body) return;
      focused = body ?? null;
      beginTransition();
      if (reducedMotion) {
        // Skip the fly-through, but still land in follow mode.
        currentTargetPosition(goalTarget);
        camera.position.copy(goalTarget).addScaledVector(offsetDirection, followDistance);
        controls.target.copy(goalTarget);
        settle();
      }
    },

    reset() {
      this.focus(null);
    },

    /** Re-frames the overview when the viewport aspect changes. */
    handleResize() {
      if (focused || transitioning) return;
      const distance = overviewDistance();
      const current = camera.position.length();
      if (current > 0) camera.position.multiplyScalar(distance / current);
    },

    update(dt) {
      currentTargetPosition(goalTarget);

      if (transitioning) {
        transition = Math.min(1, transition + dt / TRANSITION_SECONDS);
        const eased = easeInOutCubic(transition);
        goalPosition.copy(goalTarget).addScaledVector(offsetDirection, followDistance);
        camera.position.lerpVectors(startPosition, goalPosition, eased);
        controls.target.lerpVectors(startTarget, goalTarget, eased);
        if (transition >= 1) settle();
        return;
      }

      if (focused) {
        // Carry the camera along with the body so the framing holds while the
        // user is free to orbit and zoom around it.
        camera.position.add(goalTarget.clone().sub(previousTargetPosition));
        controls.target.copy(goalTarget);
        previousTargetPosition.copy(goalTarget);
      }
    },

    /** Places the camera for first paint without animating. */
    snapToOverview() {
      focused = null;
      overviewPosition(camera.position);
      controls.target.set(0, 0, 0);
      applyDistanceLimits();
      previousTargetPosition.set(0, 0, 0);
    },
  };
}
