// Time-zone helpers built only on Intl, so DST is always correct for the date in question.

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const partsCache = new Map();

function partsFormatter(tz) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

// Wall-clock parts of an instant in a zone
export function localParts(tz, utcMs) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out; // {year, month, day, hour, minute, second}
}

// UTC offset of a zone at an instant, in minutes (e.g. +330 for India)
export function offsetMinutes(tz, utcMs) {
  const p = localParts(tz, utcMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / MIN);
}

export function offsetHours(tz, utcMs) {
  return offsetMinutes(tz, utcMs) / 60;
}

// Instant for a wall-clock time in a zone. `minutes` may exceed 1440 (rolls into later days).
export function zonedToUtc(tz, dateISO, minutes = 0) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d) + minutes * MIN;
  let guess = naive - offsetMinutes(tz, naive) * MIN;
  guess = naive - offsetMinutes(tz, guess) * MIN;
  return guess;
}

export function localMidnight(tz, dateISO) {
  return zonedToUtc(tz, dateISO, 0);
}

export function localDateISO(tz, utcMs) {
  const p = localParts(tz, utcMs);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// Minutes since local midnight
export function localMinutes(tz, utcMs) {
  const p = localParts(tz, utcMs);
  return p.hour * 60 + p.minute;
}

export function addDaysISO(dateISO, n) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysBetweenISO(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY);
}

export function parseHM(hm) {
  if (!hm || !/^\d{1,2}:\d{2}$/.test(hm)) return null;
  const [h, m] = hm.split(':').map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

// Short zone label such as "GMT+9" or "EDT"
export function zoneAbbr(tz, utcMs) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' });
    const part = f.formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName');
    return part ? part.value : tz;
  } catch {
    return tz;
  }
}

export function formatOffset(hours) {
  const sign = hours < 0 ? '−' : '+';
  const a = Math.abs(hours);
  const h = Math.floor(a);
  const m = Math.round((a - h) * 60);
  return `${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}
