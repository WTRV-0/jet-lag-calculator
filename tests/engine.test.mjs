// Run with: node tests/engine.test.mjs
import assert from 'node:assert/strict';
import { buildPlan, chooseShift, alertness, alertLabel, norm12 } from '../js/engine.js';
import { cityById, CITIES, searchPlaces } from '../js/cities.js';
import { offsetHours, zonedToUtc, localMinutes, localDateISO, addDaysISO, HOUR } from '../js/tz.js';
import { sunTimes } from '../js/sun.js';
import { buildIcs } from '../js/ics.js';

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const city = (id) => { const c = cityById(id); assert.ok(c, `unknown city ${id}`); return c; };

function plan(from, to, dep, depT, arr, arrT, extra = {}) {
  return buildPlan({
    home: city(from), dest: city(to), depDate: dep, depTime: hm(depT), arrDate: arr, arrTime: hm(arrT),
    bed: hm('23:00'), wake: hm('07:00'), retDate: null, retTime: hm('12:00'), prepDays: 3,
    goal: 'auto', melatonin: true, caffeine: true, ...extra,
  });
}
const localH = (tz, t) => localMinutes(tz, t) / 60;
const postRows = (leg) => leg.rows.filter((r) => (r.kind === 'arrival' || r.kind === 'post') && !r.adjusted);

// ---------------------------------------------------------------------------
test('time-zone offsets follow DST', () => {
  assert.equal(offsetHours('America/New_York', Date.UTC(2026, 2, 7, 12)), -5);
  assert.equal(offsetHours('America/New_York', Date.UTC(2026, 2, 9, 12)), -4);
  assert.equal(offsetHours('Europe/London', Date.UTC(2026, 9, 24, 12)), 1);
  assert.equal(offsetHours('Europe/London', Date.UTC(2026, 9, 26, 12)), 0);
  assert.equal(offsetHours('Asia/Kolkata', Date.UTC(2026, 0, 1)), 5.5);
  assert.equal(offsetHours('Asia/Kathmandu', Date.UTC(2026, 0, 1)), 5.75);
  const t = zonedToUtc('Australia/Sydney', '2026-10-04', 9 * 60); // day DST starts
  assert.equal(localMinutes('Australia/Sydney', t), 9 * 60);
  assert.equal(localDateISO('Australia/Sydney', t), '2026-10-04');
});

test('norm12 folds into (−12, 12]', () => {
  assert.equal(norm12(14), -10);
  assert.equal(norm12(-14), 10);
  assert.equal(norm12(12), 12);
  assert.equal(norm12(-12), 12);
  assert.equal(norm12(0), 0);
});

test('direction choice: east advances unless 9+ h would remain on landing', () => {
  assert.equal(chooseShift(5).dir, 'advance');
  assert.equal(chooseShift(8).dir, 'advance');
  const nine = chooseShift(9, 0);
  assert.equal(nine.dir, 'delay');
  assert.equal(nine.flipped, true);
  assert.equal(nine.amount, 15);
  assert.equal(chooseShift(9, 3).dir, 'advance', 'a 3-day pre-shift makes a 9 h advance workable');
  assert.equal(chooseShift(10, 3).dir, 'advance');
  assert.equal(chooseShift(11, 1).flipped, true);
  assert.equal(chooseShift(12, 3).dir, 'delay', '12 h either way: later is easier');
  assert.equal(chooseShift(-10).dir, 'delay');
  assert.equal(chooseShift(-10).flipped, false);
  assert.equal(chooseShift(0).dir, 'none');
});

test('sunrise/sunset London within a few minutes of published times', () => {
  const june = sunTimes('2026-06-21', 51.51, -0.13);
  const dec = sunTimes('2026-12-21', 51.51, -0.13);
  const near = (t, h, m) => Math.abs(localMinutes('Europe/London', t) - (h * 60 + m)) <= 4;
  assert.ok(near(june.rise, 4, 43), 'June sunrise');
  assert.ok(near(june.set, 21, 21), 'June sunset');
  assert.ok(near(dec.rise, 8, 4), 'Dec sunrise');
  assert.ok(near(dec.set, 15, 53), 'Dec sunset');
  assert.equal(sunTimes('2026-12-21', 69.65, 18.96).polar, 'night');
  assert.equal(sunTimes('2026-06-21', 69.65, 18.96).polar, 'day');
});

