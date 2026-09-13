/**
 * The simulation clock.
 *
 * Holds a Julian Day, a rate in simulated days per real second, and a paused
 * flag. The rate is eased rather than applied directly so that dragging the
 * speed slider or hitting pause never snaps the planets.
 */

import { damp } from '../util/math.js';
import { dateToJulian } from '../util/time.js';

export const MIN_RATE = 0.002;
export const MAX_RATE = 2000;
export const DEFAULT_RATE = 6;

export class Simulation {
  constructor(options = {}) {
    this.julianDay = options.startJd ?? dateToJulian(new Date());
    this.targetRate = options.rate ?? DEFAULT_RATE;
    this.currentRate = this.targetRate;
    this.paused = false;
    this.listeners = new Set();
  }

  setRate(daysPerSecond) {
    this.targetRate = Math.min(MAX_RATE, Math.max(MIN_RATE, daysPerSecond));
    this.emit();
  }

  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused;
    this.emit();
  }

  togglePaused() {
    this.setPaused(!this.paused);
  }

  /** Jumps the clock; used by the "Now" control. */
  setJulianDay(jd) {
    this.julianDay = jd;
    this.emit();
  }

  /** Advances the clock by `dt` real seconds. Returns true if time moved. */
  advance(dt) {
    const goal = this.paused ? 0 : this.targetRate;
    // Ease toward the goal so speed changes and pauses glide instead of snapping.
    this.currentRate = damp(this.currentRate, goal, 1e-5, dt);
    if (Math.abs(this.currentRate - goal) < goal * 1e-4) this.currentRate = goal;
    if (Math.abs(this.currentRate) < 1e-7) return false;
    this.julianDay += this.currentRate * dt;
    return true;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    for (const listener of this.listeners) listener(this);
  }
}
