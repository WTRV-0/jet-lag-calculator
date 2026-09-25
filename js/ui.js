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
  const choice = chooseShift(diff);
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
    if (choice.flipped) note = `<b>The rule flips here.</b> Shifting ${fHours(choice.amount)} <em>later</em> is about as fast as ${fHours(24 - choice.amount)} earlier, and much easier on the body. Expect <b>evening light</b> and <b>no morning light</b> at first.`;
    else if (choice.dir === 'advance') note = `Eastward shift: your clock needs to move <b>${fHours(choice.amount)} earlier</b>. Expect <b>morning light</b> and <b>dim evenings</b>. Roughly ${choice.days} day${choice.days === 1 ? '' : 's'} to adjust fully.`;
    else note = `Westward shift: your clock needs to move <b>${fHours(choice.amount)} later</b>. Expect <b>evening light</b> and <b>dim mornings</b>. Roughly ${choice.days} day${choice.days === 1 ? '' : 's'} to adjust fully.`;
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

  // stats
  const stratName = { adjust: 'Fully adjust', home: 'Stay on home time', partial: 'Meet halfway' }[s.strategy];
  let adjValue; let adjSub;
  if (s.strategy === 'home') { adjValue = 'Home time'; adjSub = 'No shift needed'; }
  else if (out.adjustedDate) {
    adjValue = fDiso(out.adjustedDate);
    adjSub = out.daysToAdjust === 0 ? 'By the time you land' : `${out.daysToAdjust} day${out.daysToAdjust === 1 ? '' : 's'} after landing${s.strategy === 'partial' ? ' (halfway)' : ''}`;
  } else { adjValue = '—'; adjSub = 'Beyond the trip'; }
  const shiftVal = out.P === 0 ? 'None' : `${fHours(out.P)} ${out.P > 0 ? 'earlier' : 'later'}`;
  $('#stats').innerHTML = [
    ['Time difference', `${raw > 0 ? '+' : raw < 0 ? '−' : ''}${fHours(raw)}`, Math.abs(raw) < 0.01 ? 'Same time zone' : `${esc(shortName(s.dest))} is ${raw > 0 ? 'ahead' : 'behind'}`],
    ['Body-clock shift', shiftVal, s.strategy === 'home' ? 'Holding home time' : out.dir === 'advance' ? '≈ 1 h per day' : out.dir === 'delay' ? '≈ 1.5 h per day' : 'Nothing to shift'],
    ['Adjusted by', adjValue, adjSub],
    ['Flight', fDur(s.flightMin), `Lands ${fT(s.dest.tz, plan.times.arrUtc)}, ${fD(s.dest.tz, plan.times.arrUtc)}`],
  ].map(([l, v, sub]) => `<div class="card stat"><div class="stat-label">${l}</div><div class="stat-value">${esc(v)}</div><div class="stat-sub">${sub}</div></div>`).join('');

  $('#strategy-box').innerHTML = strategyCallout(plan, stratName);
  renderEvent();
  $('#leg-tabs').hidden = !plan.ret;
  $$('#leg-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.leg === state.leg)));
  renderLeg();
  renderNow();
}