test('New York → London (+5, east): morning light, dim evenings, melatonin', () => {
  const p = plan('new-york-united-states', 'london-united-kingdom', '2026-10-10', '19:00', '2026-10-11', '07:00', { retDate: '2026-10-24' });
  assert.equal(p.summary.diff, 5);
  assert.equal(p.out.dir, 'advance');
  assert.equal(p.summary.strategy, 'adjust');
  const rows = postRows(p.out);
  assert.ok(rows.length >= 1);
  for (const r of rows) {
    for (const w of r.own.seek) assert.ok(localH(r.tz, w.start) < 12, `seek should be morning, got ${localH(r.tz, w.start)}`);
    for (const w of r.own.avoid) assert.ok(localH(r.tz, w.start) >= 15, `avoid should be evening, got ${localH(r.tz, w.start)}`);
  }
  assert.ok(p.out.melatonin.length > 0, 'eastbound gets melatonin reminders');
  for (const m of p.out.melatonin) {
    const bed = p.out.sleeps.find((s) => s.start - m.at === 45 * 60000);
    assert.ok(bed, 'melatonin is 45 min before a bedtime');
  }
});

test('London → New York (−5, west): evening light, dim mornings, no melatonin', () => {
  const p = plan('london-united-kingdom', 'new-york-united-states', '2026-10-10', '10:00', '2026-10-10', '13:00');
  assert.equal(p.summary.diff, -5);
  assert.equal(p.out.dir, 'delay');
  for (const r of postRows(p.out)) {
    for (const w of r.own.seek) assert.ok(localH(r.tz, w.start) >= 15, `seek should be evening, got ${localH(r.tz, w.start)}`);
    for (const w of r.own.avoid) assert.ok(localH(r.tz, w.start) < 12, `avoid should be morning, got ${localH(r.tz, w.start)}`);
  }
  assert.equal(p.out.melatonin.length, 0);
});

test('Chicago → Tokyo (+14 h clocks = 10 h delay): evening light, avoid morning light', () => {
  const p = plan('chicago-united-states', 'tokyo-japan', '2026-10-10', '11:45', '2026-10-11', '14:55', { retDate: '2026-10-20', retTime: hm('17:00') });
  assert.equal(p.summary.diff, -10);
  assert.equal(p.out.dir, 'delay');
  assert.equal(p.out.P, -10);
  // prep days at home: evening light, morning darkness
  for (const r of p.out.rows.filter((x) => x.kind === 'prep')) {
    assert.ok(r.own.seek.length > 0);
    for (const w of r.own.seek) { const h = localH(r.tz, w.start); assert.ok(h >= 18 || h < 3, `prep seek evening, got ${h}`); }
    for (const w of r.own.avoid) { const h = localH(r.tz, w.start); assert.ok(h >= 6 && h < 12, `prep avoid morning, got ${h}`); }
  }
  // after landing: light in the afternoon/evening
  for (const r of postRows(p.out)) for (const w of r.own.seek) assert.ok(localH(r.tz, w.start) >= 12, 'post seek is afternoon/evening');
  assert.ok(p.out.daysToAdjust >= 4 && p.out.daysToAdjust <= 8, `days to adjust ${p.out.daysToAdjust}`);
  assert.ok(p.ret, 'return leg built');
  assert.ok([10, -14].includes(p.ret.P), `return shifts back 10 h earlier or 14 h later, got ${p.ret.P}`);
});

