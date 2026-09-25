import { searchPlaces, placeById, guessHome, cityById } from './cities.js';
import {
  HOUR, MIN, offsetHours, zonedToUtc, localDateISO, localMinutes, addDaysISO,
  daysBetweenISO, parseHM, formatOffset,
} from './tz.js';
import { buildPlan, chooseShift, norm12, resolveTimes } from './engine.js';
import { buildIcs } from './ics.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

// ---------------------------------------------------------------------------
// Formatting

const prefs = { clock24: store.get('meridian-clock24', null) };
if (prefs.clock24 == null) {
  try { prefs.clock24 = !/h1[12]/.test(new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle || ''); } catch { prefs.clock24 = true; }
}
const fmtCache = new Map();
function fmt(tz, opts) {
  const key = tz + JSON.stringify(opts) + prefs.clock24;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(prefs.clock24 ? 'en-GB' : 'en-US', { timeZone: tz, ...opts, ...(opts.hour ? { hourCycle: prefs.clock24 ? 'h23' : 'h12' } : {}) });
    fmtCache.set(key, f);
  }
  return f;
}
const fT = (tz, t) => fmt(tz, { hour: prefs.clock24 ? '2-digit' : 'numeric', minute: '2-digit' }).format(new Date(t)).replace(/\s?([AP]M)/, (m, p) => ' ' + p.toLowerCase());
const fD = (tz, t) => fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(t));
const fDiso = (iso) => fD('UTC', Date.parse(iso + 'T12:00:00Z'));
const fRange = (tz, a, b) => `${fT(tz, a)}–${fT(tz, b)}`;
function fBodyClock(hour) {
  const h = ((Math.round(hour * 4) / 4) % 24 + 24) % 24;
  const t = Date.UTC(2000, 0, 1) + h * HOUR;
  return fT('UTC', t);
}
function fDur(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h} h${m ? ` ${m} m` : ''}`;
}
function fHours(h) {
  const a = Math.abs(h);
  const s = Number.isInteger(a) ? String(a) : a.toFixed(a * 4 % 2 === 0 ? 1 : 2).replace(/0$/, '');
  return `${s} h`;
}
const placeLabel = (p) => (p ? (p.id.startsWith('tz:') ? `${p.name} (${p.tz})` : `${p.name}, ${p.country}`) : '');
const shortName = (p) => p.name.replace(/\s*\(.*\)$/, '');

// ---------------------------------------------------------------------------
// Form state

const state = { from: null, to: null, plan: null, leg: 'out', paramsKey: '' };
const els = {
  form: $('#trip-form'), fromInput: $('#from-input'), toInput: $('#to-input'),
  depDate: $('#dep-date'), depTime: $('#dep-time'), arrDate: $('#arr-date'), arrTime: $('#arr-time'),
  durH: $('#dur-h'), durM: $('#dur-m'), bed: $('#bed'), wake: $('#wake'),
  retDate: $('#ret-date'), retTime: $('#ret-time'), evDate: $('#ev-date'), evTime: $('#ev-time'),
  mel: $('#opt-mel'), caf: $('#opt-caf'), error: $('#form-error'), preview: $('#preview'),
  results: $('#results'), flightNote: $('#flight-note'),
};

const radio = (name) => ($(`input[name="${name}"]:checked`) || {}).value;
const setRadio = (name, value) => { const r = $(`input[name="${name}"][value="${value}"]`); if (r) r.checked = true; };

function setPlace(which, place) {
  state[which] = place;
  (which === 'from' ? els.fromInput : els.toInput).value = placeLabel(place);
  (which === 'from' ? els.fromInput : els.toInput).removeAttribute('aria-invalid');
  updateHints();
  updatePreview();
}

function updateHints() {
  $$('[data-hint]').forEach((h) => {
    const p = state[h.dataset.hint];
    h.textContent = p ? `${shortName(p)} time` : 'local';
  });
}

function syncModes() {
  const dur = radio('arr-mode') === 'duration';
  $('#arr-fields').hidden = dur;
  $('#dur-fields').hidden = !dur;
  $('#event-fields').hidden = radio('goal') !== 'event';
}

function readForm() {
  return {
    f: state.from?.id || '', t: state.to?.id || '',
    dd: els.depDate.value, dt: els.depTime.value,
    am: radio('arr-mode') === 'duration' ? 'd' : 'a',
    ad: els.arrDate.value, at: els.arrTime.value, dh: els.durH.value, dm: els.durM.value,
    b: els.bed.value, w: els.wake.value, rd: els.retDate.value, rt: els.retTime.value,
    p: radio('prep'), g: radio('goal'), ed: els.evDate.value, et: els.evTime.value,
    m: els.mel.checked ? '1' : '0', c: els.caf.checked ? '1' : '0',
  };
}

function writeForm(v) {
  if (v.f) { const p = placeById(v.f); if (p) setPlace('from', p); }
  if (v.t) { const p = placeById(v.t); if (p) setPlace('to', p); }
  const set = (el, val) => { if (val != null && val !== '') el.value = val; };
  set(els.depDate, v.dd); set(els.depTime, v.dt); set(els.arrDate, v.ad); set(els.arrTime, v.at);
  set(els.durH, v.dh); set(els.durM, v.dm); set(els.bed, v.b); set(els.wake, v.w);
  els.retDate.value = v.rd || ''; set(els.retTime, v.rt); set(els.evDate, v.ed); set(els.evTime, v.et);
  if (v.am) setRadio('arr-mode', v.am === 'd' ? 'duration' : 'arrival');
  if (v.p != null) setRadio('prep', v.p);
  if (v.g) setRadio('goal', v.g);
  if (v.m != null) els.mel.checked = v.m !== '0';
  if (v.c != null) els.caf.checked = v.c !== '0';
  syncModes();
  updatePreview();
}

function toInput(v) {
  const errors = [];
  const bad = (el, msg) => { if (el) el.setAttribute('aria-invalid', 'true'); errors.push(msg); };
  $$('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  if (!state.from) bad(els.fromInput, 'Choose where you are flying from.');
  if (!state.to) bad(els.toInput, 'Choose your destination.');
  if (!v.dd) bad(els.depDate, 'Add your departure date.');
  const depTime = parseHM(v.dt);
  if (depTime == null) bad(els.depTime, 'Add your departure time.');
  let arrTime = null;
  let durationMin = null;
  if (v.am === 'a') {
    arrTime = parseHM(v.at);
    if (!v.ad) bad(els.arrDate, 'Add your arrival date (destination local time).');
    if (arrTime == null) bad(els.arrTime, 'Add your arrival time (destination local time).');
  } else {
    durationMin = (Number(v.dh) || 0) * 60 + (Number(v.dm) || 0);
    if (!durationMin) bad(els.durH, 'Add the flight length.');
  }
  const bed = parseHM(v.b);
  const wake = parseHM(v.w);
  if (bed == null) bad(els.bed, 'Add your usual bedtime.');
  if (wake == null) bad(els.wake, 'Add your usual wake time.');
  if (bed != null && wake != null) {
    const len = ((wake - bed) % 1440 + 1440) % 1440;
    if (len < 4 * 60 || len > 13 * 60) bad(els.wake, 'Your usual sleep should be between 4 and 13 hours. Check bedtime and wake time.');
  }
  const goal = v.g || 'auto';
  let event = null;
  if (goal === 'event') {
    const et = parseHM(v.et);
    if (!v.ed) bad(els.evDate, 'Add the event date.');
    if (et == null) bad(els.evTime, 'Add the event time.');
    event = { date: v.ed, time: et };
  }
  if (errors.length) return { errors };
  return {
    input: {
      home: state.from, dest: state.to,
      depDate: v.dd, depTime, arrDate: v.am === 'a' ? v.ad : null, arrTime, durationMin,
      bed, wake, retDate: v.rd || null, retTime: parseHM(v.rt) ?? 12 * 60,
      prepDays: Number(v.p ?? 3), goal, event,
      melatonin: v.m !== '0', caffeine: v.c !== '0',
    },
  };
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = !msg;
}

// ---------------------------------------------------------------------------
// City combobox

function setupCombo(which) {
  const input = which === 'from' ? els.fromInput : els.toInput;
  const list = $(`#${which}-list`);
  let items = [];
  let active = -1;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; input.removeAttribute('aria-activedescendant'); };
  const render = () => {
    if (!items.length) {
      list.innerHTML = '<li class="c-empty" role="option" aria-disabled="true">No match. Try a nearby major city or an airport code.</li>';
    } else {
      list.innerHTML = items.map((p, i) => {
        const off = offsetHours(p.tz, Date.now());
        const meta = p.id.startsWith('tz:') ? `UTC${formatOffset(off)}` : `${esc(p.country)} · UTC${formatOffset(off)}`;
        const codes = p.codes.length ? ` <small class="muted">${esc(p.codes.slice(0, 2).join(' '))}</small>` : '';
        return `<li id="${which}-opt-${i}" role="option" aria-selected="${i === active}" data-i="${i}"><span class="c-name">${esc(p.name)}${codes}</span><span class="c-meta">${meta}</span></li>`;
      }).join('');
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${which}-opt-${active}`);
  };
  const choose = (i) => { if (items[i]) { setPlace(which, items[i]); close(); } };

  input.addEventListener('input', () => {
    state[which] = null;
    updatePreview();
    const q = input.value.trim();
    if (!q) { close(); return; }
    items = searchPlaces(q, 8);
    active = items.length ? 0 : -1;
    render();
  });
  input.addEventListener('focus', () => { if (!state[which] && input.value.trim()) input.dispatchEvent(new Event('input')); else if (state[which]) input.select(); });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter') { if (active >= 0) { e.preventDefault(); choose(active); } }
    else if (e.key === 'Escape') { close(); }
  });
  input.addEventListener('blur', () => setTimeout(() => {
    if (!state[which] && items.length === 1) choose(0);
    close();
  }, 150));
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) choose(Number(li.dataset.i)); });
}

// ---------------------------------------------------------------------------
// Live preview (route dial)

function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos((a - 90) * Math.PI / 180), cy + r * Math.sin((a - 90) * Math.PI / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const delta = a1 - a0;
  const large = Math.abs(delta) > 180 ? 1 : 0;
  const sweep = delta > 0 ? 1 : 0;
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

let previewTimer = null;
function updatePreview() {
  const { from, to } = state;
  if (!from || !to) {
    els.preview.innerHTML = `<div class="preview-empty">${icon('clock').replace('class="ic"', 'class="ic ic-lg"')}<p>Pick where you're flying from and to. The time gap, direction and both local clocks show up here as you type.</p></div>`;
    els.flightNote.textContent = '';
    return;
  }
  const refUtc = els.depDate.value ? zonedToUtc(from.tz, els.depDate.value, parseHM(els.depTime.value) ?? 12 * 60) : Date.now();
  const oH = offsetHours(from.tz, refUtc);
  const oD = offsetHours(to.tz, refUtc);
  const raw = oD - oH;
  const diff = norm12(raw);
  const prepDays = Number(radio('prep') ?? 3);
  const choice = chooseShift(diff, prepDays);
  const now = Date.now();
  const clock = (p) => `<div class="pv-clock"><div class="pv-city">${esc(shortName(p))}</div><div class="pv-time" data-live-tz="${esc(p.tz)}">${fT(p.tz, now)}</div><div class="pv-day">${fD(p.tz, now)} · UTC${formatOffset(offsetHours(p.tz, now))}</div></div>`;

  let gapText;
  let note;
  if (Math.abs(raw) < 0.01) {
    gapText = 'Same time zone. No jet lag to fix, just travel tiredness.';
    note = 'Sleep on your normal schedule and get some daylight in the morning.';
  } else {
    const aheadBehind = raw > 0 ? 'ahead of' : 'behind';
    gapText = `${esc(shortName(to))} is ${fHours(raw)} ${aheadBehind} ${esc(shortName(from))}${els.depDate.value ? ' on your travel date' : ' today'}.`;
    const days = `Roughly ${choice.days} day${choice.days === 1 ? '' : 's'} to adjust fully.`;
    if (choice.flipped && diff >= 12) note = `<b>Halfway round the world.</b> Either direction is ${fHours(12)}; shifting <em>later</em> is easier, so expect <b>evening light</b> and <b>dim mornings</b>. ${days}`;
    else if (choice.flipped) note = `<b>The rule flips here.</b> With ${fHours(choice.remaining)} still to shift earlier when you land, the body clock tends to drift <em>later</em> instead, so the plan goes ${fHours(choice.amount)} later: <b>evening light</b>, no morning light at first. ${days} More prep days would let it shift earlier.`;
    else if (choice.dir === 'advance') note = `Eastward shift: your clock needs to move <b>${fHours(choice.amount)} earlier</b>. Expect <b>morning light</b> and <b>dim evenings</b>${diff >= 8 ? ', but avoid early-morning light for the first days; light windows start later and move earlier each day' : ''}. ${days}`;
    else note = `Westward shift: your clock needs to move <b>${fHours(choice.amount)} later</b>. Expect <b>evening light</b> and <b>dim mornings</b>. ${days}`;
    if (Math.abs(raw) < 2) note = `<b>Little or no jet lag expected.</b> Jet lag usually needs 2+ time zones. ${note}`;
    else note += `<span class="pv-tip">Choosing flights? An arrival that lets you get ${choice.dir === 'advance' ? (diff >= 8 ? 'late-morning or midday' : 'morning') : 'afternoon or evening'} light on day one helps (CDC).</span>`;
  }

  // dial: home at top, destination at its offset; highlighted arc = recommended direction
  const cx = 150; const cy = 92; const r = 62;
  const destAngle = diff * 15;
  let arcs = '';
  let label = '';
  if (choice.dir !== 'none') {
    const main = choice.P * 15; // + clockwise (earlier/east), − anticlockwise (later)
    const alt = main > 0 ? main - 360 : main + 360;
    arcs = `<path class="d-arc alt" d="${arcPath(cx, cy, r, 0, alt)}"/><path class="d-arc" d="${arcPath(cx, cy, r, 0, main)}"/>`;
    label = `${fHours(choice.amount)} ${choice.dir === 'advance' ? 'earlier' : 'later'}`;
  }
  const pos = (a, rr = r) => [cx + rr * Math.cos((a - 90) * Math.PI / 180), cy + rr * Math.sin((a - 90) * Math.PI / 180)];
  const [dx, dy] = pos(destAngle);
  const [lx, ly] = pos(destAngle, r + 20);
  const dial = `<svg class="pv-dial" viewBox="0 0 300 184" role="img" aria-label="Body clock shift: ${esc(label || 'none')}">
    <circle class="d-ring" cx="${cx}" cy="${cy}" r="${r}"/>${arcs}
    <circle class="d-dot from" cx="${cx}" cy="${cy - r}" r="7"/>
    <circle class="d-dot to" cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="7"/>
    <text x="${cx}" y="${cy - r - 14}" class="d-label">${esc(shortName(from))}</text>
    ${Math.abs(diff) > 0.5 ? `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" class="d-label">${esc(shortName(to))}</text>` : ''}
    <text x="${cx}" y="${cy - 2}" class="d-label" style="font-size:15px">${esc(label || '0 h')}</text>
    <text x="${cx}" y="${cy + 15}">body-clock shift</text>
    <text x="${cx}" y="${cy + r + 30}">clockwise = earlier · anticlockwise = later</text>
  </svg>`;

  els.preview.innerHTML = `
    <p class="eyebrow">Route preview</p>
    <div class="pv-clocks">${clock(from)}<span class="pv-arrow">${icon('arrow')}</span>${clock(to)}</div>
    <div class="pv-gap"><span class="pv-gap-num">${raw > 0 ? '+' : raw < 0 ? '−' : ''}${fHours(raw).replace(' h', '')}<small style="font-size:1rem"> h</small></span><span class="pv-gap-text">${gapText}</span></div>
    ${dial}
    <p class="pv-note">${note}</p>`;

  // flight length note
  try {
    const v = readForm();
    const res = toInputQuiet(v);
    if (res) {
      const t = resolveTimes(res);
      els.flightNote.textContent = `Flight time: ${fDur(t.flightMin)}${v.am === 'd' ? ` · lands ${fT(to.tz, t.arrUtc)} ${fD(to.tz, t.arrUtc)} ${shortName(to)} time` : ''}`;
    } else els.flightNote.textContent = '';
  } catch (e) { els.flightNote.textContent = e.message; }

  clearInterval(previewTimer);
  previewTimer = setInterval(() => {
    $$('[data-live-tz]').forEach((n) => { n.textContent = fT(n.dataset.liveTz, Date.now()); });
  }, 20000);
}

function toInputQuiet(v) {
  if (!state.from || !state.to || !v.dd || parseHM(v.dt) == null) return null;
  if (v.am === 'a' && (!v.ad || parseHM(v.at) == null)) return null;
  const durationMin = v.am === 'd' ? (Number(v.dh) || 0) * 60 + (Number(v.dm) || 0) : null;
  if (v.am === 'd' && !durationMin) return null;
  return { home: state.from, dest: state.to, depDate: v.dd, depTime: parseHM(v.dt), arrDate: v.am === 'a' ? v.ad : null, arrTime: v.am === 'a' ? parseHM(v.at) : null, durationMin };
}

// ---------------------------------------------------------------------------
// Plan rendering

const KIND = {
  out: { prep: (r) => `Prep day ${r.index} of ${r.of}`, departure: () => 'Departure day', arrival: () => 'Arrival day', post: (r) => `Day ${r.index} there` },
  return: { prep: (r) => `Prep day ${r.index}`, departure: () => 'Return flight', arrival: () => 'Back home', post: (r) => `Home · day ${r.index}` },
};
const kindLabel = (r) => KIND[r.leg][r.kind](r);

function visibleRows(leg) {
  // show rows until the first fully adjusted post row; later adjusted rows collapse into one
  const rows = leg.rows;
  const firstAdj = rows.findIndex((r) => (r.kind === 'post') && r.adjusted);
  if (firstAdj === -1 || firstAdj >= rows.length - 2) return { rows, collapsed: [] };
  return { rows: rows.slice(0, firstAdj + 1), collapsed: rows.slice(firstAdj + 1) };
}

function renderResults() {
  const plan = state.plan;
  const s = plan.summary;
  const out = plan.out;
  const raw = s.oD - s.oH;
  $('#results-title').textContent = `${shortName(s.home)} → ${shortName(s.dest)}`;
  $('#results-eyebrow').textContent = `Your plan · departs ${fD(s.home.tz, plan.times.depUtc)}`;

  let adjValue; let adjSub;
  if (s.strategy === 'home') { adjValue = 'Home time'; adjSub = 'No shift needed'; }
  else if (out.adjustedDate) {
    adjValue = fDiso(out.adjustedDate);
    adjSub = out.daysToAdjust === 0 ? 'By the time you land' : `${out.daysToAdjust} day${out.daysToAdjust === 1 ? '' : 's'} after landing${s.strategy === 'partial' ? ' (halfway)' : ''}`;
  } else { adjValue = '—'; adjSub = 'Beyond the trip'; }
  const shiftVal = out.P === 0 ? 'None' : `${fHours(out.P)} ${out.P > 0 ? 'earlier' : 'later'}`;
  $('#stats').innerHTML = [
    ['Time difference', `${raw > 0 ? '+' : raw < 0 ? '−' : ''}${fHours(raw)}`, Math.abs(raw) < 0.01 ? 'Same time zone' : `${esc(shortName(s.dest))} is ${raw > 0 ? 'ahead' : 'behind'}`],
    ['Body-clock shift', shiftVal, s.strategy === 'home' ? 'Holding home time'
      : s.strategy === 'adjust' && !out.choice.flipped && Math.abs(Math.abs(out.P) - s.zones) >= 0.5 ? 'A clock change before you fly covers the rest'
        : out.dir === 'advance' ? '≈ 1 h per day' : out.dir === 'delay' ? '≈ 1.5 h per day' : 'Nothing to shift'],
    ['Adjusted by', adjValue, adjSub],
    ['Flight', fDur(s.flightMin), `Lands ${fT(s.dest.tz, plan.times.arrUtc)}, ${fD(s.dest.tz, plan.times.arrUtc)}`],
  ].map(([l, v, sub]) => `<div class="card stat"><div class="stat-label">${l}</div><div class="stat-value">${esc(v)}</div><div class="stat-sub">${sub}</div></div>`).join('');

  $('#strategy-box').innerHTML = strategyCallout(plan);
  $('#habits').innerHTML = habitsHTML(plan);
  renderEvent();
  $('#leg-tabs').hidden = !plan.ret;
  $$('#leg-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.leg === state.leg)));
  renderLeg();
  renderNow();
}

function strategyCallout(plan) {
  const s = plan.summary;
  const out = plan.out;
  const c = s.choice;
  const tripN = s.tripDays != null ? Math.max(1, Math.round(s.tripDays)) : null;
  const [bed, wake] = targetSleep(plan);
  let title; let line; let ic = 'sun'; let flip = '';
  if (s.strategy === 'home') {
    ic = 'home';
    title = 'Stay on home time';
    line = `${tripN ? `${tripN} day${tripN === 1 ? ' is' : 's is'}` : 'This trip is'} too short to shift ${fHours(c.amount)} and back again. Sleep about <b>${bed}–${wake}</b> local time and put important things in your home-time daytime.`;
  } else if (out.dir === 'none') {
    ic = 'check';
    title = 'No real shift needed';
    line = 'Sleep on local time and get some morning daylight.';
  } else {
    const dirWord = out.dir === 'advance' ? 'earlier' : 'later';
    const how = out.dir === 'advance'
      ? `<b>Morning light, dim evenings</b>${plan.input.melatonin ? ', melatonin before bed' : ''}`
      : '<b>Evening light, dim mornings</b>';
    title = s.strategy === 'partial' ? `Meet halfway: shift ${fHours(out.P)} ${dirWord}` : `Shift your body clock ${fHours(out.P)} ${dirWord}`;
    line = `${how}. About ${out.dir === 'advance' ? '1 h' : '1.5 h'} a day${out.prep ? `, starting ${out.prep} day${out.prep === 1 ? '' : 's'} before you fly` : ''}. After landing, sleep <b>${bed}–${wake}</b>.`;
    if (s.strategy === 'partial') line += ' You chose this in-between option; it isn\'t part of CDC or AASM guidance.';
    if (c.flipped && s.diff >= 12) flip = '<p class="rule-flip">↺ Halfway round the world: either way is 12 h, and shifting later is easier.</p>';
    else if (c.flipped) flip = `<p class="rule-flip">↺ Long way round: with ${fHours(c.remaining)} still to shift earlier on landing, arrival light hits just before your body's low point and the clock tends to drift later, so the plan goes with it. The usual eastbound rule flips. ${out.prep < 3 ? 'More prep days would let the plan shift earlier instead.' : ''}</p>`;
    else if (out.dir === 'advance' && s.diff >= 8) flip = '<p class="rule-flip">At 8+ zones east, your body\'s low point lands in the local morning at first, so the plan has you <b>avoid early-morning light</b> for the first days and get light later in the morning; the windows move earlier each day.</p>';
  }
  if (Math.abs(s.oD - s.oH) < 2 && out.dir !== 'none') flip += '<p class="callout-note">Little or no jet lag expected: jet lag usually needs 2+ time zones. The plan below is optional.</p>';
  let note = '';
  if (s.reason === 'chosen' && s.autoStrategy !== s.strategy) {
    note = `You chose this goal. For this trip length the planner would suggest ${{ adjust: 'fully adjusting', home: 'staying on home time', partial: 'meeting halfway' }[s.autoStrategy]}.`;
  } else if (s.reason === 'event') note = 'Chosen to make you sharpest for your event.';
  else if (s.reason !== 'chosen') note = tripN != null ? `Picked for your ${tripN}-day stay (stays of 2 days or less keep home time).` : 'Add a return date: for stays of 2 days or less, staying on home time is recommended.';
  return `<div class="card callout"><span class="ic-wrap">${icon(ic)}</span><div><h3>${esc(title)}</h3><p>${line}</p>${flip}${note ? `<p class="callout-note">${note}</p>` : ''}</div></div>`;
}

