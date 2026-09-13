/**
 * Julian Day conversions. The simulation clock is a Julian Day number, which
 * is what the orbital element tables expect.
 */

export const J2000 = 2451545.0;
export const UNIX_EPOCH_JD = 2440587.5;
export const DAYS_PER_CENTURY = 36525;

export function dateToJulian(date) {
  return date.getTime() / 86400000 + UNIX_EPOCH_JD;
}

export function julianToDate(jd) {
  return new Date((jd - UNIX_EPOCH_JD) * 86400000);
}

/** Julian centuries since the J2000.0 epoch. */
export function centuriesSinceJ2000(jd) {
  return (jd - J2000) / DAYS_PER_CENTURY;
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDate(jd) {
  return dateFormatter.format(julianToDate(jd));
}

export function formatTime(jd) {
  return timeFormatter.format(julianToDate(jd));
}

/**
 * Human readable simulation rate, e.g. "6 hours/s", "1 day/s", "4.2 years/s".
 */
export function formatRate(daysPerSecond) {
  const d = Math.abs(daysPerSecond);
  if (d < 1 / 1440) return '0 s/s';
  if (d < 1 / 24) {
    const minutes = d * 1440;
    return `${round(minutes)} min/s`;
  }
  if (d < 1) {
    const hours = d * 24;
    return `${round(hours)} ${round(hours) === '1' ? 'hour' : 'hours'}/s`;
  }
  if (d < 365.25) {
    return `${round(d)} ${round(d) === '1' ? 'day' : 'days'}/s`;
  }
  const years = d / 365.25;
  return `${round(years)} ${round(years) === '1' ? 'year' : 'years'}/s`;
}

function round(n) {
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return String(Math.round(n * 10) / 10);
  return String(Math.round(n * 100) / 100);
}