test('London → Tokyo in winter (+9): advance with prep days, avoiding early-morning light at first', () => {
  const p = plan('london-united-kingdom', 'tokyo-japan', '2026-11-10', '19:00', '2026-11-11', '15:30');
  assert.equal(p.summary.diff, 9);
  assert.equal(p.out.dir, 'advance');
  const day2 = p.out.rows.find((r) => r.kind === 'post');
  assert.ok(day2.own.avoid.some((w) => localH(day2.tz, w.start) < 9), 'avoid early-morning light on day 2');
  assert.ok(day2.own.seek.every((w) => localH(day2.tz, w.start) >= 8), 'light comes later in the morning');
  const p0 = plan('london-united-kingdom', 'tokyo-japan', '2026-11-10', '19:00', '2026-11-11', '15:30', { prepDays: 0 });
  assert.equal(p0.out.dir, 'delay', 'without pre-shifting, the clock tends to go the long way (Burgess)');
});

test('LA → Sydney is a delay', () => {
  const p = plan('los-angeles-united-states', 'sydney-australia', '2026-11-10', '22:30', '2026-11-12', '07:00');
  assert.equal(p.summary.diff, -5);
  assert.equal(p.out.dir, 'delay');
});

test('short trip (2 days or less) stays on home time', () => {
  const p = plan('new-york-united-states', 'paris-france', '2026-10-10', '18:00', '2026-10-11', '07:30', { retDate: '2026-10-13', retTime: hm('06:00') });
  assert.equal(p.summary.strategy, 'home');
  assert.equal(p.out.P, 0);
  assert.equal(p.out.seek.length, 0);
  // sleep in Paris is on New York night: 23:00 NY = 05:00 Paris
  const s = p.out.sleeps.filter((x) => x.place === 'dest')[1];
  const m = localMinutes('Europe/Paris', s.start);
  assert.ok(m >= 4 * 60 && m <= 6 * 60, `home-time bedtime in Paris should be ~05:00, got ${m / 60}`);
});

test('stays over 2 days adjust; "meet halfway" only when chosen', () => {
  const p = plan('new-york-united-states', 'paris-france', '2026-10-10', '18:00', '2026-10-11', '07:30', { retDate: '2026-10-13', retTime: hm('10:00') });
  assert.equal(p.summary.strategy, 'adjust');
  const q = plan('new-york-united-states', 'paris-france', '2026-10-10', '18:00', '2026-10-11', '07:30', { retDate: '2026-10-15', retTime: hm('10:00'), goal: 'partial' });
  assert.equal(q.summary.strategy, 'partial');
  assert.equal(q.out.P, 3);
});

test('explicit goal overrides auto', () => {
  const p = plan('new-york-united-states', 'paris-france', '2026-10-10', '18:00', '2026-10-11', '07:30', { retDate: '2026-10-13', retTime: hm('06:00'), goal: 'adjust' });
  assert.equal(p.summary.strategy, 'adjust');
  assert.equal(p.summary.reason, 'chosen');
  assert.equal(p.summary.autoStrategy, 'home');
});

test('pre-trip shift is at most 1 h per day', () => {
  const p = plan('new-york-united-states', 'london-united-kingdom', '2026-10-10', '19:00', '2026-10-11', '07:00');
  const prep = p.out.sleeps.filter((s) => s.place === 'origin').map((s) => s.shiftH);
  assert.deepEqual(prep, [0, 1, 2, 3]);
  for (let i = 1; i < p.out.cbts.length; i++) {
    const c = p.out.cbts[i - 1];
    if (c.phase === 'prep') assert.ok(Math.abs(c.step) <= 1);
  }
  const p2 = plan('new-york-united-states', 'london-united-kingdom', '2026-10-10', '19:00', '2026-10-11', '07:00', { prepDays: 1 });
  assert.equal(p2.out.prep, 1);
});

test('in-flight sleep falls in destination night', () => {
  for (const [a, b, d, dt, ad, at] of [
    ['new-york-united-states', 'london-united-kingdom', '2026-10-10', '19:00', '2026-10-11', '07:00'],
    ['chicago-united-states', 'tokyo-japan', '2026-10-10', '11:45', '2026-10-11', '14:55'],
    ['london-united-kingdom', 'singapore-singapore', '2026-10-10', '21:00', '2026-10-11', '17:30'],
  ]) {
    const p = plan(a, b, d, dt, ad, at);
    const tz = p.summary.dest.tz;
    assert.ok(p.out.flightSleeps.length > 0, `${a}→${b} has in-flight sleep`);
    for (const s of p.out.flightSleeps) {
      assert.ok(s.start >= p.times.depUtc && s.end <= p.times.arrUtc);
      for (const t of [s.start + 60000, s.end - 60000]) {
        const h = localH(tz, t);
        assert.ok(h >= 23 || h < 7, `${a}→${b} flight sleep at dest ${h}`);
      }
    }
  }
});

