// Circadian planning engine. Pure functions, no DOM.
//
// Model in one paragraph: the body clock is treated as a "body time zone". It starts in the
// home zone and moves toward the target zone by a limited amount per day (advance ≈ 1 h/day,
// delay ≈ 1.5 h/day, both within the 60–120 min/day physiological range). The core body
// temperature minimum (CBTmin) sits ~3 h before habitual wake time on the body clock. Light
// in the hours after CBTmin advances the clock (earlier); light in the hours before it delays
// the clock (later). Every recommendation is derived from where CBTmin falls on the clock
// you are living by that day.

import {
  MIN, HOUR, DAY, offsetHours, zonedToUtc, localMidnight, localDateISO,
  addDaysISO, daysBetweenISO,
} from './tz.js';
import { sunTimes } from './sun.js';

export const RATE = { advance: 1, delay: 1.5, prep: 1, travelFactor: 0.5 };
export const CBT_BEFORE_WAKE = 3; // hours
// Eastward trips normally shift earlier. When 9+ hours would still need advancing after the pre-trip days,
// arrival-day light lands just before the body-temperature low and the clock tends to shift later instead
// (Burgess 2011 jet-lag protocol; AASM review, Sack et al. 2007), so the plan goes that way.
export const LONG_WAY_THRESHOLD = 9;
// Melatonin evidence is for trips across 5 or more time zones (Cochrane review).
export const MELATONIN_MIN_ZONES = 5;
const SLOT = 15 * MIN;
const MAX_POST_DAYS = 14;

// Alertness by hours since body-clock CBTmin (0–23). Low at night, dip after lunch, high in the evening.
const ALERT = [0, 0.05, 0.15, 0.35, 0.55, 0.7, 0.78, 0.8, 0.75, 0.66, 0.7, 0.82,
  0.9, 0.95, 0.95, 0.9, 0.85, 0.75, 0.6, 0.45, 0.3, 0.2, 0.12, 0.05];

export function norm12(h) {
  let x = ((h % 24) + 24) % 24;
  if (x > 12) x -= 24;
  return x;
}

const mod = (a, n) => ((a % n) + n) % n;

// diff: hours the body must move (positive = destination clock is ahead = eastward).
// prepDays: pre-trip days that can be used to start shifting.
export function chooseShift(diff, prepDays = 0) {
  if (Math.abs(diff) < 0.01) return { dir: 'none', P: 0, amount: 0, flipped: false, days: 0 };
  if (diff > 0) {
    const adv = diff / RATE.advance;
    const del = (24 - diff) / RATE.delay;
    const remaining = diff - Math.min(prepDays, Math.ceil(diff)); // advance still needed on landing
    if (diff >= 12 || remaining >= LONG_WAY_THRESHOLD) {
      return { dir: 'delay', P: -(24 - diff), amount: 24 - diff, flipped: true, days: Math.ceil(del), altDays: Math.ceil(adv), remaining };
    }
    return { dir: 'advance', P: diff, amount: diff, flipped: false, days: Math.ceil(adv), altDays: Math.ceil(del), remaining };
  }
  return { dir: 'delay', P: diff, amount: -diff, flipped: false, days: Math.ceil(-diff / RATE.delay), altDays: Math.ceil((24 + diff) / RATE.advance) };
}

export function alertness(hoursSinceCbt) {
  const d = mod(hoursSinceCbt, 24);
  const i = Math.floor(d);
  const f = d - i;
  return ALERT[i] * (1 - f) + ALERT[(i + 1) % 24] * f;
}

export function alertLabel(score) {
  if (score >= 0.75) return { key: 'sharp', text: 'Sharp' };
  if (score >= 0.55) return { key: 'good', text: 'Good' };
  if (score >= 0.35) return { key: 'groggy', text: 'Groggy' };
  return { key: 'night', text: 'Body-clock night' };
}

// ---------------------------------------------------------------------------
// Input validation / normalisation

