// iCalendar export: light windows, bedtimes, melatonin and caffeine reminders for each leg.

const MIN = 60000;
const enc = new TextEncoder();

function stamp(t) {
  return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Fold lines at 75 octets without splitting multi-byte characters
function fold(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildIcs(plan, { fT, shortName }) {
  const now = stamp(Date.now());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Meridian//Jet Lag Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText(`Jet lag: ${shortName(plan.summary.home)} → ${shortName(plan.summary.dest)}`)}`];
  let n = 0;
  const add = (start, end, summary, desc, alarmMin) => {
    n += 1;
    lines.push('BEGIN:VEVENT', `UID:meridian-${start}-${n}@jetlag`, `DTSTAMP:${now}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${escText(summary)}`, `DESCRIPTION:${escText(desc)}`, 'TRANSP:TRANSPARENT');
    if (alarmMin != null) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(summary)}`, `TRIGGER:-PT${alarmMin}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  };

  for (const leg of [plan.out, plan.ret].filter(Boolean)) {
    const limit = leg.adjustedAt ? Math.max(leg.adjustedAt + 36 * 60 * MIN, leg.arrUtc + 24 * 60 * MIN) : leg.legEnd;
    const tzAt = (t) => (t < leg.depUtc ? leg.origin.tz : leg.dest.tz);
    for (const w of leg.seek) {
      if (w.start > limit) continue;
      add(w.start, w.end, '☀ Seek bright light', `Get outside or use bright light until ${fT(tzAt(w.end), w.end)}. Shifts your body clock in the right direction.`, 0);
    }
    for (const w of leg.avoid) {
      if (w.start > limit) continue;
      add(w.start, w.end, '🕶 Avoid bright light', `Dim lights, sunglasses outside, until ${fT(tzAt(w.end), w.end)}.`, 0);
    }
    for (const s of leg.sleeps) {
      if (s.start < leg.planStart || s.start > limit) continue;
      add(s.start, s.start + 15 * MIN, '🛏 Bedtime', `Lights out. Wake at ${fT(tzAt(s.end), s.end)}.`, 30);
    }
    for (const s of leg.flightSleeps) {
      add(s.start, s.end, '✈ Sleep on the plane', `It's night at your destination. Eye mask and earplugs, until ${fT(leg.dest.tz, s.end)} ${shortName(leg.dest)} time.`, 0);
    }
    for (const m of leg.melatonin) {
      if (m.at > limit) continue;
      add(m.at, m.at + 10 * MIN, '💊 Melatonin (optional)', '0.5–1 mg is usually enough (max 3 mg), 30–60 minutes before bed. Check with your doctor first.', 0);
    }
    for (const c of leg.caffeine) {
      if (c.at < leg.planStart || c.at > limit) continue;
      add(c.at, c.at + 5 * MIN, '☕ Last caffeine today', 'No more coffee, tea or energy drinks until tomorrow morning.', null);
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