function strategyCallout(plan, stratName) {
  const s = plan.summary;
  const out = plan.out;
  const c = s.choice;
  const tripN = s.tripDays != null ? Math.max(1, Math.round(s.tripDays)) : null;
  const trip = tripN != null ? `${tripN} day${tripN === 1 ? '' : 's'}` : null;
  let title; let body; let ic = 'sun';
  const [destBed, destWake] = targetSleep(plan);
  if (s.strategy === 'home') {
    ic = 'home';
    title = 'Stay on home time';
    body = `<p>${trip ? `You're there for about ${trip}, which` : 'This trip'} is too short to be worth shifting ${fHours(c.amount)} and then shifting back. Keep your home sleep times as closely as you can: that's roughly <b>${destBed}–${destWake}</b> local time. Get daylight during your home-time daytime and keep it dim during your home-time night.</p><p>If you can, book important meetings during your home-time daytime.</p>`;
  } else if (out.dir === 'none') {
    ic = 'check';
    title = 'No real shift needed';
    body = '<p>The time difference is tiny. Sleep on local time, get morning daylight, and you\'ll feel normal after a night or two of good sleep.</p>';
  } else {
    const pace = out.dir === 'advance' ? 'about 1 hour a day' : 'about 1.5 hours a day';
    const how = out.dir === 'advance'
      ? '<b>morning light</b> and <b>dim evenings</b>, with melatonin before bed if you choose it'
      : '<b>evening light</b> and <b>dim mornings</b>';
    if (s.strategy === 'partial') {
      ic = 'contrast';
      title = 'Meet halfway';
      body = `<p>${trip ? `About ${trip} there` : 'This stay'} isn't long enough to fully shift ${fHours(c.amount)}. The plan moves your clock <b>${fHours(out.P)} ${out.dir === 'advance' ? 'earlier' : 'later'}</b> using ${how}, and has you sleep around <b>${destBed}–${destWake}</b> local time. Local days are easier, and the trip home is shorter to recover from.</p>`;
    } else {
      title = `Shift your body clock ${fHours(out.P)} ${out.dir === 'advance' ? 'earlier' : 'later'}`;
      body = `<p>The plan uses ${how}. Your clock moves at ${pace}${out.prep ? `, starting ${out.prep} day${out.prep === 1 ? '' : 's'} before you fly` : ''}. From arrival you sleep on local time, <b>${destBed}–${destWake}</b>.</p>`;
    }
    if (c.flipped) {
      body += `<p>Flying ${fHours(s.diff)} east would normally mean shifting earlier. That takes about ${c.altDays} days, but going the other way round (${fHours(c.amount)} later) takes about ${c.days}, and later shifts are gentler. So the light advice is the <b>opposite</b> of the usual eastbound rule.</p><span class="rule-flip">↺ Long way round: the eastbound rule flips</span>`;
    } else if (s.travelDir === 'east' && s.zones >= 8) {
      body += `<p>At ${fHours(s.zones)} east this is close to the point where going the long way round wins. The plan checked, and shifting earlier is still faster for this trip.</p>`;
    }
  }
  if (s.reason === 'chosen' && s.autoStrategy !== s.strategy) {
    const alt = { adjust: 'fully adjusting', home: 'staying on home time', partial: 'meeting halfway' }[s.autoStrategy];
    body += `<p class="muted">You chose this goal. For this trip length, the planner would have suggested ${alt}.</p>`;
  } else if (s.reason === 'short' || s.reason === 'medium' || s.reason === 'long') {
    body += `<p class="muted">Chosen automatically${tripN != null ? ` for your ${tripN}-day stay` : ''}.${s.tripDays == null ? ' Add a return date and the planner can decide whether a short trip is better spent on home time.' : ''}</p>`;
  }
  return `<div class="card callout"><span class="ic-wrap">${icon(ic)}</span><div><h3>${esc(title || stratName)}</h3>${body}</div></div>`;
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
  if (ev.score < 0.75) {
    tips.push('Get 20–30 minutes of bright light right before it. Light makes you more alert straight away, whatever the time.');
    if (state.plan.input.caffeine) tips.push('Have a coffee 30–60 minutes before, if it\'s at least 6 hours before your bedtime.');
    tips.push('If you can, take a 20-minute nap 2–4 hours before, and no longer, to avoid grogginess.');
    tips.push('Eat a light, protein-rich meal beforehand rather than a heavy one.');
  } else {
    tips.push('Your body clock should be in a good place. Just protect the night before with a normal local bedtime.');
  }
  if (ev.beforeArrival) tips.unshift('Heads up: this event is before you land.');
  if (ev.afterReturn) tips.unshift('Heads up: this event is after your return flight.');
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
  renderTimeline(leg);
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
function renderTimeline(leg) {
  $('#timeline').innerHTML = timelineHTML(leg);
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

// ---- day cards ------------------------------------------------------------
function lightNote(w, tz, kind) {
  if (kind === 'seek') {
    if (w.light === 'flight') return 'On the plane: reading light on, screen bright, window shade up if it\'s light outside.';
    if (w.light === 'sun') return 'Get outside. Daylight is far brighter than indoor light, even when it\'s cloudy.';
    if (w.light === 'dark') return 'It\'s dark outside then, so use a light box (10,000 lux) or the brightest indoor light you can.';
    if (w.light === 'mixed') {
      if (w.sunrise > w.start && w.sunrise < w.end) return `Sunrise is ${fT(tz, w.sunrise)}. Use bright indoor light or a light box before then, then get outside.`;
      if (w.sunset > w.start && w.sunset < w.end) return `Get outside before sunset at ${fT(tz, w.sunset)}, then switch to bright indoor light.`;
      return 'Get outside while it\'s light; use bright indoor light otherwise.';
    }
    return 'Get outside if you can, or sit by a bright window.';
  }
  if (w.hold) return 'You\'re staying on home time, so keep light low here to stop your clock drifting.';
  if (w.light === 'flight') return 'Eye mask on, window shade down, screens dimmed.';
  if (w.light === 'daylight') return 'Wear dark sunglasses outside and keep to dim rooms.';
  if (w.light === 'dark') return 'Keep lights low and warm, and turn screen brightness down.';
  return 'Keep lights low and wear sunglasses if you go outside.';
}

function cbtLocal(leg, tz, near) {
  const c = leg.cbts.reduce((best, x) => (Math.abs(x.t - near) < Math.abs(best.t - near) ? x : best), leg.cbts[0]);
  return c ? fT(tz, c.t) : '';
}

function buildActions(leg, r) {
  const tz = r.tz;
  const acts = [];
  const push = (t, o) => acts.push({ t, ...o });
  const within = (x) => x >= r.ownStart && x < r.ownEnd;
  const isPost = r.kind === 'arrival' || r.kind === 'post';
  const shifting = leg.dir !== 'none' && leg.strategy !== 'home';

  for (const w of r.wakes) {
    const prepShift = leg.sleeps.find((s) => s.end === w.at)?.shiftH || 0;
    let text = '<b>Wake up</b>';
    let why = 'A consistent wake time anchors your body clock.';
    if (r.kind === 'prep' || (r.kind === 'departure' && prepShift)) {
      if (prepShift) text += ` (${fHours(prepShift)} ${prepShift > 0 ? 'earlier' : 'later'} than usual)`;
      why = 'Moving your wake time about an hour a day shifts your clock before you leave.';
    } else if (isPost) {
      text += ' on local time, even if you slept badly';
      why = 'Getting up at the same local time every day is one of the strongest signals for your clock.';
    }
    push(w.at, { cls: 'sleep', ic: 'alarm', time: fT(tz, w.at), text, why, key: 'wake' + w.at });
  }
  for (const w of r.own.seek) {
    const a = w.start; const b = w.end;
    if (b - a < 20 * MIN) continue;
    const why = leg.dir === 'advance'
      ? `Light after your body's temperature low point (about ${cbtLocal(leg, tz, w.cbt)} on this clock) moves your clock earlier.`
      : `Light in the hours before your body's temperature low point (about ${cbtLocal(leg, tz, w.cbt)} on this clock) moves your clock later.`;
    push(a, { cls: 'seek', ic: 'sun', time: fT(tz, a), until: fT(tz, b), text: `<b>Seek bright light</b> until ${fT(tz, b)}. ${esc(lightNote(w, tz, 'seek'))}`, why, key: 'seek' + w.rawStart });
  }
  for (const w of r.own.avoid) {
    const a = w.start; const b = w.end;
    if (b - a < 20 * MIN) continue;
    const why = w.hold
      ? 'Bright light near your body\'s temperature low point would start shifting your clock, and you\'re trying to keep it on home time.'
      : leg.dir === 'advance'
        ? 'Light in the hours before your temperature low point would push your clock later, the wrong way.'
        : 'Light just after your temperature low point would pull your clock earlier, the wrong way.';
    push(a, { cls: 'avoid', ic: 'shades', time: fT(tz, a), until: fT(tz, b), text: `<b>Avoid bright light</b> until ${fT(tz, b)}. ${esc(lightNote(w, tz, 'avoid'))}`, why, key: 'avoid' + w.rawStart });
  }
  for (const m of r.own.melatonin) {
    push(m.at, { cls: 'mel', ic: 'pill', time: fT(tz, m.at), text: '<b>Melatonin</b>, 0.5–3 mg, 30–60 minutes before bed (optional; ask your doctor)', why: 'Taken before your new, earlier bedtime, a low dose helps pull your clock earlier and makes it easier to fall asleep.', key: 'mel' + m.at });
  }
  for (const c of r.caffeine) {
    push(c.at, { cls: '', ic: 'coffee', time: fT(tz, c.at), text: '<b>Last caffeine</b> of the day', why: 'Caffeine stays in your system for 5–6 hours or more. Stopping 8 hours before bed protects your sleep.', key: 'caf' + c.at });
  }
  for (const bd of r.beds) {
    let text = '<b>Go to bed</b>';
    let why = 'Sleeping at the right time on the new clock locks in each day\'s progress.';
    if (r.kind === 'prep' && bd.shiftH) {
      text += ` (${fHours(bd.shiftH)} ${bd.shiftH > 0 ? 'earlier' : 'later'} than usual)`;
      why = 'Shifting bedtime about an hour a day moves you toward destination time before you fly.';
    } else if (r.kind === 'arrival' && leg.strategy !== 'home') {
      text += '. Stay up until now, even if you\'re tired';
      why = 'Going to bed at local bedtime on day one is the fastest way to reset. Early nights keep you on the old clock.';
    } else if (leg.strategy === 'home' && isPost) {
      text += ' (home-time bedtime)';
      why = 'You\'re staying on home time for this short trip.';
    }
    push(bd.at, { cls: 'sleep', ic: 'bed', time: fT(tz, bd.at), text, why, key: 'bed' + bd.at });
  }
  if (r.kind === 'departure') {
    push(leg.depUtc, { cls: '', ic: 'plane', time: fT(tz, leg.depUtc), text: `<b>Flight departs</b>. Set your watch to ${esc(shortName(leg.dest))} time when you board`, why: 'Thinking in destination time helps you eat and sleep on the new schedule.', key: 'dep' });
  }
  if (r.kind === 'arrival') {
    push(leg.arrUtc, { cls: '', ic: 'land', time: fT(tz, leg.arrUtc), text: `<b>Land in ${esc(shortName(leg.dest))}</b>`, why: '', key: 'arr' });
  }
  const ev = state.plan.event;
  if (ev && leg.leg === 'out' && within(ev.eventUtc)) {
    push(ev.eventUtc, { cls: 'event', ic: 'star', time: fT(tz, ev.eventUtc), text: `<b>Your event</b>. Your body will feel like it's ${fBodyClock(ev.bodyHour)} <span class="pill ${ev.label.key}">${ev.label.text}</span>`, why: '', key: 'event' });
  }
  acts.sort((x, y) => x.t - y.t);

  // untimed tips
  const tips = [];
  if (r.kind === 'prep') {
    tips.push(['meal', 'Move meals with your sleep: breakfast soon after your new wake time.']);
    if (r.index === 1) tips.push(['shades', 'Pack sunglasses, an eye mask and earplugs. You\'ll use all three.']);
  }
  if (r.kind === 'departure') {
    tips.push(['water', 'Drink water through the day. Go easy on alcohol and caffeine; both disrupt sleep.']);
    if (!shifting && leg.strategy === 'home') tips.push(['home', `You're staying on home time, so keep your watch on ${shortName(leg.origin)} time for sleep.`]);
  }
  if (isPost) {
    if (leg.strategy === 'home') {
      tips.push(['bed', 'Blackout curtains or an eye mask help if your home-time sleep falls in local daylight.']);
      tips.push(['clock', 'Put important things in your home-time daytime if you can.']);
    } else if (r.outOfSync) {
      const bodyNoon = 12 + r.bodyVsLocal;
      tips.push(['nap', `Tired? A 20–30 minute nap is fine, but no longer and not after ${fT('UTC', Date.UTC(2000, 0, 1, 15))}. At local noon your body feels like it's ${fBodyClock(bodyNoon)}.`]);
      tips.push(['walk', 'Exercise or walk during local daytime, ideally in your light window.']);
      tips.push(['meal', 'Eat on local time, even if you\'re not hungry.']);
    } else if (r.adjusted) {
      tips.push(['check', 'You should feel close to normal. Keep a regular local bedtime and get morning daylight.']);
    } else {
      tips.push(['walk', 'Keep moving during local daytime and eat on local time.']);
    }
  }
  return { acts, tips };
}

function bodyClockLine(r) {
  if (Math.abs(r.bodyVsLocal) < 0.25) return `${icon('check')}<span>Your body clock matches local time.</span>`;
  const noon = Date.UTC(2000, 0, 1, 12);
  return `${icon('clock')}<span>At ${fT('UTC', noon)} here your body feels like it's <b>${fBodyClock(12 + r.bodyVsLocal)}</b>.</span>`;
}

function actionList(acts, legKey) {
  const done = store.get('meridian-done', {});
  return `<ul class="actions">${acts.map((a) => {
    const k = `${state.paramsKey}|${legKey}|${a.key}`;
    const isDone = !!done[k];
    return `<li class="act${isDone ? ' done' : ''}">
      <input type="checkbox" class="act-check" data-done-key="${esc(k)}" ${isDone ? 'checked' : ''} aria-label="Mark done">
      <span class="act-time">${a.time}${a.until ? `<small>to ${a.until}</small>` : ''}${a.sub ? `<small>${a.sub}</small>` : ''}</span>
      <span class="act-icon ${a.cls}">${icon(a.ic)}</span>
      <span class="act-text">${a.text}${a.why ? `<details><summary></summary><p>${esc(a.why)}</p></details>` : ''}</span>
    </li>`;
  }).join('')}</ul>`;
}

function flightCard(leg) {
  const f = leg.flight;
  const dz = leg.dest.tz;
  const oz = leg.origin.tz;
  const both = (t) => `${fT(dz, t)}`;
  const sub = (t) => `${fT(oz, t)} ${shortName(leg.origin)}`;
  const acts = [];
  acts.push({ t: f.start, cls: '', ic: 'plane', time: both(f.start), sub: sub(f.start), text: `<b>Board and switch to ${esc(shortName(leg.dest))} time.</b> From here, eat and sleep on destination time.`, why: 'Changing your watch on boarding stops you thinking in home time.', key: 'f-board' });
  for (const s of f.sleeps) {
    acts.push({ t: s.start, cls: 'sleep', ic: 'bed', time: both(s.start), sub: `to ${fT(dz, s.end)}`, text: `<b>Sleep on the plane</b> until ${fT(dz, s.end)}. It's night at your destination. Use an eye mask and earplugs, and skip the meal service if you have to.`, why: 'Sleeping during destination night starts your new rhythm before you land.', key: 'f-sleep' + s.start });
    if (leg.dir === 'advance' && state.plan.input.melatonin && leg.strategy !== 'home') {
      acts.push({ t: s.start - 30 * MIN, cls: 'mel', ic: 'pill', time: both(s.start - 30 * MIN), text: '<b>Melatonin</b> (optional), 30 minutes before in-flight sleep', why: 'This is destination evening, so melatonin now nudges your clock earlier and helps you sleep.', key: 'f-mel' + s.start });
    }
  }
  // awake stretches (≥ 90 min) between flight sleeps
  const edges = [f.start + 30 * MIN, ...f.sleeps.flatMap((s) => [s.start, s.end]), f.end - 30 * MIN];
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i]; const b = edges[i + 1];
    if (b - a >= 90 * MIN) acts.push({ t: a + 1, cls: '', ic: 'walk', time: both(a), sub: `to ${fT(dz, b)}`, text: '<b>Stay awake.</b> Stretch, walk the aisle, drink water. It\'s daytime at your destination.', why: 'Staying awake through destination daytime builds sleep pressure for the right time.', key: 'f-awake' + a });
  }
  for (const w of f.seek) if (w.end - w.start >= 20 * MIN) acts.push({ t: w.start + 2, cls: 'seek', ic: 'sun', time: both(w.start), sub: `to ${fT(dz, w.end)}`, text: `<b>Seek light</b> until ${fT(dz, w.end)}: reading light on, screen bright, window shade up if it's light outside.`, why: 'This light is well timed to shift your clock in the right direction.', key: 'f-seek' + w.start });
  for (const w of f.avoid) if (w.end - w.start >= 20 * MIN) acts.push({ t: w.start + 2, cls: 'avoid', ic: 'shades', time: both(w.start), sub: `to ${fT(dz, w.end)}`, text: `<b>Keep it dark</b> until ${fT(dz, w.end)}: shade down, eye mask, screens dim.`, why: 'Light now would push your clock the wrong way.', key: 'f-avoid' + w.start });
  acts.push({ t: f.end, cls: '', ic: 'land', time: both(f.end), sub: sub(f.end), text: `<b>Land</b> at ${fT(dz, f.end)} local time.`, why: '', key: 'f-land' });
  acts.sort((x, y) => x.t - y.t);
  const tips = [
    ['water', 'Drink water regularly. Go easy on alcohol, which fragments sleep, and on caffeine.'],
    ['meal', `Eat on ${shortName(leg.dest)} time. Skip meals that fall in the middle of your sleep window.`],
  ];
  if (state.plan.input.caffeine) {
    const firstBed = leg.sleeps.find((s) => s.place === 'dest');
    if (firstBed) tips.push(['coffee', `No caffeine after ${fT(dz, firstBed.start - 8 * HOUR)} ${shortName(leg.dest)} time (8 hours before your first local bedtime).`]);
  }
  return `<article class="card day flight-card">
    <div class="day-head"><div><div class="day-kicker">In the air</div><div class="day-title">${esc(shortName(leg.origin))} → ${esc(shortName(leg.dest))}</div></div><span class="day-zone">${esc(shortName(leg.dest))} time</span></div>
    <div class="flight-meta"><span>Departs <b>${fT(oz, f.start)}</b> ${esc(fD(oz, f.start))} (${esc(shortName(leg.origin))})</span><span>Arrives <b>${fT(dz, f.end)}</b> ${esc(fD(dz, f.end))} (${esc(shortName(leg.dest))})</span><span>${fDur((f.end - f.start) / MIN)}</span></div>
    ${actionList(acts, leg.leg)}
    <ul class="tips">${tips.map(([ic, t]) => `<li>${icon(ic)}<span>${esc(t)}</span></li>`).join('')}</ul>
  </article>`;
}