function habitsHTML(plan) {
  const three = fT('UTC', Date.UTC(2000, 0, 1, 15));
  const items = plan.summary.strategy === 'home'
    ? [['bed', 'Sleep on your home schedule. An eye mask helps if it falls in daylight.'], ['clock', 'Put important things in your home-time daytime.'], ['nap', 'Naps: 20–30 min at most.']]
    : [['alarm', 'Get up at the same local time, even after a bad night.'], ['nap', `Naps: 20–30 min at most, and before ${three}.`], ['meal', 'Eat meals on local time.'], ['walk', 'Exercise or walk outside, ideally in a bright-light window.']];
  if (plan.input.caffeine) items.push(['coffee', 'Caffeine is fine for alertness during local daytime; none in the 6 hours before bed.']);
  items.push(['water', 'Drink water; go easy on alcohol.']);
  const legs = [plan.out, plan.ret].filter(Boolean);
  if (legs.some((l) => l.seek.some((w) => w.light === 'dark' || w.light === 'mixed'))) {
    items.push(['sun', 'Some light windows fall in the dark. A light box can stand in; check with your doctor first, especially with eye conditions, migraines, bipolar disorder or light-sensitising medicines.']);
  }
  return items.map(([ic, t]) => `<li>${icon(ic)}<span>${esc(t)}</span></li>`).join('');
}