export function resolveTimes(input) {
  const { home, dest } = input;
  const depUtc = zonedToUtc(home.tz, input.depDate, input.depTime);
  let arrUtc;
  if (input.arrDate && input.arrTime != null) arrUtc = zonedToUtc(dest.tz, input.arrDate, input.arrTime);
  else if (input.durationMin) arrUtc = depUtc + input.durationMin * MIN;
  else throw new Error('Add an arrival time or a flight duration.');
  const flightMin = (arrUtc - depUtc) / MIN;
  if (flightMin <= 0) throw new Error('Arrival must be after departure. Check the dates and times — arrival is in destination local time.');
  if (flightMin > 40 * 60) throw new Error('That trip takes more than 40 hours door to door. Check the arrival date.');
  let retDepUtc = null;
  let retArrUtc = null;
  if (input.retDate) {
    retDepUtc = zonedToUtc(dest.tz, input.retDate, input.retTime ?? 12 * 60);
    if (retDepUtc <= arrUtc + 2 * HOUR) throw new Error('The return flight must be after you arrive.');
    retArrUtc = retDepUtc + (input.retDurationMin || flightMin) * MIN;
  }
  let eventUtc = null;
  if (input.goal === 'event' && input.event && input.event.date && input.event.time != null) {
    eventUtc = zonedToUtc(dest.tz, input.event.date, input.event.time);
  }
  return { depUtc, arrUtc, flightMin, retDepUtc, retArrUtc, eventUtc };
}

// ---------------------------------------------------------------------------
// One leg (outbound or return)

function nightStart(tz, dateISO, bedMin) {
  let b = mod(Math.round(bedMin), 1440);
  if (b < 12 * 60) b += 1440; // after-midnight bedtimes belong to the previous evening's night
  return zonedToUtc(tz, dateISO, b);
}

// End of that night's sleep on the wall clock (so a DST change overnight still wakes you at the usual time)
function nightEnd(tz, dateISO, bedMin, sleepMin) {
  let b = mod(Math.round(bedMin), 1440);
  if (b < 12 * 60) b += 1440;
  return zonedToUtc(tz, dateISO, b + sleepMin);
}

function roundHalf(x) {
  return Math.round(x * 2) / 2;
}