function renderDays(leg) {
  const { rows, collapsed } = visibleRows(leg);
  let html = '';
  const target = Math.abs(leg.P);
  for (const r of rows) {
    const { acts, tips } = buildActions(leg, r);
    const prog = leg.progress.find((p) => p.date === r.date && p.kind === r.kind);
    const pct = target > 0 ? Math.min(100, Math.round(((prog?.shifted ?? 0) / target) * 100)) : 100;
    html += `<article class="card day">
      <div class="day-head"><div><div class="day-kicker">${esc(kindLabel(r))}</div><h4 class="day-title">${esc(fDiso(r.date))}</h4></div><span class="day-zone">${esc(shortName(r.place))} time</span></div>
      <div class="day-body-clock">${bodyClockLine(r)}</div>
      ${target > 0 ? `<div class="day-progress" title="${pct}% of the shift done by the end of the day"><i style="width:${pct}%"></i></div>` : ''}
      ${acts.length ? actionList(acts, leg.leg) : '<p class="muted">Nothing special today. Normal routine.</p>'}
      ${tips.length ? `<ul class="tips">${tips.map(([ic, t]) => `<li>${icon(ic)}<span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
    </article>`;
    if (r.kind === 'departure') html += flightCard(leg);
  }
  if (collapsed.length) {
    const a = collapsed[0]; const b = collapsed[collapsed.length - 1];
    html += `<div class="card day-collapsed">${icon('check')}<div><b>${esc(fDiso(a.date))}${collapsed.length > 1 ? ` – ${esc(fDiso(b.date))}` : ''}: you're adjusted.</b><br>Keep a regular local bedtime, get daylight in the morning, and enjoy the trip.</div></div>`;
  }
  $('#days').innerHTML = html;
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
  const leg = (l) => `${fD(l.origin.tz, l.depUtc)}, <b>${fT(l.origin.tz, l.depUtc)}</b> ${esc(shortName(l.origin))} → ${fD(l.dest.tz, l.arrUtc)}, <b>${fT(l.dest.tz, l.arrUtc)}</b> ${esc(shortName(l.dest))} (${fDur((l.arrUtc - l.depUtc) / MIN)})`;

  const strategy = { adjust: 'Fully adjust', home: 'Stay on home time', partial: 'Meet halfway' }[s.strategy];
  const shift = out.P === 0 ? 'None' : `${fHours(out.P)} ${out.P > 0 ? 'earlier' : 'later'}`;
  let adjusted = '—';
  if (s.strategy === 'home') adjusted = 'n/a (home time)';
  else if (out.adjustedDate) adjusted = fDiso(out.adjustedDate);

  const rules = [];
  if (s.strategy === 'home') rules.push(`<b>Stay on home time:</b> sleep about ${bed}–${wake} ${esc(to)} time; daylight in your home-time daytime, dim light in your home-time night.`);
  else if (out.dir === 'advance') rules.push(`<b>Shift ${fHours(out.P)} earlier:</b> bright light in the morning windows, dim light in the evenings.`);
  else if (out.dir === 'delay') rules.push(`<b>Shift ${fHours(out.P)} later:</b> bright light in the evening windows, dim light in the mornings.${out.choice.flipped ? ' (Long way round: the usual eastbound rule flips.)' : ''}`);
  if (out.prep) rules.push(`<b>Before you fly</b> (from ${fDiso(out.rows[0].date)}): go to bed and get up about 1 h ${out.P > 0 ? 'earlier' : 'later'} each day.`);
  const fs = out.flightSleeps.map((w) => fRange(s.dest.tz, w.start, w.end));
  rules.push(`<b>On the plane:</b> switch to ${esc(to)} time; ${fs.length ? `sleep ${fs.join(' and ')}` : 'stay awake if you can'}. Water yes; go easy on alcohol and caffeine.`);
  if (s.strategy !== 'home') rules.push(`<b>After landing:</b> sleep ${bed}–${wake}; stay up until bedtime on day one; naps 20–30 min max.`);
  const extras = [];
  if (plan.input.melatonin && out.melatonin.length) extras.push('melatonin 0.5–3 mg 30–60 min before bed where marked (optional; ask your doctor)');
  if (plan.input.caffeine) extras.push('no caffeine within 8 h of bedtime');
  if (extras.length) rules.push(`<b>Also:</b> ${extras.join('; ')}.`);
  if (plan.event) rules.push(`<b>Event</b> ${fD(s.dest.tz, plan.event.eventUtc)} ${fT(s.dest.tz, plan.event.eventUtc)}: body clock will read ~${fBodyClock(plan.event.bodyHour)} (${plan.event.label.text.toLowerCase()}). Bright light and coffee 30–60 min before help.`);

  const legend = `<ul class="ps-legend">
    <li><i class="sw sw-sleep"></i>Sleep</li><li><i class="sw sw-seek"></i>Seek bright light</li><li><i class="sw sw-avoid"></i>Avoid bright light</li>
    <li><i class="sw sw-flight"></i>In flight</li><li><i class="sw sw-mel"></i>Melatonin</li><li><i class="sw sw-day"></i>Daylight</li></ul>`;
  const url = location.href.split('#')[0];

  sheet.innerHTML = `
    <header class="ps-head">
      <div><h1>${esc(from)} → ${esc(to)}</h1></div>
      <div class="ps-brand">Jet lag plan · Meridian<br>printed ${fD(s.home.tz, Date.now())}</div>
    </header>
    <ul class="ps-flights"><li>Outbound: ${leg(out)}</li>${ret ? `<li>Return: ${leg(ret)}</li>` : ''}</ul>
    <dl class="ps-facts">
      <div><dt>Time difference</dt><dd>${raw > 0 ? '+' : raw < 0 ? '−' : ''}${fHours(raw)}</dd></div>
      <div><dt>Body-clock shift</dt><dd>${shift}</dd></div>
      <div><dt>Strategy</dt><dd>${strategy}</dd></div>
      <div><dt>Adjusted by</dt><dd>${adjusted}</dd></div>
    </dl>
    <ul class="ps-rules">${rules.map((r) => `<li>${r}</li>`).join('')}</ul>
    <h2 class="ps-section">Outbound: ${esc(from)} → ${esc(to)} <small>times are on the local clock shown for each day</small></h2>
    ${legend}
    <div class="timeline">${timelineHTML(out, { print: true })}</div>
    ${ret ? `<section class="ps-leg"><h2 class="ps-section">Return: ${esc(to)} → ${esc(from)}</h2><div class="timeline">${timelineHTML(ret, { print: true })}</div></section>` : ''}
    <p class="ps-foot">Full plan with reasons and tips: <a href="${esc(url)}">${esc(url)}</a><br>General guidance, not medical advice. Melatonin is a supplement and not FDA-regulated.</p>`;
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
  els.form.addEventListener('submit', (e) => { e.preventDefault(); build(); });
  $('#example-btn').addEventListener('click', fillExample);
  $('#share-btn').addEventListener('click', share);
  $('#ics-btn').addEventListener('click', downloadIcs);
  $('#print-btn').addEventListener('click', () => { fillPrintSheet(); window.print(); });
  addEventListener('beforeprint', fillPrintSheet);
  // hovering a time in the list highlights its block on the bar (and vice versa)
  const hl = (k, on) => $$(`#timeline [data-k="${k}"]`).forEach((n) => n.classList.toggle('hl', on));
  $('#timeline').addEventListener('pointerover', (e) => { const n = e.target.closest('[data-k]'); if (n) hl(n.dataset.k, true); });
  $('#timeline').addEventListener('pointerout', (e) => { const n = e.target.closest('[data-k]'); if (n) hl(n.dataset.k, false); });
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