// Recommended sleep window at the destination, on the destination clock
function targetSleep(plan) {
  const out = plan.out;
  const clock = (m) => fT('UTC', Date.UTC(2000, 0, 1) + ((((m + norm12(out.oD - out.T) * 60) % 1440) + 1440) % 1440) * MIN);
  return [clock(plan.input.bed), clock(plan.input.wake)];
}

function renderEvent() {
  const box = $('#event-box');
  const ev = state.plan.event;
  if (!ev) { box.innerHTML = ''; return; }
  const s = state.plan.summary;
  const tz = s.dest.tz;
  const names = { adjust: 'Fully adjust', partial: 'Meet halfway', home: 'Stay on home time' };
  const rows = ev.compare.map((c) => `<tr class="${c.strategy === ev.strategy ? 'chosen' : ''}"><td>${names[c.strategy]}${c.strategy === ev.strategy ? ' ✓' : ''}</td><td>${fBodyClock(c.bodyHour)}</td><td><span class="pill ${c.label.key}">${c.label.text}</span></td></tr>`).join('');
  const tips = [];
  if (ev.beforeArrival) tips.push('<b>Heads up:</b> this event is before you land.');
  if (ev.afterReturn) tips.push('<b>Heads up:</b> this event is after your return flight.');
  tips.push(ev.score < 0.75
    ? `<b>To be sharper:</b> 20–30 min of bright light${state.plan.input.caffeine ? ' and a coffee' : ''} 30–60 min before; a 20-min nap 2–4 h before if you can.`
    : 'Your body clock should be in a good place. Protect the night before with a normal local bedtime.');
  box.innerHTML = `<div class="card event-card">
    <div class="event-top">
      <span class="ic-wrap now-icon neutral">${icon('star')}</span>
      <div><div class="now-title">Your event · ${fD(tz, ev.eventUtc)}, ${fT(tz, ev.eventUtc)} ${esc(shortName(s.dest))} time</div>
      <div class="now-sub">With this plan your body will feel like it's <b>${fBodyClock(ev.bodyHour)}</b>.</div></div>
      <div class="event-score"><span class="meter" aria-hidden="true"><i style="width:${Math.round(ev.score * 100)}%"></i></span><span class="pill ${ev.label.key}">${ev.label.text}</span></div>
    </div>
    <table class="compare"><thead><tr><th>Strategy</th><th>Body clock at event</th><th>Expected alertness</th></tr></thead><tbody>${rows}</tbody></table>
    <ul class="event-tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>
  </div>`;
}