test('event mode flags a body-clock-night event and picks a better strategy', () => {
  assert.ok(alertness(0) < 0.1);
  assert.equal(alertLabel(alertness(0)).key, 'night');
  assert.equal(alertLabel(alertness(12)).key, 'sharp');
  const p = plan('new-york-united-states', 'paris-france', '2026-10-10', '18:00', '2026-10-11', '07:30', {
    retDate: '2026-10-13', retTime: hm('06:00'), goal: 'event', event: { date: '2026-10-12', time: hm('09:00') },
  });
  const home = p.event.compare.find((c) => c.strategy === 'home');
  assert.equal(home.label.key, 'night', '09:00 Paris is 03:00 in New York');
  assert.notEqual(p.event.strategy, 'home');
  assert.ok(p.event.score > home.score);
});

test('light windows never overlap sleep, and seek/avoid never overlap each other', () => {
  const ids = CITIES.map((c) => c.id);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let checked = 0;
  for (let i = 0; i < 150; i++) {
    const a = ids[Math.floor(rnd() * ids.length)];
    const b = ids[Math.floor(rnd() * ids.length)];
    const dep = addDaysISO('2026-01-05', Math.floor(rnd() * 360));
    const dur = 60 + Math.floor(rnd() * 20 * 60);
    const ret = rnd() < 0.6 ? addDaysISO(dep, 2 + Math.floor(rnd() * 20)) : null;
    const bed = [21, 22, 23, 0, 1][Math.floor(rnd() * 5)] * 60;
    const p = buildPlan({
      home: city(a), dest: city(b), depDate: dep, depTime: Math.floor(rnd() * 96) * 15, arrDate: null, arrTime: null,
      durationMin: dur, bed, wake: (bed + 8 * 60) % 1440, retDate: ret, retTime: 12 * 60, prepDays: Math.floor(rnd() * 4),
      goal: ['auto', 'adjust', 'home', 'partial'][Math.floor(rnd() * 4)], melatonin: true, caffeine: true,
    });
    for (const leg of [p.out, p.ret].filter(Boolean)) {
      const sleeps = [...leg.sleeps, ...leg.flightSleeps];
      for (const w of [...leg.seek, ...leg.avoid]) {
        assert.ok(w.end > w.start);
        for (const s of sleeps) assert.ok(w.end <= s.start || w.start >= s.end, `${a}→${b} window overlaps sleep`);
      }
      for (const w of leg.seek) for (const v of leg.avoid) assert.ok(w.end <= v.start || w.start >= v.end, `${a}→${b} seek overlaps avoid`);
      assert.ok(leg.rows.length >= 2);
      checked++;
    }
  }
  assert.ok(checked >= 150);
});

test('city search finds names, airport codes and accents', () => {
  assert.equal(searchPlaces('NRT')[0].name, 'Tokyo');
  assert.equal(searchPlaces('lhr')[0].name, 'London');
  assert.equal(searchPlaces('sao paulo')[0].name, 'São Paulo');
  assert.equal(searchPlaces('zurich')[0].name, 'Zurich');
  assert.ok(searchPlaces('Reykjavik').length > 0);
});

test('calendar export is valid iCalendar', () => {
  const p = plan('chicago-united-states', 'tokyo-japan', '2026-10-10', '11:45', '2026-10-11', '14:55', { retDate: '2026-10-20', retTime: hm('17:00') });
  const ics = buildIcs(p, { fT: (tz, t) => new Date(t).toISOString().slice(11, 16), shortName: (x) => x.name });
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-2), 'END:VCALENDAR');
  const enc = new TextEncoder();
  for (const l of lines) assert.ok(enc.encode(l).length <= 75, `line too long: ${l}`);
  const begins = lines.filter((l) => l === 'BEGIN:VEVENT').length;
  const ends = lines.filter((l) => l === 'END:VEVENT').length;
  assert.equal(begins, ends);
  assert.ok(begins > 10);
});

