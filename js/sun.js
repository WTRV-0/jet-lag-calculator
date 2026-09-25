// Sunrise / sunset from the NOAA-style sunrise equation (accurate to a few minutes).

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440587.5;
const J2000 = 2451545;

// dateISO is the local calendar date; lon is east-positive.
// Returns { rise, set } as UTC ms, or { polar: 'day' | 'night' }.
export function sunTimes(dateISO, lat, lon) {
  if (lat == null || lon == null) return null;
  const [y, m, d] = dateISO.split('-').map(Number);
  const jdMidnight = Date.UTC(y, m - 1, d) / DAY_MS + J1970;
  const jStar = jdMidnight + 0.5 - J2000 - lon / 360;
  const M = ((357.5291 + 0.98560028 * jStar) % 360 + 360) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = J2000 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  if (cosH < -1) return { polar: 'day' };
  if (cosH > 1) return { polar: 'night' };
  const w = Math.acos(cosH) / RAD / 360;
  return {
    rise: (jTransit - w - J1970) * DAY_MS,
    set: (jTransit + w - J1970) * DAY_MS,
  };
}