function buildLeg(o) {
  const {
    origin, dest, depUtc, arrUtc, bed, wake, prepDays, bodyStart, strategy,
    melatonin, caffeine, hardEnd, originBedShiftH = 0, leg,
  } = o;
  const oH = offsetHours(origin.tz, depUtc);
  const oD = offsetHours(dest.tz, arrUtc);
  const diff = norm12(oD - bodyStart);
  const choice = chooseShift(diff, prepDays);
  let P = choice.P;
  if (strategy === 'home') P = 0;
  if (strategy === 'partial') P = roundHalf(choice.P / 2);
  const sign = Math.sign(P);
  const dir = P > 0 ? 'advance' : P < 0 ? 'delay' : 'none';
  const rate = dir === 'advance' ? RATE.advance : RATE.delay;
  const T = bodyStart + P; // body zone once the plan is complete
  const sleepLen = mod(wake - bed, 1440) * MIN;
  // keep every boundary on the 15-minute grid the light-window scan uses
  const up = (x) => Math.ceil(x / SLOT) * SLOT;
  const down = (x) => Math.floor(x / SLOT) * SLOT;
  const cbtBody = wake / 60 - CBT_BEFORE_WAKE;
  const depDate = localDateISO(origin.tz, depUtc);
  const arrDate = localDateISO(dest.tz, arrUtc);
  const prep = P !== 0 ? Math.min(prepDays, Math.ceil(Math.abs(P))) : 0;

  // ---- Sleep episodes -------------------------------------------------------
  const sleeps = [];
  const airportBuffer = 2 * HOUR;
  const originBed = bed + originBedShiftH * 60;
  for (let j = -1; j < prep; j++) {
    const date = addDaysISO(depDate, -prep + j);
    const shiftH = sign * Math.min(j + 1, Math.abs(P));
    const start = nightStart(origin.tz, date, originBed - shiftH * 60);
    let end = nightEnd(origin.tz, date, originBed - shiftH * 60, sleepLen / MIN);
    if (start >= depUtc - airportBuffer) continue;
    end = Math.min(end, down(depUtc - airportBuffer));
    if (end - start < 2 * HOUR) continue;
    sleeps.push({ start, end, place: 'origin', shiftH, prepIndex: j + 1 });
  }
  const firstWake = sleeps.length ? sleeps[0].end : depUtc - 6 * HOUR;
  const planStart = Math.min(firstWake, depUtc - 3 * HOUR);

  // Target sleep window in destination clock time
  const destBed = bed + norm12(oD - T) * 60;

  // In-flight sleep aligned to destination (target) night
  const flightSleeps = [];
  const fStart = up(depUtc + 45 * MIN);
  const fEnd = down(arrUtc - 30 * MIN);
  for (let d = -1; d <= daysBetweenISO(localDateISO(dest.tz, depUtc), arrDate) + 1; d++) {
    const date = addDaysISO(localDateISO(dest.tz, depUtc), d);
    const s = nightStart(dest.tz, date, destBed);
    const e = nightEnd(dest.tz, date, destBed, sleepLen / MIN);
    const a = Math.max(s, fStart);
    const b = Math.min(e, fEnd);
    if (b - a >= 60 * MIN) flightSleeps.push({ start: a, end: b, place: 'flight' });
  }

  // ---- Phase simulation (one step per CBTmin) --------------------------------
  const cbts = [];
  let t = planStart - CBT_BEFORE_WAKE * HOUR;
  {
    // align to the true body-clock CBTmin nearest to planStart − 3 h
    const cbtUtcHour = cbtBody - bodyStart;
    const dayStartUtc = Math.floor(t / DAY) * DAY;
    let cand = dayStartUtc + mod(cbtUtcHour, 24) * HOUR;
    while (cand > t + 12 * HOUR) cand -= DAY;
    while (cand < t - 12 * HOUR) cand += DAY;
    t = cand;
  }
  const horizonCap = Math.min(hardEnd ?? Infinity, arrUtc + (MAX_POST_DAYS + 1) * DAY);
  let phi = 0;
  let adjustedAt = Math.abs(P) < 0.01 ? t : null;
  for (let k = 0; k < 60 && t < horizonCap + DAY; k++) {
    let phase;
    let step;
    if (k < prep && t < depUtc) { phase = 'prep'; step = sign * RATE.prep; }
    else if (t < arrUtc) { phase = 'travel'; step = sign * rate * RATE.travelFactor; }
    else { phase = 'post'; step = sign * rate; }
    const remaining = P - phi;
    if (Math.abs(step) > Math.abs(remaining)) step = remaining;
    cbts.push({ t, phi, phase, step, bodyZone: bodyStart + phi });
    phi += step;
    t = t + DAY - step * HOUR;
    if (adjustedAt == null && Math.abs(P - phi) < 0.01) adjustedAt = t;
  }

  const phiAtRaw = (x) => {
    let last = cbts[0];
    for (const c of cbts) { if (c.t <= x) last = c; else break; }
    return last ? last.phi : 0;
  };

  let legEnd;
  if (hardEnd != null) legEnd = hardEnd;
  else if (strategy === 'home') legEnd = localMidnight(dest.tz, addDaysISO(arrDate, 3));
  else {
    const doneDate = localDateISO(dest.tz, Math.max(adjustedAt ?? arrUtc, arrUtc));
    legEnd = localMidnight(dest.tz, addDaysISO(doneDate, 2));
  }
  legEnd = Math.min(legEnd, localMidnight(dest.tz, addDaysISO(arrDate, MAX_POST_DAYS + 1)));

  // Post-arrival nights on the target schedule
  for (let d = -1; ; d++) {
    const date = addDaysISO(arrDate, d);
    let start = nightStart(dest.tz, date, destBed);
    const end = nightEnd(dest.tz, date, destBed, sleepLen / MIN);
    if (start >= legEnd - (hardEnd != null ? airportBuffer : 0)) break;
    if (end <= arrUtc + 30 * MIN) continue;
    if (start < arrUtc + 45 * MIN) {
      start = up(arrUtc + 45 * MIN);
      if (end - start < 2 * HOUR) continue;
    }
    let e2 = end;
    if (hardEnd != null) e2 = Math.min(end, down(hardEnd - airportBuffer));
    if (e2 - start < 2 * HOUR) continue;
    sleeps.push({ start, end: e2, place: 'dest' });
    if (d > MAX_POST_DAYS + 2) break;
  }
  const allSleeps = [...sleeps, ...flightSleeps].sort((a, b) => a.start - b.start);

  const isAwake = (x) => x >= planStart && x < legEnd && !allSleeps.some((s) => x >= s.start && x < s.end);
  const slotAwake = (s) => isAwake(s + SLOT / 2);
  const align = (x, up) => (up ? Math.ceil(x / SLOT) : Math.floor(x / SLOT)) * SLOT;

  // First waking block after `from`: up to 4 h, preferring to stay within 6 h (max 8 h) of the anchor
  function forwardWindow(anchor) {
    const hard = anchor + 8 * HOUR;
    let a = align(anchor, true);
    while (a < hard && !slotAwake(a)) a += SLOT;
    if (a >= hard) return null;
    let e = a;
    while (e < hard && slotAwake(e) && e - a < 4 * HOUR && (e < anchor + 6 * HOUR || e - a < 2 * HOUR)) e += SLOT;
    return e - a >= 30 * MIN ? [a, e] : null;
  }
  function backwardWindow(anchor) {
    const hard = anchor - 8 * HOUR;
    let b = align(anchor, false);
    while (b > hard && !slotAwake(b - SLOT)) b -= SLOT;
    if (b <= hard) return null;
    let s = b;
    while (s > hard && slotAwake(s - SLOT) && b - s < 4 * HOUR && (s > anchor - 6 * HOUR || b - s < 2 * HOUR)) s -= SLOT;
    return b - s >= 30 * MIN ? [s, b] : null;
  }

  // ---- Light windows ---------------------------------------------------------
  const seek = [];
  const avoid = [];
  for (const c of cbts) {
    if (c.t > legEnd + 8 * HOUR || c.t < planStart - 8 * HOUR) continue;
    if (strategy === 'home' || P === 0) {
      if (strategy === 'home' && c.t > depUtc) {
        // hold the home clock: keep the hours either side of CBTmin dim
        const w1 = backwardWindow(c.t);
        const w2 = forwardWindow(c.t);
        for (const w of [w1, w2]) if (w && Math.abs(w[0] - c.t) < 4 * HOUR) avoid.push({ start: w[0], end: Math.min(w[1], w[0] + 2 * HOUR), cbt: c.t, hold: true });
      }
      continue;
    }
    if (Math.abs(c.step) < 0.01) continue; // already adjusted
    const after = forwardWindow(c.t);
    const before = backwardWindow(c.t);
    if (dir === 'advance') {
      if (after) seek.push({ start: after[0], end: after[1], cbt: c.t });
      if (before) avoid.push({ start: before[0], end: before[1], cbt: c.t });
    } else {
      if (before) seek.push({ start: before[0], end: before[1], cbt: c.t });
      if (after) avoid.push({ start: after[0], end: after[1], cbt: c.t });
    }
  }

  // Where you physically are at an instant (for daylight)
  const placeAt = (x) => (x < depUtc ? origin : x >= arrUtc ? dest : null);
  const annotateLight = (w, kind) => {
    const place = placeAt((w.start + w.end) / 2);
    if (!place) { w.light = 'flight'; return w; }
    const date = localDateISO(place.tz, w.start);
    const sun = sunTimes(date, place.lat, place.lon);
    if (!sun) { w.light = null; return w; }
    if (sun.polar) { w.light = sun.polar === 'day' ? 'sun' : 'dark'; return w; }
    const lit = Math.max(0, Math.min(w.end, sun.set) - Math.max(w.start, sun.rise));
    const frac = lit / (w.end - w.start);
    w.sunrise = sun.rise;
    w.sunset = sun.set;
    if (kind === 'seek') w.light = frac >= 0.95 ? 'sun' : frac <= 0.05 ? 'dark' : 'mixed';
    else w.light = frac > 0.05 ? 'daylight' : 'dark';
    return w;
  };
  seek.forEach((w) => annotateLight(w, 'seek'));
  avoid.forEach((w) => annotateLight(w, 'avoid'));

  // ---- Melatonin & caffeine --------------------------------------------------
  // Only for eastward (advance) trips across 5+ time zones, where the evidence is (Cochrane review):
  // an optional dose 30–60 min before local bedtime from the night you arrive, for up to 5 nights or until
  // adjusted (bedtime at destination on arrival day and the next 2–5 days; no benefit shown before
  // departure). Skipped if the body clock would read 00:00–05:00, when it is least effective (CDC).
  // Westward trips get none: bedtime melatonin can work against shifting later (AASM review), and
  // night-time dosing to shift later is untested in jet lag trials.
  const mel = [];
  const destSleeps = sleeps.filter((x) => x.place === 'dest');
  const stillShifting = (x) => adjustedAt == null || x.start < adjustedAt + 12 * HOUR;
  if (melatonin && strategy !== 'home' && dir === 'advance' && Math.abs(diff) >= MELATONIN_MIN_ZONES) {
    for (const x of destSleeps.filter(stillShifting).slice(0, 5)) {
      const at = x.start - 45 * MIN;
      const bodyHour = mod(at / HOUR + bodyStart + phiAtRaw(at), 24);
      if (bodyHour < 5) continue;
      mel.push({ at, bed: x.start });
    }
  }
  const caf = [];
  if (caffeine) {
    for (const x of sleeps) if (x.start > planStart) caf.push({ at: x.start - 6 * HOUR, bed: x.start });
  }

  // ---- Rows (one per calendar day on the clock you are living by) -----------
  const rows = [];
  const phiAt = phiAtRaw;
  const bodyZoneAt = (x) => bodyStart + phiAt(x);
  // shift banked by the first body-clock low point after x (i.e. by the next morning)
  const phiAfter = (x) => {
    const c = cbts.find((k) => k.t >= x);
    return c ? c.phi : P;
  };

  const addRow = (kind, tz, place, date, extra = {}) => {
    const start = localMidnight(tz, date);
    const end = localMidnight(tz, addDaysISO(date, 1));
    rows.push({ kind, tz, place, date, start, end, leg, ...extra });
  };
  for (let j = 0; j < prep; j++) addRow('prep', origin.tz, origin, addDaysISO(depDate, -prep + j), { index: j + 1, of: prep });
  addRow('departure', origin.tz, origin, depDate);
  const lastDate = localDateISO(dest.tz, legEnd - 1);
  let n = 0;
  for (let date = arrDate; daysBetweenISO(date, lastDate) >= 0 && n <= MAX_POST_DAYS; date = addDaysISO(date, 1), n++) {
    if (hardEnd != null && localMidnight(dest.tz, date) >= hardEnd - 3 * HOUR) break;
    addRow(n === 0 ? 'arrival' : 'post', dest.tz, dest, date, { index: n + 1 });
  }

  // A "day" runs from the middle of one night's sleep to the middle of the next, so an
  // after-midnight bedtime still belongs to the evening it started in.
  const nightBoundary = (midnight) => {
    let best = null;
    for (const s of sleeps) {
      const m = (s.start + s.end) / 2;
      if (Math.abs(m - midnight) < 8 * HOUR && (!best || Math.abs(m - midnight) < Math.abs(best - midnight))) best = m;
    }
    return best ?? midnight;
  };

  // Each row draws its whole local day (vis) but only "owns" the part you actually spend there;
  // anything between departure and arrival belongs to the flight.
  const inRange = (x, a, b) => x >= a && x < b;
  const clip = (arr, a, b) => arr.filter((w) => w.end > a && w.start < b)
    .map((w) => ({ ...w, start: Math.max(w.start, a), end: Math.min(w.end, b), rawStart: w.start, rawEnd: w.end }));
  const pts = (arr, a, b) => arr.filter((p) => inRange(p.at, a, b));
  for (const r of rows) {
    r.visStart = r.kind === 'arrival' ? Math.max(r.start, depUtc) : r.start;
    r.visEnd = r.kind === 'departure' ? Math.min(r.end, arrUtc) : r.end;
    r.ownStart = r.kind === 'arrival' ? Math.max(r.start, arrUtc) : nightBoundary(r.start);
    r.ownEnd = r.kind === 'departure' ? Math.min(r.end, depUtc) : nightBoundary(r.end);
    const mid = r.kind === 'departure' ? Math.min(depUtc, (r.start + r.end) / 2) : Math.max(r.start + 12 * HOUR, r.kind === 'arrival' ? arrUtc : 0);
    r.bodyZone = bodyZoneAt(mid);
    r.localZone = offsetHours(r.tz, mid);
    r.bodyVsLocal = norm12(r.bodyZone - r.localZone); // + = body clock reads later than the local clock
    r.adjusted = adjustedAt != null && r.start + 12 * HOUR >= adjustedAt;
    const [a, b] = [r.visStart, r.visEnd];
    r.sleeps = clip(sleeps, a, b);
    r.flightSleeps = clip(flightSleeps, a, b);
    r.flight = depUtc < b && arrUtc > a ? { start: Math.max(depUtc, a), end: Math.min(arrUtc, b) } : null;
    r.seek = clip(seek, a, b);
    r.avoid = clip(avoid, a, b);
    r.melatonin = pts(mel, a, b);
    r.caffeine = pts(caf, r.ownStart, r.ownEnd);
    // what the day card lists: windows clipped to the part of the day this row owns
    r.own = {
      seek: clip(seek, r.ownStart, r.ownEnd),
      avoid: clip(avoid, r.ownStart, r.ownEnd),
      melatonin: pts(mel, r.ownStart, r.ownEnd),
    };
    r.cbt = cbts.filter((c) => inRange(c.t, a, b)).map((c) => c.t);
    r.sun = sunTimes(r.date, r.place.lat, r.place.lon);
    r.wakes = sleeps.filter((s) => inRange(s.end, r.ownStart, r.ownEnd) && s.end < legEnd - HOUR).map((s) => ({ at: s.end }));
    r.beds = sleeps.filter((s) => inRange(s.start, r.ownStart, r.ownEnd)).map((s) => ({ at: s.start, until: s.end, shiftH: s.shiftH ?? 0 }));
    r.outOfSync = Math.abs(r.bodyVsLocal) >= 3 && (r.kind === 'arrival' || r.kind === 'post');
  }

  const flight = {
    start: depUtc, end: arrUtc,
    sleeps: flightSleeps,
    seek: clip(seek, depUtc, arrUtc),
    avoid: clip(avoid, depUtc, arrUtc),
    cbt: cbts.filter((c) => inRange(c.t, depUtc, arrUtc)).map((c) => c.t),
    destBed,
  };

  const daysToAdjust = adjustedAt == null ? null : Math.max(0, daysBetweenISO(arrDate, localDateISO(dest.tz, Math.max(adjustedAt, arrUtc))));
  const adjustedDate = adjustedAt == null ? null : localDateISO(dest.tz, Math.max(adjustedAt, arrUtc));

  return {
    leg, origin, dest, oH, oD, diff, choice, P, dir, rate, prep, strategy, T,
    depUtc, arrUtc, planStart, legEnd, sleeps, flightSleeps, seek, avoid,
    melatonin: mel, caffeine: caf, cbts, rows, flight, adjustedAt, adjustedDate, daysToAdjust,
    bodyZoneAt, destBed, sleepLen,
    progress: rows.map((r) => ({
      kind: r.kind, date: r.date, index: r.index,
      shifted: Math.abs(phiAfter(r.ownEnd ?? r.end)),
      target: Math.abs(P), full: Math.abs(choice.P),
    })),
  };
}

