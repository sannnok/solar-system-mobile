/**
 * Turning real distances into a scene you can actually look at.
 *
 * A true-to-scale solar system is mostly empty space: at Neptune's distance the
 * inner planets are a single pixel. So radii and orbital distances are each
 * compressed with a power curve. Direction and timing stay exact — only the
 * magnitudes are squashed — so planets are always in their real positions as
 * seen from above the ecliptic.
 */

export const EARTH_RADIUS_KM = 6371;

/** Scene units for a body 1 AU from the Sun. */
export const AU_UNIT = 12;
/** Radial compression. 0.5 keeps Mercury clear of the Sun and Neptune on screen. */
export const DISTANCE_EXP = 0.5;

/** Scene units for an Earth-sized body. */
export const RADIUS_UNIT = 0.34;
export const RADIUS_EXP = 0.4;
export const MIN_RADIUS = 0.115;

/** Moons use a softer curve relative to their parent so they stay readable. */
export const MOON_RADIUS_EXP = 0.6;
export const MIN_MOON_RADIUS = 0.045;

export function sceneRadiusFromKm(radiusKm) {
  const relative = radiusKm / EARTH_RADIUS_KM;
  return Math.max(MIN_RADIUS, RADIUS_UNIT * Math.pow(relative, RADIUS_EXP));
}

export function sceneMoonRadius(parentRadiusKm, parentSceneRadius, moonRadiusKm) {
  const relative = moonRadiusKm / parentRadiusKm;
  return Math.max(MIN_MOON_RADIUS, parentSceneRadius * Math.pow(relative, MOON_RADIUS_EXP));
}

/**
 * Moon orbits are compressed hard — the Moon really sits 60 Earth radii out,
 * which would be invisible here. Ordering within a system is preserved.
 */
export function sceneMoonOrbit(parentRadiusKm, parentSceneRadius, moonOrbitKm) {
  const ratio = moonOrbitKm / parentRadiusKm;
  const t = (Math.log(ratio) - Math.log(5)) / (Math.log(65) - Math.log(5));
  const clamped = Math.max(0, Math.min(1, t));
  return parentSceneRadius * (2.1 + 2.6 * clamped);
}

export function sceneDistanceFromAu(au) {
  return AU_UNIT * Math.pow(Math.max(au, 1e-6), DISTANCE_EXP);
}

/**
 * Converts a heliocentric ecliptic position (AU) into scene coordinates.
 * The ecliptic plane is XY in the source data and XZ in three.js (Y is up),
 * so the axes are swapped to keep the frame right-handed.
 */
export function auToScene(pos, out) {
  const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
  const scale = r > 1e-9 ? sceneDistanceFromAu(r) / r : 0;
  return out.set(pos.x * scale, pos.z * scale, -pos.y * scale);
}

/** Heliocentric distance in AU, for the live readout in the info panel. */
export function auDistance(pos) {
  return Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
}
