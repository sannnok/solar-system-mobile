/**
 * Heliocentric positions from Keplerian elements.
 *
 * Uses the classic "Keplerian Elements for Approximate Positions of the Major
 * Planets" formulation (Standish, JPL Solar System Dynamics): each element is
 * a value at the J2000.0 epoch plus a linear rate per Julian century. Accuracy
 * is on the order of arcminutes between 1800 and 2050, which is far finer than
 * anything visible here.
 */

import { DEG, TAU } from '../util/math.js';
import { centuriesSinceJ2000 } from '../util/time.js';

/**
 * Solves Kepler's equation M = E - e*sin(E) for the eccentric anomaly.
 * Newton-Raphson converges in a handful of steps at planetary eccentricities.
 */
export function solveEccentricAnomaly(meanAnomaly, eccentricity) {
  let E = meanAnomaly + eccentricity * Math.sin(meanAnomaly);
  for (let i = 0; i < 12; i++) {
    const delta =
      (E - eccentricity * Math.sin(E) - meanAnomaly) /
      (1 - eccentricity * Math.cos(E));
    E -= delta;
    if (Math.abs(delta) < 1e-12) break;
  }
  return E;
}

/**
 * Propagates a body's elements to the given time.
 * `elements` entries are [valueAtJ2000, ratePerCentury]; angles in degrees,
 * `a` in astronomical units.
 */
export function elementsAt(elements, jd) {
  const T = centuriesSinceJ2000(jd);
  return {
    a: elements.a[0] + elements.a[1] * T,
    e: elements.e[0] + elements.e[1] * T,
    inclination: (elements.inclination[0] + elements.inclination[1] * T) * DEG,
    meanLongitude: (elements.meanLongitude[0] + elements.meanLongitude[1] * T) * DEG,
    periapsisLongitude:
      (elements.periapsisLongitude[0] + elements.periapsisLongitude[1] * T) * DEG,
    nodeLongitude: (elements.nodeLongitude[0] + elements.nodeLongitude[1] * T) * DEG,
  };
}

/**
 * Position in the orbital plane for a given eccentric anomaly, rotated into
 * J2000 ecliptic coordinates. Writes into `out` (AU) and returns it.
 */
export function positionAtEccentricAnomaly(el, E, out) {
  // Perifocal coordinates.
  const xp = el.a * (Math.cos(E) - el.e);
  const yp = el.a * Math.sqrt(Math.max(0, 1 - el.e * el.e)) * Math.sin(E);

  const argPeriapsis = el.periapsisLongitude - el.nodeLongitude;
  const cosW = Math.cos(argPeriapsis);
  const sinW = Math.sin(argPeriapsis);
  const cosO = Math.cos(el.nodeLongitude);
  const sinO = Math.sin(el.nodeLongitude);
  const cosI = Math.cos(el.inclination);
  const sinI = Math.sin(el.inclination);

  out.x = (cosW * cosO - sinW * sinO * cosI) * xp + (-sinW * cosO - cosW * sinO * cosI) * yp;
  out.y = (cosW * sinO + sinW * cosO * cosI) * xp + (-sinW * sinO + cosW * cosO * cosI) * yp;
  out.z = sinW * sinI * xp + cosW * sinI * yp;
  return out;
}

/**
 * Heliocentric ecliptic position in AU at the given Julian Day.
 * `out` is a plain {x, y, z} target so this stays allocation-free in the loop.
 */
export function heliocentricPosition(elements, jd, out) {
  const el = elementsAt(elements, jd);
  const meanAnomaly = normalizeAngle(el.meanLongitude - el.periapsisLongitude);
  const E = solveEccentricAnomaly(meanAnomaly, el.e);
  return positionAtEccentricAnomaly(el, E, out);
}

/** Orbital period in days from the semi-major axis (Kepler's third law). */
export function orbitalPeriodDays(semiMajorAxisAu) {
  return 365.256363 * Math.pow(semiMajorAxisAu, 1.5);
}

/** Wraps to [-PI, PI], which is where the Newton solve behaves best. */
function normalizeAngle(radians) {
  let a = (radians + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