// ---------------------------------------------------------------------------
// Strategy selection

// Short stays (2 days or less) across 3+ zones: keep home time (CDC; AASM 2007). Otherwise adjust.
function autoStrategy(diff, choice, tripDays) {
  const zones = Math.abs(diff);
  if (zones < 1) return { strategy: 'adjust', reason: 'small' };
  if (tripDays != null && tripDays <= 2 && zones >= 3) return { strategy: 'home', reason: 'short' };
  return { strategy: 'adjust', reason: tripDays != null ? 'long' : 'noreturn' };
}

function evaluateEvent(legPlan, eventUtc, wake) {
  const bodyZone = legPlan.bodyZoneAt(eventUtc);
  const bodyHour = mod(eventUtc / HOUR + bodyZone, 24);
  const since = mod(bodyHour - (wake / 60 - CBT_BEFORE_WAKE), 24);
  const score = alertness(since);
  return { eventUtc, bodyHour, since, score, label: alertLabel(score) };
}

export function buildPlan(input) {
  const times = resolveTimes(input);
  const { home, dest } = input;
  const oH = offsetHours(home.tz, times.depUtc);
  const oD = offsetHours(dest.tz, times.arrUtc);
  const diff = norm12(oD - oH);
  const choice = chooseShift(diff, input.prepDays || 0);
  const tripDays = times.retDepUtc ? (times.retDepUtc - times.arrUtc) / DAY : null;
  const auto = autoStrategy(diff, choice, tripDays);

  // the body is anchored to home time as it was when the plan starts (matters if DST changes mid-prep)
  const bodyHome = offsetHours(home.tz, times.depUtc - ((input.prepDays || 0) + 1) * DAY);
  const legFor = (strategy) => buildLeg({
    leg: 'out', origin: home, dest, depUtc: times.depUtc, arrUtc: times.arrUtc,
    bed: input.bed, wake: input.wake, prepDays: strategy === 'home' ? 0 : input.prepDays,
    bodyStart: bodyHome, strategy, melatonin: input.melatonin, caffeine: input.caffeine,
    hardEnd: times.retDepUtc,
  });

  let strategy = auto.strategy;
  let reason = auto.reason;
  let eventInfo = null;
  let out;
  if (input.goal === 'event' && times.eventUtc) {
    const candidates = ['adjust', 'home']; // "meet halfway" is not guideline-based, so only when chosen
    const results = candidates.map((s) => {
      const lp = legFor(s);
      return { strategy: s, plan: lp, ...evaluateEvent(lp, times.eventUtc, input.wake) };
    });
    let best = results.find((r) => r.strategy === auto.strategy) || results[0];
    for (const r of results) if (r.score > best.score + 0.05) best = r;
    strategy = best.strategy;
    reason = 'event';
    out = best.plan;
    eventInfo = {
      ...best,
      plan: undefined,
      compare: results.map((r) => ({ strategy: r.strategy, score: r.score, label: r.label, bodyHour: r.bodyHour })),
      beforeArrival: times.eventUtc < times.arrUtc,
      afterReturn: times.retDepUtc != null && times.eventUtc > times.retDepUtc,
    };
    delete eventInfo.plan;
  } else {
    if (['adjust', 'home', 'partial'].includes(input.goal)) { strategy = input.goal; reason = 'chosen'; }
    out = legFor(strategy);
  }

  let ret = null;
  if (times.retDepUtc) {
    const bodyAtReturn = out.bodyZoneAt(times.retDepUtc);
    ret = buildLeg({
      leg: 'return', origin: dest, dest: home, depUtc: times.retDepUtc, arrUtc: times.retArrUtc,
      bed: input.bed, wake: input.wake, prepDays: 0, bodyStart: bodyAtReturn, strategy: 'adjust',
      melatonin: input.melatonin, caffeine: input.caffeine, hardEnd: null,
      originBedShiftH: norm12(out.oD - out.T),
    });
  }

  return {
    input, times,
    summary: {
      home, dest, oH, oD, diff, zones: Math.abs(diff),
      travelDir: diff > 0.01 ? 'east' : diff < -0.01 ? 'west' : 'none',
      choice, strategy, reason, autoStrategy: auto.strategy, tripDays,
      flightMin: times.flightMin,
    },
    event: eventInfo,
    out, ret,
  };
}