test('a DST change overnight still wakes you at your usual local time', () => {
  const p = plan('london-united-kingdom', 'new-york-united-states', '2026-10-28', '10:00', '2026-10-28', '13:00');
  const night = p.out.sleeps.find((s) => localDateISO('America/New_York', s.end) === '2026-11-01');
  assert.ok(night, 'has the night US clocks go back');
  assert.equal(localMinutes('America/New_York', night.end), 7 * 60);
  assert.equal(localMinutes('America/New_York', night.start), 23 * 60);
});

test('melatonin follows the research: eastward 5+ zones from arrival night, none westward', () => {
  const east = plan('new-york-united-states', 'london-united-kingdom', '2026-10-10', '19:00', '2026-10-11', '07:00');
  assert.ok(east.out.melatonin.length >= 1 && east.out.melatonin.length <= 5);
  for (const m of east.out.melatonin) assert.ok(m.at > east.times.arrUtc, 'no melatonin before arrival (Cochrane)');
  const west = plan('london-united-kingdom', 'new-york-united-states', '2026-10-10', '10:00', '2026-10-10', '13:00', { prepDays: 0 });
  assert.equal(west.out.melatonin.length, 0, 'no melatonin for a westward shift');
  const shortEast = plan('new-york-united-states', 'reykjavik-iceland', '2026-10-10', '20:00', '2026-10-11', '06:00');
  assert.equal(shortEast.summary.diff, 4);
  assert.equal(shortEast.out.melatonin.length, 0, 'eastward under 5 zones: no melatonin');
});

test('caffeine cut-off is 6 h before bed (CDC)', () => {
  const p = plan('new-york-united-states', 'london-united-kingdom', '2026-10-10', '19:00', '2026-10-11', '07:00');
  for (const c of p.out.caffeine) assert.equal(c.bed - c.at, 6 * 3600000);
});

test('the timeline draws each flight exactly once, whatever the direction', () => {
  for (const [a, b, dep, dt, dur] of [
    ['chicago-united-states', 'warsaw-poland', '2026-10-02', '18:00', 480],
    ['chicago-united-states', 'tokyo-japan', '2026-10-07', '11:45', 790],
    ['london-united-kingdom', 'new-york-united-states', '2026-10-10', '10:00', 480],
    ['los-angeles-united-states', 'sydney-australia', '2026-11-01', '22:30', 870],
    ['tokyo-japan', 'los-angeles-united-states', '2026-11-01', '17:00', 600],
    ['new-york-united-states', 'london-united-kingdom', '2026-10-10', '23:55', 420],
  ]) {
    const p = buildPlan({ home: city(a), dest: city(b), depDate: dep, depTime: hm(dt), arrDate: null, arrTime: null,
      durationMin: dur, bed: hm('23:00'), wake: hm('07:00'), retDate: null, prepDays: 3, goal: 'auto', melatonin: true, caffeine: true });
    const rows = p.out.rows;
    const drawn = rows.reduce((sum, r) => sum + (r.flight ? r.flight.end - r.flight.start : 0), 0);
    assert.equal(drawn, dur * 60000, `${a}→${b}: flight drawn ${drawn / 3600000} h for a ${dur / 60} h flight`);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].visStart >= rows[i - 1].visEnd - 1, `${a}→${b}: rows overlap at ${rows[i].date}`);
    const planeSleep = rows.reduce((sum, r) => sum + r.flightSleeps.reduce((x, w) => x + w.end - w.start, 0), 0);
    const actual = p.out.flightSleeps.reduce((x, w) => x + w.end - w.start, 0);
    assert.equal(planeSleep, actual, `${a}→${b}: plane sleep drawn twice`);
  }
});

test('invalid input gives a helpful error', () => {
  assert.throws(() => plan('new-york-united-states', 'london-united-kingdom', '2026-10-10', '19:00', '2026-10-10', '07:00'), /after departure/);
});

for (const [name, fn] of tests) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} passed`);
void HOUR;