function currentLeg() {
  return state.leg === 'return' && state.plan.ret ? state.plan.ret : state.plan.out;
}

function renderLeg() {
  const leg = currentLeg();
  renderProgress(leg);
  renderSchedule(leg);
  renderDays(leg);
}

// ---- progress chart -------------------------------------------------------
function renderProgress(leg) {
  const box = $('#progress-chart');
  const sub = $('#progress-sub');
  const { rows } = visibleRows(leg);
  const target = Math.abs(leg.P);
  if (target < 0.01) {
    sub.textContent = leg.strategy === 'home' ? 'You\'re holding your home clock, so there\'s nothing to shift.' : 'No shift needed on this leg.';
    box.innerHTML = '';
    return;
  }
  sub.textContent = `How far your clock has moved by the end of each day, out of ${fHours(target)} ${leg.P > 0 ? 'earlier' : 'later'}.`;
  const data = rows.map((r) => ({ r, v: Math.min(target, leg.progress.find((p) => p.date === r.date && p.kind === r.kind)?.shifted ?? 0) }));
  const W = Math.max(300, Math.round(box.clientWidth || 600)); const H = W < 480 ? 190 : 210; const padL = 30; const padR = 10; const padT = 18; const padB = 30;
  const iw = W - padL - padR; const ih = H - padT - padB;
  const n = data.length;
  const band = iw / n;
  const bw = Math.max(6, Math.min(34, band * 0.6));
  const y = (v) => padT + ih - (v / target) * ih;
  const ticks = [0, target / 2, target].map((v) => Math.round(v * 2) / 2);
  const shortLbl = (r) => r.kind === 'prep' ? `−${r.of - r.index + 1}` : r.kind === 'departure' ? '✈' : String(r.index);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart of body-clock shift per day">`;
  for (const t of ticks) svg += `<line class="pc-grid" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text class="pc-axis" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  data.forEach(({ r, v }, i) => {
    const x = padL + band * i + (band - bw) / 2;
    const h = Math.max(0, y(0) - y(v));
    const cls = v >= target - 0.01 ? 'done' : r.kind === 'prep' ? 'prep' : '';
    const rr = Math.min(4, bw / 2, h);
    const top = y(v);
    const path = h > 0.5
      ? `M${x} ${y(0)} V${top + rr} Q${x} ${top} ${x + rr} ${top} H${x + bw - rr} Q${x + bw} ${top} ${x + bw} ${top + rr} V${y(0)} Z`
      : `M${x} ${y(0) - 1} H${x + bw} V${y(0)} H${x} Z`;
    const tip = `<b>${esc(fDiso(r.date))}</b> · ${esc(kindLabel(r))}<br>${fHours(v)} of ${fHours(target)} shifted`;
    svg += `<rect class="pc-hit" x="${padL + band * i}" y="${padT}" width="${band}" height="${ih}" data-tip="${esc(tip)}" tabindex="0"/>`;
    svg += `<path class="pc-bar ${cls}" d="${path}" pointer-events="none"/>`;
    if (band >= 18 || i % 2 === 0) svg += `<text class="pc-axis" x="${x + bw / 2}" y="${H - padB + 16}" text-anchor="middle">${shortLbl(r)}</text>`;
  });
  svg += `<line class="pc-target" x1="${padL}" x2="${W - padR}" y1="${y(target)}" y2="${y(target)}"/>`;
  svg += `<text class="pc-target-label" x="${W - padR}" y="${y(target) - 6}" text-anchor="end">goal ${fHours(target)}</text>`;
  svg += `<text class="pc-axis" x="${padL}" y="${H - 2}">${W < 480 ? '− prep · ✈ flight · days there' : 'prep days (−) · ✈ departure · days after landing'}</text>`;
  svg += '</svg>';
  box.innerHTML = svg;
}

// ---- timeline -------------------------------------------------------------
const scheduleView = () => (store.get('meridian-view', 'table') === 'timeline' ? 'timeline' : 'table');

function renderSchedule(leg) {
  const view = scheduleView();
  setRadio('view', view);
  $('#schedule-legend').hidden = view !== 'timeline';
  $('#schedule').className = view === 'timeline' ? 'timeline' : '';
  $('#schedule').innerHTML = view === 'timeline' ? timelineHTML(leg) : tableHTML(leg);
}

// One row per day. Under each bar, a list of every colored section with its start and stop
// time (each item listed once, on the day it starts), so the times are readable on screen and on paper.
function timelineHTML(leg, { print = false } = {}) {
  const { rows, collapsed } = visibleRows(leg);
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24];
  const tickLabel = (h) => (prefs.clock24 ? String(h % 24).padStart(2, '0') : (h % 12 === 0 ? (h % 24 === 0 ? '12a' : '12p') : `${h % 12}${h < 12 ? 'a' : 'p'}`));
  const scale = `<div class="tl-scale"><div></div><div class="tl-ticks">${ticks.map((h) => `<span style="left:${(h / 24) * 100}%">${tickLabel(h)}</span>`).join('')}</div></div>`;
  let html = scale;
  const now = Date.now();
  const listed = new Set();
  const ev = leg.leg === 'out' ? state.plan.event : null;
  rows.forEach((r, ri) => {
    const span = r.end - r.start;
    const pct = (t) => `${(((Math.min(Math.max(t, r.start), r.end) - r.start) / span) * 100).toFixed(3)}%`;
    const seg = (cls, a, b, tip, k) => {
      if (b <= r.start || a >= r.end) return '';
      return `<span class="tl-seg ${cls}" style="left:${pct(a)};width:calc(${pct(b)} - ${pct(a)})"${tip ? ` data-tip="${esc(tip)}"` : ''}${k ? ` data-k="${k}"` : ''}></span>`;
    };
    const items = [];
    const item = (k, t, sw, label, range) => {
      if (listed.has(k)) return;
      if (t < r.start) range = `until ${range.split('–').pop()}`; // began the day before
      listed.add(k);
      items.push({ k, t, sw, label, range });
    };
    let inner = '';
    if (r.sun && r.sun.rise) inner += seg('tl-day', Math.max(r.sun.rise, r.visStart), Math.min(r.sun.set, r.visEnd), `Daylight ${fRange(r.tz, r.sun.rise, r.sun.set)}`);
    else if (r.sun && r.sun.polar === 'day') inner += seg('tl-day', r.visStart, r.visEnd, 'Midnight sun: daylight all day');
    if (r.visStart > r.start) inner += seg('tl-off', r.start, r.visStart, 'Before this leg');
    if (r.visEnd < r.end) inner += seg('tl-off', r.visEnd, r.end, 'You\'re at your destination by now; see the next row');
    if (r.flight) {
      inner += seg('tl-flight', r.flight.start, r.flight.end, `In flight ${fRange(r.tz, leg.depUtc, leg.arrUtc)}`, 'fl');
      if (r.kind === 'departure') item('fl', leg.depUtc, 'flight', 'Flight', `departs ${fT(r.tz, leg.depUtc)}`);
      if (r.kind === 'arrival') item('fla', leg.arrUtc, 'flight', 'Flight', `lands ${fT(r.tz, leg.arrUtc)}`);
    }
    for (const w of r.sleeps) {
      const k = 's' + w.rawStart;
      inner += seg('tl-sleep', w.start, w.end, `Sleep ${fRange(r.tz, w.rawStart, w.rawEnd)}`, k);
      item(k, w.rawStart, 'sleep', 'Sleep', fRange(r.tz, w.rawStart, w.rawEnd));
    }
    for (const w of r.flightSleeps) {
      const k = 'f' + w.rawStart;
      inner += seg('tl-sleep flight-sleep', w.start, w.end, `Sleep on the plane ${fRange(r.tz, w.rawStart, w.rawEnd)}`, k);
      item(k, w.rawStart, 'sleep', 'Plane sleep', fRange(r.tz, w.rawStart, w.rawEnd));
    }
    for (const w of r.seek) {
      const k = 'l' + w.rawStart;
      inner += seg('tl-seek', w.start, w.end, `Seek bright light ${fRange(r.tz, w.rawStart, w.rawEnd)}`, k);
      item(k, w.rawStart, 'seek', 'Seek light', fRange(r.tz, w.rawStart, w.rawEnd));
    }
    for (const w of r.avoid) {
      const k = 'a' + w.rawStart;
      inner += seg('tl-avoid', w.start, w.end, `Avoid bright light ${fRange(r.tz, w.rawStart, w.rawEnd)}`, k);
      item(k, w.rawStart, 'avoid', 'Avoid light', fRange(r.tz, w.rawStart, w.rawEnd));
    }
    for (const m of r.melatonin) {
      const k = 'm' + m.at;
      inner += `<span class="tl-mel" style="left:${pct(m.at)}" data-tip="${esc(`Melatonin ${fT(r.tz, m.at)}`)}" data-k="${k}"></span>`;
      item(k, m.at, 'mel', 'Melatonin', fT(r.tz, m.at));
    }
    for (const m of r.nightMel || []) {
      const k = 'n' + m.start;
      inner += `<span class="tl-mel tl-mel-opt" style="left:${pct(m.start)}" data-tip="${esc(`Melatonin only if awake ${fRange(r.tz, m.start, m.end)}`)}" data-k="${k}"></span>`;
      item(k, m.start, 'mel', 'Melatonin if awake', fRange(r.tz, m.start, m.end));
    }
    if (ev && ev.eventUtc >= r.visStart && ev.eventUtc < r.visEnd) {
      inner += `<span class="tl-event" style="left:${pct(ev.eventUtc)}" data-tip="${esc(`Your event ${fT(r.tz, ev.eventUtc)}`)}" data-k="ev"></span>`;
      item('ev', ev.eventUtc, 'event', 'Event', fT(r.tz, ev.eventUtc));
    }
    if (!print && now >= r.visStart && now < r.visEnd) inner += `<span class="tl-now" style="left:${pct(now)}" data-tip="${esc(`Now · ${fT(r.tz, now)}`)}"></span>`;
    items.sort((a, b) => a.t - b.t);
    const chips = items.map((it) => `<li data-k="${it.k}"><i class="sw sw-${it.sw}" aria-hidden="true"></i><span class="tl-chip-l">${it.label}</span> <b>${esc(it.range)}</b></li>`).join('');
    html += `<div class="tl-row${r.adjusted && r.kind === 'post' ? ' adjusted' : ''}">
      <div class="tl-label"><span class="tl-date">${esc(fDiso(r.date))}</span><span class="tl-kind">${esc(kindLabel(r))}</span><span class="tl-kind tl-clock">${esc(shortName(r.place))} time</span></div>
      <div class="tl-main">
        <div class="tl-track" aria-hidden="true">${inner}</div>
        ${chips ? `<ul class="tl-chips" aria-label="${esc(`${fDiso(r.date)} times`)}">${chips}</ul>` : ''}
      </div>
    </div>`;
    if (!print && ri > 0 && ri % 7 === 6 && ri < rows.length - 1) html += scale;
  });
  if (collapsed.length) html += `<p class="tl-more">+ ${collapsed.length} more day${collapsed.length === 1 ? '' : 's'} on a normal local routine</p>`;
  return html;
}

// ---- light notes --------------------------------------------------------------
function lightNote(w, tz, kind) {
  if (kind === 'seek') {
    if (w.light === 'flight') return 'Reading light on, window shade up if it\'s light outside.';
    if (w.light === 'sun') return 'Get outside. Daylight beats indoor light, even when cloudy.';
    if (w.light === 'dark') return 'It\'s dark out: use the brightest indoor light, or a light box if your doctor agrees.';
    if (w.light === 'mixed') {
      if (w.sunrise > w.start && w.sunrise < w.end) return `Light box until sunrise (${fT(tz, w.sunrise)}), then outside.`;
      if (w.sunset > w.start && w.sunset < w.end) return `Outside until sunset (${fT(tz, w.sunset)}), then a light box.`;
    }
    return 'Get outside, or sit by a bright window.';
  }
  if (w.hold) return 'Keep light low to hold your home clock.';
  if (w.light === 'flight') return 'Eye mask, shade down, screens dim.';
  if (w.light === 'daylight') return 'Sunglasses outside, dim rooms inside.';
  return 'Dim, warm lights; screens down.';
}

// A few words for the table
function shortLight(w, tz, kind) {
  if (kind === 'seek') {
    if (w.light === 'flight') return 'cabin light';
    if (w.light === 'sun') return 'outside';
    if (w.light === 'dark') return 'light box';
    if (w.light === 'mixed') {
      if (w.sunrise > w.start && w.sunrise < w.end) return `outside after ${fT(tz, w.sunrise)}`;
      if (w.sunset > w.start && w.sunset < w.end) return `outside until ${fT(tz, w.sunset)}`;
    }
    return 'outside';
  }
  if (w.light === 'flight') return 'eye mask';
  if (w.light === 'daylight') return 'sunglasses';
  return 'dim lights';
}

function cbtLocal(leg, tz, near) {
  const c = leg.cbts.reduce((best, x) => (Math.abs(x.t - near) < Math.abs(best.t - near) ? x : best), leg.cbts[0]);
  return c ? fT(tz, c.t) : '';
}

const shiftNote = (h) => (h ? `${fHours(h)} ${h > 0 ? 'earlier' : 'later'} than usual` : '');

// ---- schedule table ---------------------------------------------------------
function tableHTML(leg, { print = false } = {}) {
  const { rows, collapsed } = visibleRows(leg);
  const showMel = leg.melatonin.length > 0 || leg.nightMelatonin.length > 0;
  const showCaf = state.plan.input.caffeine;
  const cols = ['Day', 'Sleep (that night)', 'Bright light', 'Avoid light'];
  if (showMel) cols.push('Melatonin');
  if (showCaf) cols.push('Last caffeine');
  const none = '<span class="none">—</span>';
  const cell = (label, html, cls = '') => `<td data-label="${label}"${cls ? ` class="${cls}"` : ''}>${html || none}</td>`;
  const ranges = (list, tz, kind) => list.filter((w) => w.end - w.start >= 20 * MIN)
    .map((w) => `<span class="t">${fRange(tz, w.start, w.end)}</span><small>${shortLight(w, tz, kind)}</small>`).join('');
  const ev = leg.leg === 'out' ? state.plan.event : null;
  let body = '';
  for (const r of rows) {
    const tz = r.tz;
    let sleep = r.beds.map((b) => `<span class="t">${fRange(tz, b.at, b.until)}</span>${r.kind === 'prep' && b.shiftH ? `<small>${shiftNote(b.shiftH)}</small>` : ''}`).join('');
    if (r.kind === 'departure') {
      // the night of the travel day is spent on the plane
      const dz = leg.dest.tz;
      const sameClock = offsetHours(tz, leg.depUtc) === offsetHours(dz, leg.depUtc);
      sleep += leg.flight.sleeps.map((w) => `<span class="t">${fRange(tz, w.start, w.end)}</span><small>on the plane${sameClock ? '' : ` (${fRange(dz, w.start, w.end)} ${esc(shortName(leg.dest))} time)`}</small>`).join('');
    }
    const evNote = ev && ev.eventUtc >= r.ownStart && ev.eventUtc < r.ownEnd ? `<small class="ev">★ Event ${fT(tz, ev.eventUtc)}</small>` : '';
    body += `<tr class="k-${r.kind}">
      <th scope="row" data-label="Day"><b>${esc(fDiso(r.date))}</b><small>${esc(kindLabel(r))} · ${esc(shortName(r.place))}</small>${evNote}</th>
      ${cell('Sleep (that night)', sleep, 'c-sleep')}
      ${cell('Bright light', ranges(r.own.seek, tz, 'seek'), 'c-seek')}
      ${cell('Avoid light', ranges(r.own.avoid, tz, 'avoid'), 'c-avoid')}
      ${showMel ? cell('Melatonin', [...r.own.melatonin.map((m) => `<span class="t">${fT(tz, m.at)}</span><small>optional</small>`), ...r.own.nightMel.map((m) => `<span class="t">${fRange(tz, m.start, m.end)}</span><small>only if awake</small>`)].join(''), 'c-mel') : ''}
      ${showCaf ? cell('Last caffeine', r.caffeine.map((c) => `<span class="t">${fT(tz, c.at)}</span>`).join('')) : ''}
    </tr>`;
    if (r.kind === 'departure') {
      const f = leg.flight;
      const dz = leg.dest.tz;
      const bits = [`<b>${fT(leg.origin.tz, f.start)}</b> ${esc(shortName(leg.origin))} → <b>${fT(dz, f.end)}</b> ${esc(shortName(leg.dest))}${daysBetweenISO(localDateISO(leg.origin.tz, f.start), localDateISO(dz, f.end)) ? ` (${esc(fD(dz, f.end))})` : ''}`,
        `switch to ${esc(shortName(leg.dest))} time`];
      bits.push('water, little alcohol');
      body += `<tr class="flight-row"><td colspan="${cols.length}"><span class="fr-ic">${icon('plane')}</span><span><b>Flight</b> · ${bits.join(' · ')}</span></td></tr>`;
    }
  }
  if (collapsed.length) {
    const a = collapsed[0]; const b = collapsed[collapsed.length - 1];
    const last = [...rows].reverse().find((r) => r.beds.length);
    const sl = last ? fRange(last.tz, last.beds[0].at, last.beds[0].until) : '';
    body += `<tr class="adjusted-row"><th scope="row" data-label="Day"><b>${esc(fDiso(a.date))}${collapsed.length > 1 ? ` – ${esc(fDiso(b.date))}` : ''}</b><small>adjusted ✓</small></th><td colspan="${cols.length - 1}">Normal routine${sl ? `: sleep ${sl}` : ''}, daylight in the morning.</td></tr>`;
  }
  return `<div class="table-wrap"><table class="sched${print ? ' sched-print' : ''}"><thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---- day cards --------------------------------------------------------------
function buildActions(leg, r) {
  const tz = r.tz;
  const acts = [];
  const push = (t, o) => acts.push({ t, time: fT(tz, t), ...o });
  const isPost = r.kind === 'arrival' || r.kind === 'post';

  for (const w of r.wakes) {
    const sh = leg.sleeps.find((s) => s.end === w.at)?.shiftH || 0;
    const prep = r.kind === 'prep' || (r.kind === 'departure' && sh);
    push(w.at, { cls: 'sleep', ic: 'alarm', title: 'Wake up', note: prep ? shiftNote(sh) : '', why: prep && sh ? 'Moving your wake time about an hour a day shifts your clock before you leave.' : '', key: 'wake' + w.at });
  }
  for (const w of r.own.seek) {
    if (w.end - w.start < 20 * MIN) continue;
    push(w.start, {
      cls: 'seek', ic: 'sun', title: 'Bright light', until: fT(tz, w.end), note: lightNote(w, tz, 'seek'), key: 'seek' + w.rawStart,
      why: leg.dir === 'advance'
        ? `Light after your body's temperature low (about ${cbtLocal(leg, tz, w.cbt)} on this clock) shifts you earlier.`
        : `Light before your body's temperature low (about ${cbtLocal(leg, tz, w.cbt)} on this clock) shifts you later.`,
    });
  }
  for (const w of r.own.avoid) {
    if (w.end - w.start < 20 * MIN) continue;
    push(w.start, {
      cls: 'avoid', ic: 'shades', title: 'Avoid bright light', until: fT(tz, w.end), note: lightNote(w, tz, 'avoid'), key: 'avoid' + w.rawStart,
      why: w.hold ? 'Light now would start shifting you off home time.' : 'Light now would shift your clock the wrong way.',
    });
  }
  for (const m of r.own.melatonin) push(m.at, { cls: 'mel', ic: 'pill', title: 'Melatonin (optional)', note: '0.5–1 mg is usually enough (max 3 mg), 30–60 min before bed. Ask your doctor first.', why: 'Taken in the evening before your new bedtime, melatonin helps shift your clock earlier and helps you sleep.', key: 'mel' + m.at });
  for (const m of r.own.nightMel) push(m.start, { cls: 'mel', ic: 'pill', title: 'Melatonin only if you wake up', until: fT(tz, m.end), note: 'Awake and can\'t get back to sleep? 0.5 mg (optional). Ask your doctor first.', why: 'Late in the night your body clock reads "morning"; melatonin then helps shift it later, the way you need after flying west.', key: 'nmel' + m.start });
  for (const c of r.caffeine) push(c.at, { cls: '', ic: 'coffee', title: 'Last caffeine', key: 'caf' + c.at });
  for (const bd of r.beds) {
    let note = '';
    if (r.kind === 'prep') note = shiftNote(bd.shiftH);
    else if (r.kind === 'arrival' && leg.strategy !== 'home') note = 'Stay up until now, even if you\'re tired.';
    else if (leg.strategy === 'home' && isPost) note = 'Home-time bedtime.';
    push(bd.at, { cls: 'sleep', ic: 'bed', title: 'Bed', until: fT(tz, bd.until), note, key: 'bed' + bd.at });
  }
  if (r.kind === 'departure') push(leg.depUtc, { cls: '', ic: 'plane', title: 'Flight departs', note: `Set your watch to ${shortName(leg.dest)} time when you board.`, key: 'dep' });
  if (r.kind === 'arrival') push(leg.arrUtc, { cls: '', ic: 'land', title: `Land in ${shortName(leg.dest)}`, key: 'arr' });
  const ev = state.plan.event;
  if (ev && leg.leg === 'out' && ev.eventUtc >= r.ownStart && ev.eventUtc < r.ownEnd) {
    push(ev.eventUtc, { cls: 'event', ic: 'star', title: 'Your event', note: `Body clock reads ~${fBodyClock(ev.bodyHour)} (${ev.label.text.toLowerCase()}).`, key: 'event' });
  }
  acts.sort((x, y) => x.t - y.t);

  let tip = '';
  if (r.kind === 'prep' && r.index === 1) tip = 'Pack sunglasses, an eye mask and earplugs.';
  if (r.kind === 'arrival' && leg.strategy !== 'home') tip = `Tired? Nap 20–30 min at most, before ${fT('UTC', Date.UTC(2000, 0, 1, 15))}.`;
  return { acts, tip };
}

function bodyClockLine(r) {
  if (Math.abs(r.bodyVsLocal) < 0.25) return `${icon('check')}<span>Body clock matches local time.</span>`;
  return `${icon('clock')}<span>At ${fT('UTC', Date.UTC(2000, 0, 1, 12))} here, your body feels like it's <b>${fBodyClock(12 + r.bodyVsLocal)}</b>.</span>`;
}

function actionList(acts, legKey) {
  const done = store.get('meridian-done', {});
  return `<ul class="actions">${acts.map((a) => {
    const k = `${state.paramsKey}|${legKey}|${a.key}`;
    const isDone = !!done[k];
    const time = a.until ? `${a.time}<small>to ${a.until}</small>` : a.time;
    return `<li class="act${isDone ? ' done' : ''}">
      <input type="checkbox" class="act-check" data-done-key="${esc(k)}" ${isDone ? 'checked' : ''} aria-label="Mark done: ${esc(a.title)}">
      <span class="act-time">${time}${a.sub ? `<small>${esc(a.sub)}</small>` : ''}</span>
      <span class="act-icon ${a.cls}">${icon(a.ic)}</span>
      <span class="act-text"><b>${esc(a.title)}</b>${a.note ? `<span class="act-note">${esc(a.note)}</span>` : ''}${a.why ? `<details><summary></summary><p>${esc(a.why)}</p></details>` : ''}</span>
    </li>`;
  }).join('')}</ul>`;
}

function flightActions(leg) {
  const f = leg.flight;
  const dz = leg.dest.tz;
  const t = (x) => fT(dz, x);
  const acts = [{ t: f.start, cls: '', ic: 'plane', time: t(f.start), sub: `${fT(leg.origin.tz, f.start)} ${shortName(leg.origin)}`, title: `Board: switch to ${shortName(leg.dest)} time`, note: 'Eat and sleep on destination time from now.', key: 'f-board' }];
  for (const s of f.sleeps) {
    acts.push({ t: s.start, cls: 'sleep', ic: 'bed', time: t(s.start), until: t(s.end), title: 'Sleep on the plane', note: 'Night at your destination. Eye mask, earplugs.', key: 'f-sleep' + s.start });
  }
  const edges = [f.start + 30 * MIN, ...f.sleeps.flatMap((s) => [s.start, s.end]), f.end - 30 * MIN];
  for (let i = 0; i < edges.length; i += 2) {
    if (edges[i + 1] - edges[i] >= 90 * MIN) acts.push({ t: edges[i] + 1, cls: '', ic: 'walk', time: t(edges[i]), until: t(edges[i + 1]), title: 'Stay awake', note: 'Daytime at your destination. Move around, drink water.', key: 'f-awake' + edges[i] });
  }
  for (const w of f.seek) if (w.end - w.start >= 20 * MIN) acts.push({ t: w.start + 2, cls: 'seek', ic: 'sun', time: t(w.start), until: t(w.end), title: 'Bright light', note: lightNote({ light: 'flight' }, dz, 'seek'), key: 'f-seek' + w.start });
  for (const w of f.avoid) if (w.end - w.start >= 20 * MIN) acts.push({ t: w.start + 2, cls: 'avoid', ic: 'shades', time: t(w.start), until: t(w.end), title: 'Keep it dark', note: lightNote({ light: 'flight' }, dz, 'avoid'), key: 'f-avoid' + w.start });
  acts.push({ t: f.end, cls: '', ic: 'land', time: t(f.end), sub: `${fT(leg.origin.tz, f.end)} ${shortName(leg.origin)}`, title: 'Land', key: 'f-land' });
  return acts.sort((x, y) => x.t - y.t);
}

function dayCard({ open, kicker, title, zone, body, cls = '' }) {
  return `<details class="card day ${cls}"${open ? ' open' : ''}>
    <summary class="day-head"><span><span class="day-kicker">${esc(kicker)}</span><span class="day-title">${esc(title)}</span></span><span class="day-zone">${esc(zone)}</span><span class="chev" aria-hidden="true"></span></summary>
    <div class="day-body">${body}</div>
  </details>`;
}

function renderDays(leg) {
  const { rows, collapsed } = visibleRows(leg);
  const now = Date.now();
  // open today's card (or the first one if the trip hasn't started)
  let openIdx = rows.findIndex((r) => now >= r.ownStart && now < r.ownEnd);
  if (openIdx === -1 && now < rows[0].ownStart) openIdx = 0;
  let html = '';
  rows.forEach((r, i) => {
    const { acts, tip } = buildActions(leg, r);
    const body = `<p class="day-body-clock">${bodyClockLine(r)}</p>
      ${acts.length ? actionList(acts, leg.leg) : '<p class="muted">Normal routine.</p>'}
      ${tip ? `<p class="day-tip">${icon('info')}<span>${esc(tip)}</span></p>` : ''}`;
    html += dayCard({ open: i === openIdx, kicker: kindLabel(r), title: fDiso(r.date), zone: `${shortName(r.place)} time`, body });
    if (r.kind === 'departure') {
      const f = leg.flight;
      const inAir = now >= f.start && now < f.end;
      const body2 = `<p class="day-body-clock">${icon('plane')}<span>${fT(leg.origin.tz, f.start)} ${esc(shortName(leg.origin))} → ${fT(leg.dest.tz, f.end)} ${esc(shortName(leg.dest))} · ${fDur((f.end - f.start) / MIN)}</span></p>
        ${actionList(flightActions(leg), leg.leg)}
        <p class="day-tip">${icon('info')}<span>Eat on ${esc(shortName(leg.dest))} time. Water yes; alcohol and caffeine sparingly. Skip antihistamine sleep aids and long-acting sedatives; ask a doctor about short-acting options.</span></p>`;
      html += dayCard({ open: inAir, kicker: 'In the air', title: `${shortName(leg.origin)} → ${shortName(leg.dest)}`, zone: `${shortName(leg.dest)} time`, body: body2, cls: 'flight-card' });
    }
  });
  if (collapsed.length) {
    const a = collapsed[0]; const b = collapsed[collapsed.length - 1];
    html += `<div class="card day-collapsed">${icon('check')}<div><b>${esc(fDiso(a.date))}${collapsed.length > 1 ? ` – ${esc(fDiso(b.date))}` : ''}: adjusted.</b> Normal local routine with morning daylight.</div></div>`;
  }
  $('#days').innerHTML = html;
  syncExpandLabel();
}

function syncExpandLabel() {
  const cards = $$('#days details.day');
  $('#expand-all').textContent = cards.length && cards.every((d) => d.open) ? 'Collapse all' : 'Expand all';
}

// ---- right now --------------------------------------------------------------
function renderNow() {
  const box = $('#now-box');
  const plan = state.plan;
  if (!plan) { box.innerHTML = ''; return; }
  const now = Date.now();
  const legs = [plan.out, plan.ret].filter(Boolean);
  const first = plan.out;
  const last = legs[legs.length - 1];
  let status; let tz; let where; let next = '';
  const startDay = first.rows[0];
  if (now < first.planStart) {
    const days = Math.max(0, daysBetweenISO(localDateISO(first.origin.tz, now), startDay.date));
    tz = first.origin.tz; where = shortName(first.origin);
    status = { cls: 'neutral', ic: 'clock', title: days > 0 ? `Your plan starts in ${days} day${days === 1 ? '' : 's'}` : 'Your plan starts today', sub: `${fDiso(startDay.date)}. Until then, keep your usual routine.` };
  } else if (now > last.legEnd) {
    tz = last.dest.tz; where = shortName(last.dest);
    status = { cls: 'neutral', ic: 'check', title: 'Plan complete', sub: 'Your body clock should be in sync. Welcome back to normal.' };
  } else {
    const leg = legs.find((l) => now >= Math.min(l.planStart, l.depUtc - 6 * HOUR) && now <= l.legEnd) || (plan.ret && now > plan.ret.planStart ? plan.ret : plan.out);
    const inFlight = now >= leg.depUtc && now < leg.arrUtc;
    const place = now < leg.depUtc ? leg.origin : leg.dest;
    tz = place.tz; where = shortName(place);
    const inAny = (arr) => arr.find((w) => now >= w.start && now < w.end);
    const sl = inAny(leg.sleeps) || inAny(leg.flightSleeps);
    const sk = inAny(leg.seek);
    const av = inAny(leg.avoid);
    if (sl) status = { cls: 'sleep', ic: 'moon', title: 'Sleep time', sub: `Until ${fT(tz, sl.end)}${inFlight ? ' (on the plane)' : ''}.` };
    else if (sk) status = { cls: 'seek', ic: 'sun', title: 'Get bright light now', sub: `Until ${fT(tz, sk.end)}. ${lightNote(sk, tz, 'seek')}` };
    else if (av) status = { cls: 'avoid', ic: 'shades', title: 'Avoid bright light now', sub: `Until ${fT(tz, av.end)}. ${lightNote(av, tz, 'avoid')}` };
    else if (inFlight) status = { cls: 'flight', ic: 'plane', title: 'In flight: stay awake', sub: 'Hydrate, stretch, and keep to destination time.' };
    else status = { cls: 'neutral', ic: 'clock', title: 'Free time', sub: 'Normal light is fine. Keep to local meal times.' };
    const upcoming = [
      ...leg.seek.map((w) => [w.start, 'seek bright light']),
      ...leg.avoid.map((w) => [w.start, 'avoid bright light']),
      ...leg.sleeps.map((w) => [w.start, 'bedtime']),
      ...leg.flightSleeps.map((w) => [w.start, 'sleep on the plane']),
      ...leg.melatonin.map((m) => [m.at, 'melatonin']),
      ...leg.caffeine.map((c) => [c.at, 'last caffeine']),
      [leg.depUtc, 'flight departs'], [leg.arrUtc, 'landing'],
    ].filter(([t]) => t > now).sort((a, b) => a[0] - b[0]);
    if (upcoming.length) {
      const [t, what] = upcoming[0];
      const ntz = t < leg.depUtc ? leg.origin.tz : leg.dest.tz;
      next = `Next: <b>${what}</b> at ${fT(ntz, t)}${daysBetweenISO(localDateISO(ntz, now), localDateISO(ntz, t)) ? ` ${fD(ntz, t)}` : ''}`;
    }
  }
  box.innerHTML = `<div class="card now">
    <span class="now-badge"><span class="now-pulse"></span>Right now · ${fT(tz, now)} ${esc(where)}</span>
    <div class="now-main"><span class="now-icon ${status.cls}">${icon(status.ic)}</span><div><div class="now-title">${esc(status.title)}</div><div class="now-sub">${esc(status.sub)}</div></div></div>
    <div class="now-next">${next}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Print summary: header, key facts, a few rules, and the timeline(s) with times

function fillPrintSheet() {
  const sheet = $('#print-sheet');
  const plan = state.plan;
  document.body.classList.toggle('has-print-sheet', !!plan);
  if (!plan) { sheet.innerHTML = ''; return; }
  const s = plan.summary;
  const out = plan.out;
  const ret = plan.ret;
  const from = shortName(s.home);
  const to = shortName(s.dest);
  const raw = s.oD - s.oH;
  const [bed, wake] = targetSleep(plan);
  const view = scheduleView();
  const legLine = (l) => `${fD(l.origin.tz, l.depUtc)} <b>${fT(l.origin.tz, l.depUtc)}</b> ${esc(shortName(l.origin))} → ${fD(l.dest.tz, l.arrUtc)} <b>${fT(l.dest.tz, l.arrUtc)}</b> ${esc(shortName(l.dest))} · ${fDur((l.arrUtc - l.depUtc) / MIN)}`;

  const strategy = { adjust: 'Fully adjust', home: 'Stay on home time', partial: 'Meet halfway' }[s.strategy];
  const shift = out.P === 0 ? 'None' : `${fHours(out.P)} ${out.P > 0 ? 'earlier' : 'later'}`;
  const adjusted = s.strategy === 'home' ? 'n/a' : out.adjustedDate ? fDiso(out.adjustedDate) : '—';

  const rules = [];
  if (s.strategy === 'home') rules.push(`<b>Home time:</b> sleep about ${bed}–${wake} local; daylight in your home-time daytime.`);
  else if (out.dir === 'advance') rules.push('<b>Light:</b> bright light in the mornings, dim evenings (exact windows below).');
  else if (out.dir === 'delay') rules.push(`<b>Light:</b> bright light in the evenings, dim mornings (exact windows below).${out.choice.flipped ? ' Long way round: the eastbound rule flips.' : ''}`);
  if (out.prep) rules.push(`<b>Before you fly:</b> bed and wake about 1 h ${out.P > 0 ? 'earlier' : 'later'} each day.`);
  rules.push(`<b>On the plane:</b> switch to ${esc(to)} time; eat and sleep on it.`);
  if (s.strategy !== 'home') rules.push(`<b>After landing:</b> stay up until bedtime; naps 20–30 min max.`);
  const extras = [];
  if (out.melatonin.length) extras.push('melatonin (optional; 0.5–1 mg is usually enough) 30–60 min before bed where listed; ask your doctor');
  if (out.nightMelatonin.length) extras.push('melatonin 0.5 mg only if you wake in the listed night windows (optional; ask your doctor)');
  if (plan.input.caffeine) extras.push('caffeine fine in local daytime, none within 6 h of bed');
  if (extras.length) rules.push(`<b>Also:</b> ${extras.join('; ')}.`);
  if (plan.event) rules.push(`<b>Event ${fD(s.dest.tz, plan.event.eventUtc)} ${fT(s.dest.tz, plan.event.eventUtc)}:</b> body clock ~${fBodyClock(plan.event.bodyHour)} (${plan.event.label.text.toLowerCase()}).`);

  const legend = view === 'timeline' ? `<ul class="ps-legend">
    <li><i class="sw sw-sleep"></i>Sleep</li><li><i class="sw sw-seek"></i>Bright light</li><li><i class="sw sw-avoid"></i>Avoid light</li>
    <li><i class="sw sw-flight"></i>Flight</li><li><i class="sw sw-mel"></i>Melatonin</li><li><i class="sw sw-day"></i>Daylight</li></ul>` : '';
  const sched = (l) => (view === 'timeline' ? `<div class="timeline">${timelineHTML(l, { print: true })}</div>` : tableHTML(l, { print: true }));
  const url = location.href.split('#')[0];

  sheet.innerHTML = `
    <header class="ps-head">
      <h1>${esc(from)} → ${esc(to)}</h1>
      <div class="ps-brand">Jet lag plan · Meridian</div>
    </header>
    <dl class="ps-facts">
      <div><dt>Time difference</dt><dd>${raw > 0 ? '+' : raw < 0 ? '−' : ''}${fHours(raw)}</dd></div>
      <div><dt>Body-clock shift</dt><dd>${shift}</dd></div>
      <div><dt>Strategy</dt><dd>${strategy}</dd></div>
      <div><dt>Adjusted by</dt><dd>${adjusted}</dd></div>
    </dl>
    <ul class="ps-rules">${rules.map((r) => `<li>${r}</li>`).join('')}</ul>
    <section class="ps-leg">
      <h2 class="ps-section">Outbound <small>${legLine(out)}</small></h2>
      ${legend}${sched(out)}
    </section>
    ${ret ? `<section class="ps-leg"><h2 class="ps-section">Return <small>${legLine(ret)}</small></h2>${sched(ret)}</section>` : ''}
    <p class="ps-foot">Times are local: home clock until you fly, destination clock after you land. Full plan: ${esc(url)}<br>General guidance, not medical advice.</p>`;
}

// ---------------------------------------------------------------------------
// Build / share / export

function paramsString(v) {
  const p = new URLSearchParams();
  for (const [k, val] of Object.entries(v)) if (val !== '' && val != null) p.set(k, val);
  return p.toString();
}

function build({ scroll = true } = {}) {
  showError('');
  const v = readForm();
  const res = toInput(v);
  if (res.errors) { showError(res.errors[0]); return false; }
  let plan;
  try { plan = buildPlan(res.input); } catch (e) { showError(e.message); return false; }
  state.plan = plan;
  state.leg = 'out';
  const qs = paramsString(v);
  state.paramsKey = hash(qs);
  store.set('meridian-last', v);
  try { history.replaceState(null, '', `${location.pathname}?${qs}`); } catch { /* file:// etc */ }
  els.results.hidden = false;
  renderResults();
  if (scroll) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

async function share() {
  const url = location.href.split('#')[0];
  const s = state.plan?.summary;
  const title = s ? `Jet lag plan: ${shortName(s.home)} → ${shortName(s.dest)}` : 'Jet lag plan';
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title, url }); return; } catch { /* cancelled */ }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied. It opens this exact plan.'); }
  catch { window.prompt('Copy this link:', url); }
}

function downloadIcs() {
  const plan = state.plan;
  const text = buildIcs(plan, { fT, shortName });
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `jet-lag-${shortName(plan.summary.home)}-${shortName(plan.summary.dest)}.ics`.replace(/\s+/g, '-').toLowerCase();
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Calendar file downloaded. Open it to add reminders.');
}

// ---------------------------------------------------------------------------
// Example & defaults

function fillExample() {
  const chi = cityById('chicago-united-states');
  const tyo = cityById('tokyo-japan');
  const today = localDateISO(chi.tz, Date.now());
  const dep = addDaysISO(today, 12);
  const depUtc = zonedToUtc(chi.tz, dep, 11 * 60 + 45);
  const arrUtc = depUtc + (13 * 60 + 10) * MIN;
  writeForm({
    f: chi.id, t: tyo.id, dd: dep, dt: '11:45', am: 'a',
    ad: localDateISO(tyo.tz, arrUtc), at: fmtHM(localMinutes(tyo.tz, arrUtc)),
    b: '23:00', w: '07:00', rd: addDaysISO(localDateISO(tyo.tz, arrUtc), 9), rt: '17:00',
    p: '3', g: 'auto', m: '1', c: '1',
  });
  build();
}
const fmtHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Clear the current plan and the remembered trip, and go back to an empty form
function resetPlan() {
  state.plan = null;
  state.leg = 'out';
  store.remove('meridian-last');
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  els.form.reset();
  state.from = null;
  state.to = null;
  els.fromInput.value = '';
  els.toInput.value = '';
  $$('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  showError('');
  els.results.hidden = true;
  $('#now-box').innerHTML = '';
  document.body.classList.remove('has-print-sheet');
  defaults();
  syncModes();
  updateHints();
  updatePreview();
}

function defaults() {
  const home = guessHome();
  if (home) setPlace('from', home);
  const tz = home ? home.tz : 'UTC';
  els.depDate.value = addDaysISO(localDateISO(tz, Date.now()), 7);
}

// ---------------------------------------------------------------------------
// Tooltip

function setupTooltip() {
  const tip = $('#tooltip');
  const show = (el, x, y) => {
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 12; let top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 12;
    if (top + r.height > innerHeight - 8) top = y - r.height - 12;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else tip.hidden = true;
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); }
  });
  document.addEventListener('focusout', () => { tip.hidden = true; });
  document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
}

// ---------------------------------------------------------------------------
// Init

function applyThemeLabel() {
  $('#clock-label').textContent = prefs.clock24 ? '24h' : '12h';
}

function init() {
  setupCombo('from');
  setupCombo('to');
  setupTooltip();
  applyThemeLabel();

  $('#swap-btn').addEventListener('click', () => {
    const a = state.from; const b = state.to;
    if (b) setPlace('from', b); else { state.from = null; els.fromInput.value = ''; }
    if (a) setPlace('to', a); else { state.to = null; els.toInput.value = ''; }
    updatePreview();
  });
  $$('input[name="arr-mode"], input[name="goal"]').forEach((r) => r.addEventListener('change', syncModes));
  els.form.addEventListener('input', (e) => { if (!e.target.closest('.combo')) updatePreview(); });
  els.form.addEventListener('change', (e) => { if (e.target.name === 'prep') updatePreview(); });
  els.form.addEventListener('submit', (e) => { e.preventDefault(); build(); });
  $('#example-btn').addEventListener('click', fillExample);
  $('#share-btn').addEventListener('click', share);
  $('#ics-btn').addEventListener('click', downloadIcs);
  $('#print-btn').addEventListener('click', () => { fillPrintSheet(); window.print(); });
  $('#reset-btn').addEventListener('click', () => {
    resetPlan();
    $('#planner').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('Cleared. Start a new plan.');
  });
  $('#edit-btn').addEventListener('click', () => {
    $('#planner').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => els.depDate.focus({ preventScroll: true }), 400);
  });
  $('.brand').addEventListener('click', (e) => {
    e.preventDefault();
    if (state.plan || location.search) resetPlan();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  addEventListener('beforeprint', fillPrintSheet);
  // hovering a time in the list highlights its block on the bar (and vice versa)
  const hl = (k, on) => $$(`#schedule [data-k="${k}"]`).forEach((n) => n.classList.toggle('hl', on));
  $('#schedule').addEventListener('pointerover', (e) => { const n = e.target.closest('[data-k]'); if (n) hl(n.dataset.k, true); });
  $('#schedule').addEventListener('pointerout', (e) => { const n = e.target.closest('[data-k]'); if (n) hl(n.dataset.k, false); });
  $$('input[name="view"]').forEach((r) => r.addEventListener('change', () => {
    store.set('meridian-view', r.value);
    if (state.plan) renderSchedule(currentLeg());
  }));
  $('#expand-all').addEventListener('click', () => {
    const cards = $$('#days details.day');
    const open = !cards.every((d) => d.open);
    cards.forEach((d) => { d.open = open; });
    syncExpandLabel();
  });
  $('#days').addEventListener('toggle', syncExpandLabel, true);
  $('#leg-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-leg]');
    if (!b) return;
    state.leg = b.dataset.leg;
    $$('#leg-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderLeg();
  });
  $('#days').addEventListener('change', (e) => {
    const cb = e.target.closest('.act-check');
    if (!cb) return;
    const done = store.get('meridian-done', {});
    if (cb.checked) done[cb.dataset.doneKey] = 1; else delete done[cb.dataset.doneKey];
    store.set('meridian-done', done);
    cb.closest('.act').classList.toggle('done', cb.checked);
  });
  $('#theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('meridian-theme', next); } catch { /* ignore */ }
  });
  $('#clock-toggle').addEventListener('click', () => {
    prefs.clock24 = !prefs.clock24;
    store.set('meridian-clock24', prefs.clock24);
    fmtCache.clear();
    applyThemeLabel();
    updatePreview();
    if (state.plan) renderResults();
  });

  const params = Object.fromEntries(new URLSearchParams(location.search));
  if (params.f && params.t) {
    writeForm(params);
    build({ scroll: true });
  } else {
    const last = store.get('meridian-last');
    if (last && last.f && last.t) {
      writeForm(last);
      build({ scroll: false });
    } else defaults();
  }
  syncModes();
  updateHints();
  setInterval(() => { if (state.plan) renderNow(); }, 60000);
  let lastW = innerWidth;
  addEventListener('resize', () => {
    clearTimeout(init.rt);
    init.rt = setTimeout(() => { if (state.plan && Math.abs(innerWidth - lastW) > 40) { lastW = innerWidth; renderProgress(currentLeg()); } }, 200);
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();

