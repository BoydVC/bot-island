'use strict';
/* Bot Island: a living map of Boyd's Grok Bot fleet. Inspired by @poteto's bot island.
   Map art is an original homage to Into the Breach's aesthetic (Subset Games):
   tactical pixel grid, fortified hangars, mech units. No game assets. */
const TZ = 'America/New_York';
const W = 1200, H = 760;             // logical world size
const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
let DOC = null, docFilter = 'all';

// ---------- time helpers (all island time is Eastern) ----------
const fmtParts = new Intl.DateTimeFormat('en-US', {timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'});
function etParts(ms) {
  const o = {};
  for (const p of fmtParts.formatToParts(new Date(ms))) o[p.type] = p.value;
  const wd = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6}[o.weekday];
  return {y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd};
}
function tzOffset(ms) { const p = etParts(ms); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; }
function etToMs(y, mo, d, h = 0, mi = 0) { const guess = Date.UTC(y, mo - 1, d, h, mi); let ms = guess - tzOffset(guess); ms = guess - tzOffset(ms); return ms; }
function etDayStart(ms) { const p = etParts(ms); return etToMs(p.y, p.mo, p.d); }
function etDayKey(ms) { const p = etParts(ms); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
function hm(ms, secs) { const p = etParts(ms); const h12 = (p.h % 12) || 12; return `${h12}:${String(p.mi).padStart(2, '0')}${secs ? ':' + String(p.s).padStart(2, '0') : ''} ${p.h < 12 ? 'AM' : 'PM'}`; }
function dayLabel(ms) { return new Date(ms).toLocaleDateString('en-US', {timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric'}); }
function dur(ms) { ms = Math.max(0, ms); const h = Math.floor(ms / HOUR), m = Math.floor(ms % HOUR / MIN); return h ? `${h}h ${m}m` : `${m}m`; }
function ago(ms) { if (ms < MIN) return 'just now'; if (ms < HOUR) return `${Math.round(ms / MIN)}m ago`; if (ms < DAY) return `${Math.round(ms / HOUR)}h ago`; return `${Math.round(ms / DAY)}d ago`; }

// ---------- cron (m h dom mon dow) ----------
function cronField(f, lo, hi) {
  const out = new Set();
  for (const part of String(f).split(',')) {
    let [rng, step] = part.split('/'); step = +step || 1;
    let a = lo, b = hi;
    if (rng !== '*') { [a, b] = rng.split('-').map(Number); if (b === undefined || isNaN(b)) b = step > 1 ? hi : a; }
    for (let v = a; v <= b; v += step) out.add(v === 7 && hi === 6 ? 0 : v);
  }
  return out;
}
function cronFires(cron, dayStartMs) {
  if (!cron) return [];
  const f = cron.trim().split(/\s+/); if (f.length < 5) return [];
  const p = etParts(dayStartMs + 12 * HOUR);
  const mins = cronField(f[0], 0, 59), hrs = cronField(f[1], 0, 23), dom = cronField(f[2], 1, 31), mon = cronField(f[3], 1, 12), dow = cronField(f[4], 0, 6);
  if (!mon.has(p.mo)) return [];
  const domStar = f[2] === '*', dowStar = f[4] === '*';
  const dayOk = (domStar && dowStar) ? true : domStar ? dow.has(p.wd) : dowStar ? dom.has(p.d) : (dom.has(p.d) || dow.has(p.wd));
  if (!dayOk) return [];
  const out = [];
  for (const h of [...hrs].sort((a, b) => a - b)) for (const m of [...mins].sort((a, b) => a - b)) out.push(etToMs(p.y, p.mo, p.d, h, m));
  return out;
}
function cronHuman(cron) {
  if (!cron) return 'on demand';
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  const times = String(h).split(',').map(x => { const hh = +x; return `${(hh % 12) || 12}:${String(m).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; }).join(' & ');
  const days = dow === '*' ? 'Daily' : dow === '1-5' ? 'Weekdays' : dow === '0,6' || dow === '6,0' ? 'Weekends' : String(dow).split(',').map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][+d % 7] || d).join('/');
  return `${days} ${times}${dom !== '*' ? ` (day ${dom})` : ''}`;
}

// ---------- island geography ----------
const BUILDINGS = {
  hq:          {x: 600, y: 236, name: 'Chief of Staff HQ', emoji: '🏛️'},
  library:     {x: 420, y: 290, name: 'Research Library', emoji: '📚'},
  observatory: {x: 300, y: 205, name: 'Trend Observatory', emoji: '🔭'},
  bank:        {x: 790, y: 292, name: 'Island Bank', emoji: '🏦'},
  clubhouse:   {x: 860, y: 438, name: 'Family Clubhouse', emoji: '🏡'},
  school:      {x: 330, y: 432, name: 'Schoolhouse', emoji: '🏫'},
  press:       {x: 470, y: 560, name: 'Family Times Press', emoji: '📰'},
  radio:       {x: 735, y: 562, name: 'Pods Radio Tower', emoji: '📻'},
  postoffice:  {x: 600, y: 600, name: 'Morning Post Office', emoji: '📮'},
  workshop:    {x: 965, y: 318, name: "Dwight's Workshop", emoji: '🛠️'},
  hatchery:    {x: 205, y: 330, name: 'EggBot Hatchery', emoji: '🥚'},
  lighthouse:  {x: 1058, y: 470, name: 'Idea Lighthouse', emoji: '💡'},
  launchpad:   {x: 905, y: 168, name: 'TokenMax Launch Pad', emoji: '🚀'},
  stadium:     {x: 190, y: 540, name: 'Purple Stadium', emoji: '🏟️', decor: true},
  commons:     {x: 600, y: 420, name: 'Town Square', emoji: '⛲'},
};
const PLAZA = {x: 600, y: 420};
const COLORS = {blue: '#3b82f6', red: '#ef4444', green: '#22c55e', yellow: '#eab308', gray: '#94a3b8', orange: '#f97316', cyan: '#06b6d4', violet: '#8b5cf6', magenta: '#d946ef', purple: '#8b5cf6', pink: '#ec4899', teal: '#14b8a6'};
const EMOJI = {Michael: '🧭', Jim: '📚', Kelly: '📈', Oscar: '💰', Pam: '📅', 'Char Tutor': '✏️', 'Vic Tutor': '📐', Path: '🎓', 'Boyd Family Times': '📰', 'Boyd Family Times (archive)': '🗞️', Pods: '🎧', Brief: '☕', Dwight: '🧑‍💻', 'Dr. EggBot': '🥚', Ryan: '💡', TokenMax: '🚀'};
function rng(seed) { let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function islandRadius(a) { return 1 + 0.06 * Math.sin(a * 3 + 0.7) + 0.045 * Math.sin(a * 5 + 2.1) + 0.03 * Math.sin(a * 9 + 1.3); }
const ISLE = {cx: 600, cy: 395, rx: 545, ry: 330};
function islePoint(a, k) { const r = islandRadius(a) * k; return {x: ISLE.cx + Math.cos(a) * ISLE.rx * r, y: ISLE.cy + Math.sin(a) * ISLE.ry * r}; }

// ---------- state ----------
const S = {
  data: null, bots: [], byId: {}, mode: 'live', speed: 1, playing: true,
  t: Date.now(), replayDay: null, selected: null, hover: null,
  sessionsCache: {}, ticker: [], planes: [], pings: [], lastTickerT: 0, eventsByBot: {}, allEvents: [],
};
const cv = document.getElementById('island'), ctx = cv.getContext('2d');
const tl = document.getElementById('timeline'), tctx = tl.getContext('2d');
let view = {s: 1, ox: 0, oy: 0};
const cam = {z: 1, x: 0, y: 0};

async function load() {
  if (window.BOT_ISLAND_SNAPSHOT) { if (!S.data) ingest(window.BOT_ISLAND_SNAPSHOT); return; }
  const r = await fetch('/api/fleet', {cache: 'no-store'});
  if (!r.ok) throw new Error('fleet ' + r.status);
  ingest(await r.json());
}
function ingest(data) {
  S.data = data;
  const prev = S.byId;
  S.bots = data.bots.map((b, i) => {
    const old = prev[b.id];
    const bot = Object.assign({}, b, {
      emoji: EMOJI[b.name] || '🤖', hex: COLORS[b.color] || '#94a3b8',
      x: old ? old.x : 0, y: old ? old.y : 0, tx: 0, ty: 0, state: old ? old.state : 'sleep', what: '',
      wander: old ? old.wander : null, phase: Math.random() * 6.28, rand: rng(b.id),
    });
    return bot;
  });
  // houses around the rim
  const n = S.bots.length;
  const order = [...S.bots].sort((a, b) => a.name.localeCompare(b.name));
  order.forEach((b, i) => {
    const a = -Math.PI / 2 + (i + 0.5) * (2 * Math.PI / n) + 0.12;
    const p = islePoint(a, 0.8);
    b.home = {x: p.x, y: p.y, a};
    const bl = BUILDINGS[b.building] || BUILDINGS.commons;
    b.work = bl;
    if (!prev[b.id]) { b.x = p.x; b.y = p.y + 6; }
  });
  S.byId = Object.fromEntries(S.bots.map(b => [b.id, b]));
  S.eventsByBot = {};
  S.allEvents = data.events.map(e => Object.assign({}, e, {t: Date.parse(e.ts)})).filter(e => !isNaN(e.t));
  for (const e of S.allEvents) (S.eventsByBot[e.bot] ||= []).push(e);
  S.sessionsCache = {};
  buildDaySelect();
  renderRoster(true);
}

// ---------- sessions: when is each bot working? ----------
function clusterEvents(evts, gap = 6 * MIN) {
  const out = []; let cur = null;
  for (const e of evts) {
    if (cur && e.t - cur.last <= gap) { cur.last = e.t; cur.events.push(e); }
    else { cur = {first: e.t, last: e.t, events: [e]}; out.push(cur); }
  }
  return out.map(c => ({start: c.first - 1.5 * MIN, end: c.last + 2.5 * MIN, kind: 'actual', events: c.events, label: summarizeCluster(c.events)}));
}
function summarizeCluster(evts) {
  const cnt = {};
  for (const e of evts) cnt[e.app] = (cnt[e.app] || 0) + 1;
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}×${v}`).join(' · ');
}
function sessionsFor(bot, dayStart) {
  const key = `${S.mode}|${bot.id}|${dayStart}`;
  if (S.sessionsCache[key]) return S.sessionsCache[key];
  const dayEnd = dayStart + DAY, out = [];
  const evts = (S.eventsByBot[bot.id] || []).filter(e => e.t >= dayStart && e.t < dayEnd);
  out.push(...clusterEvents(evts));
  for (const r of bot.routines || []) {
    for (const run of r.runs || []) {
      const s = Date.parse(run.start), e = run.end ? Date.parse(run.end) : s + 5 * MIN;
      if (s >= dayStart && s < dayEnd) out.push({start: s, end: Math.max(e, s + 3 * MIN), kind: 'run', label: r.name, status: run.status});
    }
  }
  if (S.mode === 'live') {
    const isToday = dayStart === etDayStart(Date.now());
    for (const r of bot.routines || []) {
      if (r.enabled === false) continue;
      const len = Math.max(4, Math.min(30, r.medianMinutes || 5)) * MIN;
      for (const f of cronFires(r.cron, dayStart)) {
        if (out.some(o => o.kind === 'run' && Math.abs(o.start - f) < 45 * MIN)) continue;
        out.push({start: f, end: f + len, kind: 'scheduled', label: r.name, cron: r.cron});
      }
    }
    for (const rh of bot.observedRhythm || []) {
      const f = etToMs(...ymd(dayStart), rh.hour, rh.minute);
      if (out.some(o => Math.abs(o.start - f) < 50 * MIN)) continue;
      out.push({start: f, end: f + 8 * MIN, kind: 'observed', label: `usual shift (seen ${rh.days} of last days)`});
    }
    void isToday;
  }
  out.sort((a, b) => a.start - b.start);
  S.sessionsCache[key] = out;
  return out;
}
function ymd(ms) { const p = etParts(ms + 12 * HOUR); return [p.y, p.mo, p.d]; }
function nextScheduled(bot, from) {
  let best = null;
  for (let k = 0; k < 8 && !best; k++) {
    const ds = etDayStart(from) + k * DAY + 2 * HOUR; const d0 = etDayStart(ds);
    for (const r of bot.routines || []) {
      if (r.enabled === false) continue;
      for (const f of cronFires(r.cron, d0)) if (f > from && (!best || f < best.t)) best = {t: f, label: r.name};
    }
    for (const rh of bot.observedRhythm || []) {
      const f = etToMs(...ymd(d0), rh.hour, rh.minute);
      if (f > from && (!best || f < best.t)) best = {t: f, label: 'usual shift'};
    }
  }
  return best;
}

// ---------- per-frame bot state ----------
const APP_ICON = {Calendar: '📅', Gmail: '📧', 'Gmail (Miranda)': '📧', Slack: '💬', Notion: '📝', Drive: '📁', X: '𝕏', Composio: '🔌', Finance: '💵'};
function eventLabel(e) {
  if (!e) return '';
  if (e.type === 'mcp_tool_call') return `${APP_ICON[e.app] || '🧰'} ${e.app} · ${prettyTool(e.tool)}`;
  if (e.type === 'browser_navigation') return `🌐 Browsing ${(e.host || 'the web').replace(/^www\./, '')}`;
  if (e.type === 'file_write') return `📄 Writing ${e.ext ? e.ext.slice(1) + ' ' : ''}files`;
  if (e.type === 'computer_use_session') return '🖱️ Driving the desktop';
  if (e.type === 'dated_output') return `🗞️ ${e.tool} (time approx.)`;
  if (e.type === 'routine_touch') return `⏰ Ran “${e.tool}”`;
  if (e.type === 'agent_msg') { const f = S.byId[e.from]; return `✉️ Message from ${f ? f.name : 'another bot'}`; }
  if (e.type === 'boyd_msg') return '📱 Chatting with Boyd';
  if (e.type === 'shell_command') return e.app === 'Shell' ? '💻 Running shell commands' : "🖥️ Working on Boyd's PC";
  return e.app || e.type;
}
function prettyTool(t) { return (t || '').replace(/^notion-|^slack_|^COMPOSIO_/, '').replace(/[_-]+/g, ' '); }
function updateBots(t, dtReal) {
  const ds = etDayStart(t), p = etParts(t);
  const game = currentGame(t);
  const night = (p.h >= 22 || p.h < 6) && !game;
  S.game = game;
  for (const b of S.bots) {
    const ss = sessionsFor(b, ds);
    const cur = ss.find(s => t >= s.start && t <= s.end);
    let state, what = '';
    if (cur) {
      state = 'work';
      if (cur.kind === 'actual') {
        let last = null; for (const e of cur.events) { if (e.t <= t + 30e3) last = e; else break; }
        what = eventLabel(last || cur.events[0]);
      } else what = cur.label + (cur.kind === 'scheduled' ? ' (scheduled)' : '');
      b.tx = b.work.x + (b.rand() - 0.5) * 0.0 + workOffset(b).x; b.ty = b.work.y + workOffset(b).y;
      b.curSession = cur;
    } else if (night) {
      state = 'sleep'; what = 'Asleep'; b.tx = b.home.x; b.ty = b.home.y + 4; b.curSession = null;
    } else if (game) {
      state = 'idle'; b.curSession = null;
      const seat = stadiumSeat(b); b.tx = seat.x; b.ty = seat.y; what = `📣 Watching ${game.label}`;
    } else {
      state = 'idle'; b.curSession = null;
      if (!b.wander || t > b.wander.until || Math.abs(t - b.wander.at) > 6 * HOUR) b.wander = pickWander(b, t);
      b.tx = b.wander.x; b.ty = b.wander.y; what = b.wander.label;
    }
    if (state !== b.state && b.state) b.changed = performance.now();
    b.state = state; b.what = what;
    // movement in real time
    const dx = b.tx - b.x, dy = b.ty - b.y, dist = Math.hypot(dx, dy);
    const sp = (70 + Math.min(S.speed, 1800) / 3) * dtReal;
    if (dist > 0.5) { const k = Math.min(1, sp / dist); b.x += dx * k; b.y += dy * k; b.moving = dist > 2; b.dir = dx < 0 ? -1 : 1; }
    else b.moving = false;
  }
}
function workOffset(b) {
  const mates = S.bots.filter(o => o.building === b.building);
  const i = mates.indexOf(b), n = mates.length;
  if (n <= 1) return {x: 0, y: 34};
  return {x: (i - (n - 1) / 2) * 24, y: 34};
}
const HANGOUTS = [
  {x: 600, y: 430, label: 'Hanging at the fountain'}, {x: 640, y: 455, label: 'People-watching in the square'},
  {x: 560, y: 465, label: 'Grabbing a coffee'}, {x: 190, y: 585, label: 'Catching a Ravens game'},
  {x: 1050, y: 560, label: 'Walking the beach'}, {x: 700, y: 670, label: 'Skipping stones'},
  {x: 245, y: 255, label: 'Stargazing at the observatory'}, {x: 860, y: 225, label: 'Admiring the rocket'},
  {x: 500, y: 380, label: 'Reading in the park'}, {x: 760, y: 380, label: 'Stretching its servos'},
];
function pickWander(b, t) {
  const r = b.rand();
  const h = r < 0.35 ? {x: b.home.x + (b.rand() - 0.5) * 40, y: b.home.y + 26, label: 'Puttering around home'} : HANGOUTS[Math.floor(b.rand() * HANGOUTS.length)];
  return {x: h.x + (b.rand() - 0.5) * 70, y: h.y + (b.rand() - 0.5) * 36, label: h.label, at: t, until: t + (20 + b.rand() * 50) * MIN};
}

// ---------- rendering ----------
let terrain = null, trees = [], stars = [];
function buildTerrain() {
  const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const g = c.getContext('2d'); g.scale(2, 2); g.imageSmoothingEnabled = false;
  const blob = (k) => { g.beginPath(); for (let i = 0; i <= 180; i++) { const a = i / 180 * Math.PI * 2; const p = islePoint(a, k); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); } g.closePath(); };
  // slate berm, then the olive tactical field
  blob(1.0); g.fillStyle = '#6a6558'; g.fill();
  blob(0.955); g.fillStyle = '#3e4a34'; g.fill();
  g.save(); blob(0.955); g.clip();
  const TILE = 24, r = rng('grid');
  for (let y = 0; y < H; y += TILE) for (let x = 0; x < W; x += TILE) {
    const n = r();
    g.fillStyle = n < 0.14 ? '#5c6848' : n < 0.26 ? '#465438' : n < 0.36 ? '#5a5344' : '#52643e';
    g.fillRect(x, y, TILE - 1, TILE - 1);
  }
  g.strokeStyle = 'rgba(16,22,14,.55)'; g.lineWidth = 1; g.beginPath();
  for (let x = 0; x <= W; x += TILE) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
  for (let y = 0; y <= H; y += TILE) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
  g.stroke();
  // reinforced lanes between the command pad and each hangar
  g.lineCap = 'butt'; g.lineJoin = 'miter';
  const pathTo = (b) => { g.beginPath(); g.moveTo(PLAZA.x, PLAZA.y); g.lineTo(b.x, PLAZA.y); g.lineTo(b.x, b.y + 16); g.stroke(); };
  g.lineWidth = 10; g.strokeStyle = '#343c30';
  for (const [k, b] of Object.entries(BUILDINGS)) if (k !== 'commons') pathTo(b);
  g.lineWidth = 1; g.strokeStyle = 'rgba(230,179,37,.55)';
  for (const [k, b] of Object.entries(BUILDINGS)) if (k !== 'commons') pathTo(b);
  g.lineWidth = 8; g.strokeStyle = '#343c30'; g.beginPath();
  for (let i = 0; i <= 160; i++) { const a = i / 160 * Math.PI * 2; const p = islePoint(a, 0.8); const q = {x: p.x, y: p.y + 18}; i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); }
  g.stroke();
  const px0 = Math.round(PLAZA.x / TILE) * TILE, py0 = Math.round(PLAZA.y / TILE) * TILE;
  g.fillStyle = '#2e362c'; g.fillRect(px0 - TILE * 2, py0 - TILE, TILE * 4, TILE * 2);
  g.strokeStyle = '#e6b325'; g.lineWidth = 2; g.strokeRect(px0 - TILE * 2 + 3, py0 - TILE + 3, TILE * 4 - 6, TILE * 2 - 6);
  g.fillStyle = '#3ec6d6'; g.fillRect(px0 - 3, py0 + 6, 6, 6);
  g.restore();
  terrain = c;
  // trees
  trees = []; const tr = rng('trees');
  const blockers = () => [...Object.values(BUILDINGS).map(b => ({x: b.x, y: b.y, r: b === BUILDINGS.stadium ? 90 : 62})), ...S.bots.map(b => ({x: b.home.x, y: b.home.y, r: 40})), {x: PLAZA.x, y: PLAZA.y, r: 100}];
  const bl = blockers();
  for (let i = 0; i < 900 && trees.length < 95; i++) {
    const a = tr() * Math.PI * 2, k = Math.sqrt(tr()) * 0.95;
    const p = islePoint(a, k);
    if (bl.some(o => Math.hypot(o.x - p.x, (o.y - p.y) * 1.3) < o.r)) continue;
    if (trees.some(o => Math.hypot(o.x - p.x, o.y - p.y) < 22)) continue;
    trees.push({x: p.x, y: p.y, s: 0.75 + tr() * 0.6, palm: k > 0.86, hue: tr()});
  }
  stars = []; const st = rng('stars'); for (let i = 0; i < 220; i++) stars.push({x: st() * W, y: st() * H, r: st() * 1.3 + .3, tw: st() * 6});
}

function darkness(t) {
  const p = etParts(t); const h = p.h + p.mi / 60;
  const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  return Math.max(1 - sm(6.0, 7.8, h), sm(17.8, 19.8, h));
}
/** Sky phase for HUD + richer day/night: dawn | day | dusk | night */
function skyPhase(t) {
  const p = etParts(t); const h = p.h + p.mi / 60;
  if (h >= 5.5 && h < 7.5) return 'dawn';
  if (h >= 7.5 && h < 17.5) return 'day';
  if (h >= 17.5 && h < 20.0) return 'dusk';
  return 'night';
}
function skyLabel(phase) {
  return ({dawn: 'DAWN', day: 'DAY', dusk: 'DUSK', night: 'NIGHT'})[phase] || phase;
}

function drawWater(now, dk) {
  const phase = skyPhase(S.t);
  const p = etParts(S.t); const h = p.h + p.mi / 60;
  const sky = ctx.createLinearGradient(0, -80, 0, H * 0.55);
  if (phase === 'dawn') {
    sky.addColorStop(0, '#1a242c');
    sky.addColorStop(0.55, '#3a4034');
    sky.addColorStop(1, '#6a5530');
  } else if (phase === 'dusk') {
    sky.addColorStop(0, '#141c22');
    sky.addColorStop(0.5, '#2a342c');
    sky.addColorStop(1, '#5a4630');
  } else if (phase === 'night') {
    sky.addColorStop(0, '#070c10'); sky.addColorStop(0.55, '#0c1418'); sky.addColorStop(1, '#10181c');
  } else {
    sky.addColorStop(0, '#6e8c90'); sky.addColorStop(0.55, '#4e6e72'); sky.addColorStop(1, '#2a4548');
  }
  ctx.fillStyle = sky; ctx.fillRect(-400, -400, W + 800, H + 800);
  const g = ctx.createLinearGradient(0, H * 0.35, 0, H + 200);
  g.addColorStop(0, mix('#1a4a50', '#071216', dk)); g.addColorStop(1, mix('#0e3034', '#050a0c', dk));
  ctx.fillStyle = g; ctx.fillRect(-400, H * 0.28, W + 800, H + 400);
  const dayAng = ((h - 6) / 12) * Math.PI;
  const sunX = W * 0.5 + Math.cos(Math.PI - dayAng) * 420;
  const sunY = 90 + Math.sin(Math.PI - Math.min(Math.PI, Math.max(0, dayAng))) * 160;
  if (phase === 'day' || phase === 'dawn' || phase === 'dusk') {
    ctx.fillStyle = phase === 'day' ? '#f0d48a' : '#e6b325';
    ctx.fillRect(sunX - 6, sunY - 6, 12, 12);
    ctx.fillStyle = 'rgba(230,179,37,.18)';
    ctx.fillRect(sunX - 14, sunY - 2, 28, 4);
    ctx.fillRect(sunX - 2, sunY - 14, 4, 28);
  }
  if (phase === 'night' || phase === 'dusk') {
    const moonX = W * 0.72, moonY = 70 + (1 - dk) * 40;
    ctx.fillStyle = `rgba(214,222,216,${0.45 + dk * 0.4})`;
    ctx.fillRect(moonX - 7, moonY - 7, 14, 14);
    ctx.fillStyle = phase === 'night' ? '#070c10' : '#141c22';
    ctx.fillRect(moonX - 1, moonY - 8, 10, 12);
  }
  if (dk > 0.25) for (const s of stars) {
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(now / 700 + s.tw));
    ctx.globalAlpha = (dk - .2) * tw;
    ctx.fillStyle = '#e7f0ea';
    ctx.fillRect(s.x, s.y, s.r > 1.1 ? 2 : 1, s.r > 1.1 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
  if (phase === 'dawn' || phase === 'dusk') {
    ctx.fillStyle = 'rgba(230,179,37,0.08)';
    ctx.fillRect(-400, 0, W + 800, 160);
  }
  ctx.strokeStyle = `rgba(62,198,214,${0.22 - dk * 0.1})`; ctx.lineWidth = 1;
  for (let ring = 0; ring < 3; ring++) {
    const k = 1.08 + ring * 0.06 + 0.008 * Math.sin(now / 900 + ring * 2);
    ctx.setLineDash([6, 10]); ctx.lineDashOffset = -now / 80 * (ring % 2 ? 1 : -1);
    ctx.beginPath(); for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; const pt = islePoint(a, k); i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y); } ctx.stroke();
  }
  ctx.setLineDash([]);
}
function mix(a, b, k) { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = (s) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k); return `rgb(${c(16)},${c(8)},${c(0)})`; }
function shade(hex, k) { const p = parseInt(hex.slice(1), 16); const f = (s) => Math.max(0, Math.min(255, Math.round(((p >> s) & 255) * k))); return `rgb(${f(16)},${f(8)},${f(0)})`; }

function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function shadow(x, y, w, h) { ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fillRect(x - w * 0.45, y, w, Math.max(3, h * 0.35)); }
function box(x, y, w, h, wall, roof) {
  shadow(x, y + 2, w * 0.7, 8);
  ctx.fillStyle = '#232824'; ctx.fillRect(x - w / 2 - 2, y - 4, w + 4, 4);
  ctx.fillStyle = wall; ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = shade(typeof wall === 'string' && wall[0] === '#' ? wall : '#5c6a58', 0.72);
  ctx.fillRect(x + w / 2 - 4, y - h, 4, h);
  ctx.fillStyle = roof; ctx.fillRect(x - w / 2 - 4, y - h - 8, w + 8, 9);
  ctx.fillStyle = '#e6b325';
  for (let i = 0; i < w + 8; i += 8) ctx.fillRect(x - w / 2 - 4 + i, y - h - 6, 4, 3);
  ctx.fillStyle = '#d7e2dc';
  ctx.fillRect(x - w / 2 + 2, y - h + 2, 2, 2);
  ctx.fillRect(x + w / 2 - 4, y - h + 2, 2, 2);
}
function windows(x, y, w, h, rows, cols, lit, seed) {
  const r = rng(seed);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const wx = x - w / 2 + 5 + j * ((w - 8) / cols), wy = y - h + 8 + i * Math.max(8, (h - 14) / rows);
    const on = lit && r() > 0.22;
    ctx.fillStyle = on ? '#e6b325' : '#141c1e';
    ctx.fillRect(wx, wy, 5, 3);
  }
}
function flag(x, y, color, now, c2) {
  ctx.fillStyle = '#2a3128'; ctx.fillRect(x, y - 20, 2, 20);
  const wv = Math.round(Math.sin(now / 320 + x));
  ctx.fillStyle = color; ctx.fillRect(x + 2, y - 18 + wv, 11, 6);
  if (c2) { ctx.fillStyle = c2; ctx.fillRect(x + 2, y - 16 + wv, 11, 2); }
}

function drawBuilding(key, b, now, lit, busy) {
  const {x, y} = b;
  ctx.save();
  const markBusy = () => { if (!busy) return; ctx.strokeStyle = '#3ec6d6'; ctx.lineWidth = 1; ctx.strokeRect(x - 8, y - 4, 16, 3); };
  switch (key) {
    case 'hq':
      box(x, y, 58, 52, '#6a7364', '#2c3834');
      windows(x, y, 58, 52, 3, 4, lit || busy, 'hq');
      ctx.fillStyle = '#141c1e'; ctx.fillRect(x - 7, y - 16, 14, 16);
      ctx.fillStyle = '#e6b325'; ctx.fillRect(x - 8, y - 62, 16, 4);
      flag(x - 22, y - 60, '#f97316', now, '#111'); flag(x + 10, y - 62, '#4c1d95', now, '#facc15');
      markBusy();
      break;
    case 'library':
      box(x, y, 78, 36, '#5c6858', '#24302e');
      for (let i = 0; i < 5; i++) { ctx.fillStyle = '#d7e2dc'; ctx.fillRect(x - 32 + i * 14, y - 30, 3, 26); }
      windows(x, y - 2, 78, 34, 1, 4, lit, 'lib');
      break;
    case 'observatory':
      box(x, y, 46, 26, '#5a6460', '#2a3438');
      ctx.fillStyle = '#8aa399';
      for (let i = -16; i <= 16; i++) { const yy = Math.round(Math.sqrt(Math.max(0, 256 - i * i)) * 0.7); ctx.fillRect(x + i, y - 26 - yy, 1, yy); }
      ctx.save(); ctx.translate(x, y - 40); ctx.rotate(-0.5 + Math.sin(now / 4000) * 0.25);
      ctx.fillStyle = '#1c2428'; ctx.fillRect(-2, -18, 4, 16); ctx.fillStyle = '#3ec6d6'; ctx.fillRect(-3, -20, 6, 3); ctx.restore();
      windows(x, y, 46, 26, 1, 2, lit, 'obs');
      break;
    case 'bank':
      box(x, y, 74, 40, '#687064', '#1e3330');
      for (let i = 0; i < 4; i++) { ctx.fillStyle = '#c5d0c8'; ctx.fillRect(x - 28 + i * 16, y - 36, 4, 32); }
      ctx.fillStyle = '#e6b325'; ctx.font = 'bold 12px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.fillText('$', x, y - 44);
      break;
    case 'clubhouse':
      box(x, y, 64, 32, '#6a6248', '#243028');
      ctx.fillStyle = '#3a342c'; ctx.fillRect(x + 16, y - 48, 6, 12);
      if (lit) smoke(x + 19, y - 50, now, '#8aa399', 3);
      windows(x, y, 64, 32, 1, 3, lit, 'club');
      flag(x - 28, y - 32, '#1d4ed8', now, '#fff');
      break;
    case 'school':
      box(x, y, 70, 34, '#5c5048', '#2c2824');
      ctx.fillStyle = '#e7f0ea'; ctx.fillRect(x - 5, y - 52, 10, 12);
      ctx.fillStyle = '#2c2824'; ctx.fillRect(x - 7, y - 56, 14, 5);
      ctx.fillStyle = '#e6b325'; ctx.fillRect(x - 2, y - 46, 4, 4);
      windows(x, y, 70, 34, 1, 4, lit, 'sch');
      break;
    case 'press':
      box(x, y, 72, 34, '#5a5344', '#2a2824');
      ctx.fillStyle = '#3a3834'; ctx.fillRect(x + 18, y - 56, 8, 20);
      if (busy) smoke(x + 22, y - 58, now, '#8aa399', 5);
      ctx.fillStyle = '#e7f0ea'; ctx.fillRect(x - 30, y - 24, 22, 14);
      ctx.fillStyle = '#141c1e'; for (let i = 0; i < 4; i++) ctx.fillRect(x - 28, y - 22 + i * 3, 18 - (i % 2) * 4, 1);
      windows(x + 12, y, 36, 34, 1, 2, lit, 'pr');
      break;
    case 'radio': {
      shadow(x, y + 2, 20, 6);
      ctx.strokeStyle = '#8aa399'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x, y - 84); ctx.lineTo(x + 14, y); ctx.stroke();
      for (let i = 1; i < 6; i++) { const yy = y - i * 14, w = 14 * (1 - i * 14 / 84); ctx.beginPath(); ctx.moveTo(x - w, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
      ctx.fillStyle = (Math.floor(now / 500) % 2) ? '#e6b325' : '#3a3420'; ctx.fillRect(x - 2, y - 88, 4, 4);
      if (busy) { ctx.strokeStyle = 'rgba(62,198,214,.8)'; for (let k = 0; k < 3; k++) { const rr2 = ((now / 18 + k * 18) % 48); ctx.globalAlpha = 1 - rr2 / 48; ctx.strokeRect(x - rr2 / 2, y - 86 - rr2 / 4, rr2, rr2 / 2); } ctx.globalAlpha = 1; }
      box(x + 28, y, 24, 16, '#5c6858', '#24302c');
      break; }
    case 'postoffice':
      box(x, y, 54, 28, '#5a6860', '#1e3040');
      ctx.fillStyle = '#1a3038'; ctx.fillRect(x - 20, y - 14, 10, 14);
      ctx.fillStyle = '#e6b325'; ctx.fillRect(x - 18, y - 16, 6, 3);
      windows(x + 8, y, 30, 28, 1, 2, lit, 'po');
      break;
    case 'workshop':
      box(x, y, 62, 32, '#5a5854', '#3a3420');
      ctx.save(); ctx.translate(x + 16, y - 48); ctx.rotate(now / (busy ? 280 : 1800)); ctx.fillStyle = '#2a2824';
      for (let i = 0; i < 8; i++) { ctx.rotate(Math.PI / 4); ctx.fillRect(-1, -9, 3, 5); }
      ctx.fillRect(-5, -5, 10, 10); ctx.fillStyle = '#e6b325'; ctx.fillRect(-2, -2, 4, 4); ctx.restore();
      ctx.fillStyle = '#141c1e'; ctx.fillRect(x - 22, y - 18, 18, 18);
      if (busy && Math.floor(now / 140) % 3 === 0) { ctx.fillStyle = '#e6b325'; ctx.fillRect(x - 16, y - 12, 2, 2); ctx.fillRect(x - 10, y - 8, 2, 2); }
      break;
    case 'hatchery': {
      box(x, y, 70, 22, '#4e5c58', '#1a3034');
      const eggs = 1 + (S.data?.eggs?.length || 0) + 2;
      for (let i = 0; i < eggs; i++) {
        const ex = x - 24 + i * (48 / Math.max(1, eggs - 1));
        const bob = busy ? Math.round(Math.sin(now / 160 + i) * 2) : 0;
        ctx.fillStyle = '#143238'; ctx.fillRect(ex - 5, y - 28 + bob, 10, 12);
        ctx.fillStyle = '#3ec6d6'; ctx.fillRect(ex - 3, y - 26 + bob, 6, 3);
        ctx.fillStyle = '#e6b325'; ctx.fillRect(ex - 1, y - 22 + bob, 2, 2);
      }
      break; }
    case 'lighthouse': {
      shadow(x, y + 2, 16, 5);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i % 2 ? '#1a2c34' : '#e6b325';
        const w0 = 12 - i;
        ctx.fillRect(x - w0, y - (i + 1) * 14, w0 * 2, 14);
      }
      ctx.fillStyle = (Math.floor(now / 700) % 2 && lit) ? '#3ec6d6' : '#f0d48a';
      ctx.fillRect(x - 5, y - 78, 10, 8);
      ctx.fillStyle = '#141c1e'; ctx.fillRect(x - 7, y - 82, 14, 4);
      break; }
    case 'launchpad': drawRocket(x, y, now, busy); break;
    case 'stadium': {
      shadow(x, y + 4, 80, 12);
      ctx.fillStyle = '#2e362c'; ctx.beginPath(); ctx.ellipse(x, y - 8, 74, 36, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#3e4a34'; ctx.beginPath(); ctx.ellipse(x, y - 10, 64, 28, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#4e5c3c'; ctx.beginPath(); ctx.ellipse(x, y - 10, 46, 18, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(230,179,37,.7)'; ctx.lineWidth = 1;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(x + i * 12, y - 26); ctx.lineTo(x + i * 12, y + 4); ctx.stroke(); }
      ctx.fillStyle = '#e6b325'; ctx.font = 'bold 9px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.fillText('BAL', x - 40, y - 8); ctx.fillText('BAL', x + 40, y - 8);
      flag(x - 58, y - 30, '#4c1d95', now, '#facc15'); flag(x + 48, y - 30, '#f97316', now, '#111'); flag(x - 8, y - 42, '#034694', now, '#fff'); flag(x + 16, y - 42, '#e21833', now, '#ffd200');
      if (S.game) { ctx.fillStyle = '#10181c'; ctx.fillRect(x - 46, y - 70, 92, 16); ctx.fillStyle = '#e6b325'; ctx.font = 'bold 9px ui-monospace,monospace'; ctx.fillText(S.game.label.slice(0, 22), x, y - 59); for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; ctx.fillStyle = S.game.colors[i % 2]; ctx.fillRect(x + Math.cos(a) * 70 - 1, y - 8 + Math.sin(a) * 33 - 1, 2, 2); } }
      if (darkness(S.t) > .4 || S.game) { ctx.fillStyle = '#f0d48a'; for (const s of [-1, 1]) { ctx.fillRect(x + s * 68, y - 48, 3, 26); ctx.fillRect(x + s * 68 - 4, y - 50, 11, 3); } }
      break; }
    case 'commons': {
      ctx.fillStyle = '#2e362c'; ctx.fillRect(x - 16, y - 4, 32, 12);
      ctx.strokeStyle = '#e6b325'; ctx.strokeRect(x - 16, y - 4, 32, 12);
      ctx.fillStyle = '#1a2428'; ctx.fillRect(x - 2, y - 28, 4, 24);
      ctx.fillStyle = '#3ec6d6'; ctx.fillRect(x - 4, y - 32, 8, 4);
      for (let i = 0; i < 3; i++) { const k = ((now / 700 + i / 3) % 1); ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#3ec6d6'; ctx.strokeRect(x - 6 - k * 14, y - 34 - k * 8, 12 + k * 28, 8 + k * 10); }
      ctx.globalAlpha = 1;
      break; }
  }
  ctx.restore();
}
function smoke(x, y, now, col, n) {
  for (let i = 0; i < n; i++) { const k = ((now / 1600 + i / n) % 1); ctx.fillStyle = col; ctx.globalAlpha = (1 - k) * 0.55; ctx.beginPath(); ctx.arc(x + Math.sin(k * 6 + i) * 4 + k * 8, y - k * 30, 3 + k * 6, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
}
function fuelLeft() { const f = S.data?.tokenFuel; return f ? Math.round(Math.max(0, 100 - (f.usedPct || 0))) : 0; }
function drawRocket(x, y, now, busy) {
  shadow(x, y + 4, 50, 8);
  ctx.fillStyle = '#2e362c'; ctx.fillRect(x - 40, y - 8, 80, 12);
  ctx.strokeStyle = '#e6b325'; ctx.strokeRect(x - 40, y - 8, 80, 12);
  ctx.strokeStyle = '#3a4038'; ctx.lineWidth = 2; ctx.strokeRect(x + 22, y - 96, 8, 88);
  for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(x + 22, y - 8 - i * 10); ctx.lineTo(x + 30, y - 16 - i * 10); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(x + 22, y - 78); ctx.lineTo(x + 10, y - 78); ctx.stroke();
  const lift = S.launchAt ? Math.min(400, Math.pow((performance.now() - S.launchAt) / 1000, 2) * 40) : 0;
  const ry = y - 10 - lift;
  ctx.fillStyle = '#8aa399'; ctx.fillRect(x - 8, ry - 88, 16, 88);
  ctx.fillStyle = '#d7e2dc'; ctx.fillRect(x - 8, ry - 88, 4, 88);
  ctx.fillStyle = '#e6b325'; ctx.fillRect(x - 8, ry - 48, 16, 4);
  ctx.fillStyle = '#3ec6d6'; ctx.fillRect(x - 4, ry - 70, 8, 6);
  ctx.fillStyle = '#c5d0c8'; ctx.beginPath(); ctx.moveTo(x - 8, ry - 88); ctx.lineTo(x, ry - 108); ctx.lineTo(x + 8, ry - 88); ctx.fill();
  ctx.fillStyle = '#3a4038';
  ctx.fillRect(x - 14, ry - 96, 6, 10); ctx.fillRect(x + 8, ry - 96, 6, 10);
  ctx.fillRect(x - 14, ry - 8, 6, 10); ctx.fillRect(x + 8, ry - 8, 6, 10);
  ctx.fillStyle = '#10181c'; ctx.font = 'bold 7px ui-monospace,monospace'; ctx.textAlign = 'center';
  ctx.save(); ctx.translate(x + 1, ry - 40); ctx.rotate(-Math.PI / 2); ctx.fillText('TOKENMAX', 0, 0); ctx.restore();
  const f = fuelLeft() / 100;
  ctx.fillStyle = '#10181c'; ctx.fillRect(x + 36, y - 92, 8, 80);
  const fg = ctx.createLinearGradient(0, y - 12, 0, y - 92); fg.addColorStop(0, '#e6b325'); fg.addColorStop(1, '#3ec6d6');
  ctx.fillStyle = fg; ctx.fillRect(x + 37, y - 12 - 76 * f, 6, 76 * f);
  ctx.fillStyle = '#e7f0ea'; ctx.font = 'bold 9px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.fillText(`${Math.round(f * 100)}%`, x + 48, y - 12 - 76 * f + 4);
  if (busy || lift) { for (let i = 0; i < 8; i++) { const k = ((now / 400 + i / 8) % 1); ctx.fillStyle = k > 0.5 ? '#e6b325' : '#3ec6d6'; ctx.globalAlpha = (1 - k) * 0.85; ctx.fillRect(x - 3 + (i % 3) * 3, ry + 2 + k * (lift ? 36 : 8), 3, 3); } ctx.globalAlpha = 1; }
}

function drawTree(tr, now) {
  const x = Math.round(tr.x), y = Math.round(tr.y), s = tr.s;
  if (tr.palm) {
    ctx.fillStyle = '#2a3128'; ctx.fillRect(x, y - Math.round(22 * s), 2, Math.round(22 * s));
    ctx.fillStyle = '#e6b325'; ctx.fillRect(x - 3, y - Math.round(24 * s), 8, 3);
    ctx.fillStyle = Math.floor(now / 480 + x) % 2 ? '#3ec6d6' : '#143238';
    ctx.fillRect(x - 1, y - Math.round(27 * s), 4, 3);
  } else {
    ctx.fillStyle = '#243024'; ctx.fillRect(x, y - Math.round(6 * s), 2, Math.round(6 * s));
    ctx.fillStyle = tr.hue < .5 ? '#3f5a34' : '#4e6238';
    ctx.fillRect(x - Math.round(6 * s), y - Math.round(12 * s), Math.round(12 * s), Math.round(7 * s));
    ctx.fillStyle = '#66784c';
    ctx.fillRect(x - Math.round(3 * s), y - Math.round(15 * s), Math.round(7 * s), Math.round(4 * s));
  }
}

function drawHouse(b, now, dk) {
  const x = Math.round(b.home.x), y = Math.round(b.home.y); const home = b.state === 'sleep';
  shadow(x, y + 1, 28, 6);
  if (home && dk > 0.35) { ctx.fillStyle = 'rgba(230,179,37,.16)'; ctx.fillRect(x - 18, y - 22, 36, 22); }
  ctx.fillStyle = '#3a4034'; ctx.fillRect(x - 14, y - 16, 28, 16);
  ctx.fillStyle = shade(b.hex, 0.8); ctx.fillRect(x - 16, y - 21, 32, 6);
  ctx.fillStyle = '#e6b325'; ctx.fillRect(x - 16, y - 21, 32, 1);
  ctx.fillStyle = '#141c1e'; ctx.fillRect(x - 3, y - 10, 6, 10);
  const winLit = home ? dk > 0.3 : dk > 0.35;
  ctx.fillStyle = winLit ? '#e6b325' : '#141c1e';
  ctx.fillRect(x - 11, y - 12, 4, 3); ctx.fillRect(x + 7, y - 12, 4, 3);
  ctx.strokeStyle = 'rgba(230,179,37,.35)'; ctx.strokeRect(x - 16, y - 2, 32, 14);
  if (etParts(S.t).mo === 10) { ctx.fillStyle = '#e6b325'; ctx.fillRect(x + 12, y - 4, 5, 4); ctx.fillStyle = '#3f5a34'; ctx.fillRect(x + 14, y - 6, 2, 2); }
  void now;
}

function botShape(shape, r) {
  ctx.beginPath();
  switch (shape) {
    case 'hex': for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); break;
    case 'squircle': case 'tablet': ctx.roundRect(-r, -r * (shape === 'tablet' ? 1.15 : 1), r * 2, r * (shape === 'tablet' ? 2.3 : 2), r * 0.55); break;
    case 'teardrop': ctx.moveTo(0, -r * 1.35); ctx.quadraticCurveTo(r * 1.15, -r * 0.2, r, r * 0.25); ctx.arc(0, r * 0.25, r, 0, Math.PI); ctx.quadraticCurveTo(-r * 1.15, -r * 0.2, 0, -r * 1.35); break;
    case 'wedge': ctx.moveTo(-r, r); ctx.lineTo(r, r); ctx.lineTo(r * 0.6, -r); ctx.lineTo(-r * 0.6, -r); ctx.closePath(); break;
    case 'cloud': ctx.arc(-r * .45, r * .1, r * .7, 0, 7); ctx.arc(r * .45, r * .1, r * .7, 0, 7); ctx.arc(0, -r * .35, r * .75, 0, 7); break;
    case 'sparkle': for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rr2 = i % 2 ? r * 0.72 : r * 1.12; ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); } ctx.closePath(); break;
    case 'pebble': ctx.ellipse(0, 0, r * 1.15, r * 0.9, 0.2, 0, 7); break;
    case 'blob': for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2, rr2 = r * (1 + 0.12 * Math.sin(a * 3)); ctx.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2); } ctx.closePath(); break;
    default: ctx.arc(0, 0, r, 0, 7);
  }
}
function bracket(x, y, s, col) {
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 12, y - 16 + s); ctx.lineTo(x - 12, y - 16); ctx.lineTo(x - 12 + s, y - 16);
  ctx.moveTo(x + 12 - s, y - 16); ctx.lineTo(x + 12, y - 16); ctx.lineTo(x + 12, y - 16 + s);
  ctx.moveTo(x - 12, y + 10 - s); ctx.lineTo(x - 12, y + 10); ctx.lineTo(x - 12 + s, y + 10);
  ctx.moveTo(x + 12 - s, y + 10); ctx.lineTo(x + 12, y + 10); ctx.lineTo(x + 12, y + 10 - s);
  ctx.stroke();
}
function drawBot(b, now) {
  if (b.state === 'sleep' && Math.hypot(b.x - b.home.x, b.y - b.home.y - 4) < 4) return; // tucked in the bay
  const bob = b.moving ? Math.abs(Math.sin(now / 110 + b.phase)) * 2 : 0;
  const x = Math.round(b.x), y = Math.round(b.y - bob), sel = S.selected === b.id || S.hover === b.id;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x - 7, Math.round(b.y) + 8, 14, 3);
  if (b.state === 'work') bracket(x, y, 5, 'rgba(62,198,214,.9)');
  if (sel) bracket(x, y, 6, '#e6b325');
  const sw = b.moving ? Math.round(Math.sin(now / 90 + b.phase) * 3) : 0;
  ctx.fillStyle = '#1c2422';
  ctx.fillRect(x - 6, y + 4, 3, 6); ctx.fillRect(x + 3, y + 4, 3, 6);
  ctx.fillRect(x - 7 + sw, y + 9, 4, 2); ctx.fillRect(x + 3 - sw, y + 9, 4, 2);
  ctx.fillStyle = '#141c1e';
  ctx.fillRect(x - 10, y - 5, 3, 6); ctx.fillRect(x + 7, y - 5, 3, 6);
  ctx.fillStyle = b.hex; ctx.fillRect(x - 7, y - 8, 14, 12);
  ctx.fillStyle = shade(b.hex, 0.62); ctx.fillRect(x + 4, y - 8, 3, 12);
  ctx.save(); ctx.translate(x, y - 2); ctx.scale(0.45, 0.45); ctx.fillStyle = '#10181c'; botShape(b.shape, 6); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#10181c'; ctx.fillRect(x - 5, y - 6, 10, 4);
  const blink = (Math.floor(now / 120 + b.phase * 10) % 36) === 0;
  ctx.fillStyle = b.state === 'work' ? '#3ec6d6' : '#e6b325';
  if (!blink) { ctx.fillRect(x - 4, y - 5, 3, 2); ctx.fillRect(x + 1, y - 5, 3, 2); }
  ctx.fillStyle = '#1c2422'; ctx.fillRect(x - 1, y - 13, 2, 5);
  ctx.fillStyle = b.state === 'work' ? (Math.floor(now / 250) % 2 ? '#3ec6d6' : '#e6b325') : '#8aa399';
  ctx.fillRect(x - 2, y - 15, 4, 3);
  if (S.game && b.state === 'idle' && !sel) return;
  ctx.font = '700 10px ui-monospace,monospace'; ctx.textAlign = 'center';
  const nm = b.name.replace('Boyd Family Times', 'Family Times').replace(' (archive)', ' ‹arch›');
  const tw = ctx.measureText(nm).width + 8;
  ctx.fillStyle = 'rgba(12,20,22,.88)'; ctx.fillRect(x - tw / 2, y + 13, tw, 12);
  ctx.fillStyle = '#e6b325'; ctx.fillRect(x - tw / 2, y + 13, tw, 1);
  ctx.fillStyle = '#e7f0ea'; ctx.fillText(nm, x, y + 22);
}
function drawBubble(b, now, slot) {
  if (!b.what || (b.state !== 'work' && S.selected !== b.id && S.hover !== b.id)) return null;
  if (b.state === 'sleep' && S.selected !== b.id) return null;
  const txt = b.what;
  ctx.font = '600 11px ui-monospace,monospace';
  const w = Math.min(230, ctx.measureText(txt).width + 14), h = 18;
  const x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, b.x)), y = b.y - 32 - slot * 22;
  ctx.fillStyle = 'rgba(12,20,22,.94)';
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.strokeStyle = b.state === 'work' ? '#3ec6d6' : '#e6b325'; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = '#e7f0ea'; ctx.textAlign = 'center';
  let t2 = txt; while (ctx.measureText(t2).width > w - 12 && t2.length > 4) t2 = t2.slice(0, -2);
  if (t2 !== txt) t2 = t2.slice(0, -1) + '…';
  ctx.fillText(t2, x, y - 5);
  void now;
  return {x: x - w / 2, y: y - h, w, h};
}
function drawSign(b, key) {
  ctx.font = '700 10px ui-monospace,monospace'; ctx.textAlign = 'center';
  const busy = S.bots.some(o => o.building === key && o.state === 'work');
  const mark = key === 'stadium' || key === 'commons' || key === 'boyd' ? '' : (busy ? ' ⚒' : '');
  const t = `${b.emoji} ${b.name}${mark}`; const w = ctx.measureText(t).width + 10;
  ctx.fillStyle = 'rgba(12,20,22,.9)'; ctx.fillRect(b.x - w / 2, b.y + 6, w, 14);
  ctx.strokeStyle = busy ? '#3ec6d6' : '#2c4650'; ctx.lineWidth = 1; ctx.strokeRect(b.x - w / 2, b.y + 6, w, 14);
  ctx.fillStyle = busy ? '#b7eef4' : '#e7f0ea'; ctx.fillText(t, b.x, b.y + 16);
}
function drawClouds(now, dk) {
  ctx.fillStyle = `rgba(214,222,214,${0.10 - dk * 0.06})`;
  for (let i = 0; i < 4; i++) {
    const x = ((now / (80 + i * 20) + i * 280) % (W + 300)) - 150, y = 70 + (i * 150) % 520;
    ctx.fillRect(x, y, 46, 8); ctx.fillRect(x + 10, y - 6, 28, 6);
  }
}

// ---------- frame ----------
let lastFrame = performance.now(), lastUi = 0;
function resize() {
  const r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const s = Math.min(r.width / W, r.height / H) * cam.z;
  const cx = (r.width - W * s) / 2 + cam.x, cy = (r.height - H * s) / 2 + cam.y;
  view = {s: s * dpr, ox: cx * dpr, oy: cy * dpr, css: s, cssOx: cx, cssOy: cy};
  const tr = tl.getBoundingClientRect(); tl.width = tr.width * dpr; tl.height = tr.height * dpr;
  if (S.data) { try { draw(performance.now()); renderTimeline(); } catch (e) { console.error(e); } }
}
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  if (S.data) {
    if (S.playing) S.t += dt * 1000 * S.speed;
    if (S.mode === 'live' && S.speed === 1 && S.playing) S.t = Date.now();
    if (S.mode === 'replay') { const d0 = S.replayDay, d1 = d0 + DAY; if (S.t >= d1) S.t = d0; if (S.t < d0) S.t = d0; }
    updateBots(S.t, dt);
    updateBoyd(S.t, dt);
    draw(now);
    pumpTicker();
    if (now - lastUi > 400) { lastUi = now; renderUi(); }
  }
  requestAnimationFrame(frame);
}
function draw(now) {
  const dk = darkness(S.t);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0c1416'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(view.s, 0, 0, view.s, view.ox, view.oy);
  ctx.imageSmoothingEnabled = false;
  drawWater(now, dk);
  if (!terrain) buildTerrain();
  ctx.drawImage(terrain, 0, 0, W, H);
  // depth-sorted scene
  const items = [];
  for (const t of trees) items.push({y: t.y, f: () => drawTree(t, now)});
  for (const [k, b] of Object.entries(BUILDINGS)) {
    if (k === 'boyd') continue;
    const busy = S.bots.some(o => o.building === k && o.state === 'work' && Math.hypot(o.x - o.tx, o.y - o.ty) < 6);
    items.push({y: b.y, f: () => drawBuilding(k, b, now, dk > 0.35, busy || (k === 'radio' && S.bots.some(o => o.building === 'radio' && o.state === 'work')))});
  }
  for (const b of S.bots) { items.push({y: b.home.y, f: () => drawHouse(b, now, dk)}); items.push({y: b.y + 8, f: () => drawBot(b, now)}); }
  items.push({y: BOYD.home.y, f: () => drawBoydHouse(now, dk)}); items.push({y: BOYD.y + 8, f: () => drawBoyd(now)});
  items.sort((a, b) => a.y - b.y).forEach(i => i.f());
  drawClouds(now, dk);
  // night
  if (dk > 0) {
    ctx.fillStyle = `rgba(6,12,14,${dk * 0.55})`; ctx.fillRect(-400, -400, W + 800, H + 800);
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, a, rgb) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };
    for (const [k, b] of Object.entries(BUILDINGS)) { const busy = S.bots.some(o => o.building === k && o.state === 'work'); glow(b.x, b.y - 20, busy ? 64 : 28, (busy ? .32 : .1) * dk, busy ? '62,198,214' : '230,179,37'); }
    for (const b of S.bots) if (b.state !== 'sleep') glow(b.home.x, b.home.y - 12, 22, .1 * dk, '230,179,37');
    for (const b of S.bots) if (b.state !== 'sleep') glow(b.x, b.y, 14, .22 * dk, '62,198,214');
    const L = BUILDINGS.lighthouse, a = now / 1400;
    ctx.fillStyle = `rgba(230,214,150,${0.16 * dk})`; ctx.beginPath(); ctx.moveTo(L.x, L.y - 74); ctx.arc(L.x, L.y - 74, 300, a - 0.1, a + 0.1); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  // signs & bubbles on top
  for (const [k, b] of Object.entries(BUILDINGS)) if (k !== 'boyd') drawSign(b, k);
  const placed = [];
  const bubbleBots = [...S.bots].sort((a, b) => (a.state === 'work' ? 0 : 1) - (b.state === 'work' ? 0 : 1));
  for (const b of bubbleBots) {
    let slot = 0;
    for (; slot < 6; slot++) {
      ctx.font = '600 11px ui-monospace,monospace';
      const w = Math.min(230, ctx.measureText(b.what || '').width + 30), y = b.y - 30 - slot * 23;
      if (!placed.some(p => Math.abs(p.x - b.x) < (p.w + w) / 2 && Math.abs(p.y - y) < 22)) { placed.push({x: b.x, y, w}); break; }
    }
    drawBubble(b, now, slot);
  }
  if (S.showNet) drawNetwork(etDayStart(S.t));
  drawOverlays(now, dk);
  if (BOYD.state === 'out' || S.hover === 'boyd') drawBubble({x: BOYD.x, y: BOYD.y, what: BOYD.what, state: 'idle', id: 'boyd'}, now, 0);
  // mode banner rendered in #modeBadge (HTML) so it stays readable over remaster sky
}

// ---------- ticker ----------
function pumpTicker() {
  const t = S.t, from = S.lastTickerT || t - 1;
  if (t < from || t - from > 3 * HOUR) { S.lastTickerT = t; return; }
  const add = [];
  for (const e of S.allEvents) { if (e.t > from && e.t <= t) add.push(e); }
  const ds = etDayStart(t);
  for (const b of S.bots) for (const s of sessionsFor(b, ds)) {
    if (s.kind !== 'actual' && s.start > from && s.start <= t) add.push({t: s.start, bot: b.id, sched: s});
  }
  add.sort((a, b) => a.t - b.t);
  const nowR = performance.now();
  for (const e of add.slice(-25)) {
    if (e.type === 'agent_msg' && S.byId[e.from] && S.byId[e.bot]) blip(880, 0.05, 'square', 0.015), S.planes.push({from: S.byId[e.from], to: S.byId[e.bot], at: nowR + S.planes.length % 4 * 120});
    if (e.type === 'boyd_msg' && S.byId[e.bot]) S.pings.push({b: S.byId[e.bot], at: nowR});
  }
  S.planes = S.planes.slice(-30); S.pings = S.pings.slice(-20);
  // compress bursts: one line per bot per minute
  const seen = new Set();
  for (const e of add.slice(-60)) {
    const k = e.bot + Math.floor(e.t / MIN); if (seen.has(k)) continue; seen.add(k);
    const b = S.byId[e.bot]; if (!b) continue;
    const text = e.type === 'agent_msg' ? `signal drone from ${S.byId[e.from]?.name || 'a bot'}` : e.type === 'boyd_msg' ? 'heard from Boyd' : e.sched ? `starts “${e.sched.label}”${e.sched.kind === 'scheduled' ? ' ⏰' : e.sched.kind === 'run' ? ' ✅' : ''}` : eventLabel(e);
    S.ticker.unshift({t: e.t, b, text});
  }
  S.ticker = S.ticker.slice(0, 40);
  S.lastTickerT = t;
}
let lastTickerRender = '';
function renderTicker() {
  const el = document.getElementById('ticker');
  const rows = S.ticker.slice(0, 14);
  const sig = rows.map(r => r.t + r.b.id + r.text).join('|');
  if (sig === lastTickerRender) return; lastTickerRender = sig;
  el.innerHTML = rows.length ? rows.map(r => `<li><span class="t">${hm(r.t)}</span><span>${r.b.emoji} <b>${esc(r.b.name)}</b> ${esc(r.text)}</span></li>`).join('')
    : `<li><span class="t"></span><span style="color:var(--mute)">No signal. Speed up time or replay a busy day to see the fleet at work.</span></li>`;
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])); }

// ---------- UI ----------
let healthSig = '';
function renderHealth() {
  let html;
  if (DOC && DOC.findings) {
    const top = DOC.findings.filter(f => f.severity !== 'info').slice(0, 5);
    html = `<h2>🩺 Fleet Doctor <span class="small">${DOC.score}/100 · ${DOC.counts.high + DOC.counts.medium} to look at</span></h2>` + top.map(f => `<div class="hl ${f.severity === 'low' ? 'info' : 'warn'}">${f.severity === 'low' ? 'ℹ️' : '⚠️'} ${esc(f.title)}</div>`).join('') + `<button class="chip" id="openDoctor" style="margin-top:6px">Open Fleet Doctor →</button>`;
  } else {
    const items = fleetHealth(); html = `<h2>🩺 Fleet health <span class="small">${items.filter(i => i.lvl === 'warn').length} to look at</span></h2>` + items.slice(0, 8).map(i => `<div class="hl ${i.lvl}">${i.lvl === 'warn' ? '⚠️' : 'ℹ️'} ${esc(i.text)}</div>`).join('');
  }
  if (html !== healthSig) { healthSig = html; document.getElementById('healthCard').innerHTML = html; const ob = document.getElementById('openDoctor'); if (ob) ob.onclick = () => setTab('doctor'); }
}
function renderUi() {
  const p = etParts(S.t);
  const phase = skyPhase(S.t);
  document.getElementById('clockTime').textContent = hm(S.t, S.speed <= 60);
  document.getElementById('clockDate').innerHTML = `${dayLabel(S.t)} · ET · <span class="phase">${skyLabel(phase)}</span>`;
  document.getElementById('playBtn').textContent = S.playing ? '⏸' : '▶';
  const sky = document.getElementById('skyChip');
  if (sky) { sky.className = 'sky-chip ' + phase; sky.textContent = 'SKY ' + skyLabel(phase); }
  updateModeBadge();
  renderFuel(); renderStats(); renderHealth(); renderRoster(); renderTimeline(); renderTicker(); renderPlacesDir();
  if (S.selected) renderDetail();
  void p;
}
function updateModeBadge() {
  const el = document.getElementById('modeBadge'); if (!el) return;
  if (S.mode === 'replay') {
    el.hidden = false; el.className = 'mode-badge replay';
    el.textContent = `⟲ REPLAY · ${dayLabel(S.replayDay + 12 * HOUR)} · ${hm(S.t)} ET · real fleet activity`;
  } else if (S.speed !== 1 || !S.playing || Math.abs(S.t - Date.now()) > 90e3) {
    const forecast = S.t > Date.now();
    el.hidden = false; el.className = 'mode-badge ' + (forecast ? 'forecast' : 'lookback');
    el.textContent = forecast
      ? `⏩ FORECAST · ${hm(S.t)} ET · schedules + observed rhythms · press 1× to return to now`
      : `⏪ LOOKBACK · ${dayLabel(S.t)} ${hm(S.t)} ET · press 1× Live to return to now`;
  } else {
    el.hidden = true;
  }
}
function renderPlacesDir() {
  const dir = document.getElementById('placesDir'); if (!dir || dir.hidden) return;
  const rows = [];
  for (const [k, b] of Object.entries(BUILDINGS)) {
    if (k === 'boyd') continue;
    const who = S.bots.filter(o => o.building === k);
    const busy = who.some(o => o.state === 'work');
    const names = who.length
      ? who.map(o => o.name.replace('Boyd Family Times', 'Family Times').replace(' (archive)', '‹arch›')).join(', ')
      : (k === 'stadium' ? 'idle bots on game day' : k === 'commons' ? 'hangout' : '—');
    rows.push(`<div class="pl${busy ? ' busy' : ''}" data-focus="${k}" title="Focus map on ${esc(b.name)}"><b>${b.emoji} ${esc(b.name)}</b><div class="who">${busy ? '⚡ ' : ''}${esc(names)}</div></div>`);
  }
  const sig = rows.join('|');
  if (sig === renderPlacesDir._sig) return; renderPlacesDir._sig = sig;
  dir.innerHTML = rows.join('');
}
function renderFuel() {
  const f = S.data.tokenFuel || {};
  const used = (typeof f.usedPct === 'number') ? f.usedPct : null;
  const left = used != null ? Math.round(Math.max(0, 100 - used)) : fuelLeft();
  const target = (typeof f.targetPct === 'number') ? f.targetPct : null;
  const gap = (typeof f.gapPts === 'number') ? f.gapPts : (used != null && target != null ? +(target - used).toFixed(2) : null);
  const reset = f.resetAtISO ? Date.parse(f.resetAtISO) : null; const to = reset ? reset - Date.now() : null;
  const checked = f.checkedAt ? Date.parse(f.checkedAt) : null;
  const resetTxt = reset ? `${f.resetExact ? '' : 'as early as '}${dayLabel(reset)} ${hm(reset)} ET` : '';
  let paceClass = 'pace-on', statusHtml = '';
  if (gap != null) {
    if (gap > 1.5) { paceClass = 'pace-behind'; statusHtml = `<div class="status behind">Behind pace by ${gap.toFixed(1)} pts · burn more this week</div>`; }
    else if (gap < -1.5) { paceClass = 'pace-ahead'; statusHtml = `<div class="status ahead">Ahead of pace by ${Math.abs(gap).toFixed(1)} pts</div>`; }
    else { paceClass = 'pace-on'; statusHtml = `<div class="status ontrack">On track vs 95%-by-reset target</div>`; }
  }
  const el = document.getElementById('fuelCard');
  el.className = 'card fuel ' + paceClass;
  const dual = target != null && used != null
    ? `<div class="dual" title="Fill = used% from usage.json · white tick = straight-line target%"><i class="fill" style="width:${Math.min(100, used)}%"></i><span class="tgt" style="left:${Math.min(100, target)}%" data-label="target ${target.toFixed(1)}%"></span></div>`
    : `<div class="bar"><i style="width:${left}%"></i></div>`;
  const usedDisp = used != null ? `${used}%` : '—';
  const tgtDisp = target != null ? `${target.toFixed(1)}%` : '—';
  el.innerHTML = `
    <h2>🚀 This Week · TokenMax pace</h2>
    <div class="pace-grid">
      <div><div class="n" style="color:${paceClass === 'pace-behind' ? '#f87171' : 'var(--accent)'}">${usedDisp}</div><div class="l">used</div></div>
      <div><div class="n">${tgtDisp}</div><div class="l">pace target</div></div>
      <div><div class="n">${left}%</div><div class="l">fuel left</div></div>
    </div>
    ${dual}
    ${statusHtml}
    <div class="small" style="margin-top:6px">${to != null ? (to > 0 ? `Reset in <span class="cd">${dur(to)}</span> · ${esc(resetTxt)}` : `<span class="cd">Reset window reached</span> · ${esc(resetTxt)}`) : ''}</div>
    <div class="small" style="margin-top:4px">${checked ? `Checked ${dayLabel(checked)} ${hm(checked)} · ` : ''}reads <code>usage.json</code> only · never invents %${f.weekElapsedPct != null ? ` · week ${f.weekElapsedPct}% elapsed` : ''}${f.account ? ` · ${esc(f.account)}` : ''}</div>`;
}
function gameWatch(from, n = 4) {
  const gs = (S.data?.gameDays || []).filter(g => Date.parse(g.startET) + (g.hours || 3) * HOUR > from).sort((a, b) => Date.parse(a.startET) - Date.parse(b.startET)).slice(0, n);
  const notes = S.data?.gameNotes || [];
  if (!gs.length && !notes.length) return '';
  return `<div class="gazette upnext"><b>🏟️ Game watch (ET)</b>${gs.map(g => { const s = Date.parse(g.startET); const live = from >= s && from <= s + (g.hours || 3) * HOUR; return `<div title="${esc(g.note || '')}">${live ? '🔴 LIVE · ' : ''}${dayLabel(s).split(',')[0]} ${dayLabel(s).split(', ')[1] || ''} ${hm(s)} · ${esc(g.label)}${g.tv ? ` <span class="small">${esc(g.tv.split(';')[0])}</span>` : ''}</div>`; }).join('')}${notes.map(x => `<div class="small">⚾ ${esc(x.team)}: ${esc(x.note)}</div>`).join('')}</div>`;
}
function upNext(from, n = 4) {
  const out = [];
  for (const b of S.bots) {
    for (let k = 0; k < 2; k++) { const d0 = etDayStart(from) + k * DAY + 2 * HOUR; for (const s of sessionsFor(b, etDayStart(d0))) if ((s.kind === 'scheduled' || s.kind === 'observed') && s.start > from) out.push({b, s}); }
  }
  return out.sort((a, b) => a.s.start - b.s.start).slice(0, n);
}
function renderStats() {
  const ds = etDayStart(S.t), working = S.bots.filter(b => b.state === 'work').length, sleeping = S.bots.filter(b => b.state === 'sleep').length;
  const todaysEvents = S.allEvents.filter(e => e.t >= ds && e.t < ds + DAY).length;
  const routines = S.bots.reduce((n, b) => n + (b.routines || []).filter(r => r.enabled !== false).length, 0);
  const runsToday = S.bots.reduce((n, b) => n + sessionsFor(b, ds).filter(s => s.kind !== 'actual').length, 0);
  document.getElementById('statsCard').innerHTML = `<div class="grid">
    <div><div class="n" style="color:var(--work)">${working}</div><div class="l">working now</div></div>
    <div><div class="n" style="color:var(--idle)">${S.bots.length - working - sleeping}</div><div class="l">out and about</div></div>
    <div><div class="n" style="color:var(--sleep)">${sleeping}</div><div class="l">asleep</div></div>
    <div><div class="n">${routines}</div><div class="l">active routines</div></div>
    <div><div class="n">${runsToday}</div><div class="l">${S.mode === 'live' ? 'shifts this day' : 'routine runs'}</div></div>
    <div><div class="n">${todaysEvents.toLocaleString()}</div><div class="l">events this day</div></div></div>${dayReport(ds)}${S.mode === 'live' ? `<div class="gazette upnext"><b>⏭️ Up next</b>${upNext(S.t).map(({b, s}) => `<div>${hm(s.start)}${etDayStart(s.start) !== ds ? ' <span class="small">' + dayLabel(s.start).split(',')[0] + '</span>' : ''} · ${b.emoji} ${esc(b.name)}: ${esc(s.kind === 'observed' ? 'usual shift' : s.label)}</div>`).join('')}</div>${gameWatch(S.t)}` : ''}`;
  document.title = `🏝️ ${working ? working + ' working · ' : ''}Bot Island`;
}
let rosterSig = '';
function renderRoster(force) {
  if (!S.data) return;
  const el = document.getElementById('roster');
  const order = [...S.bots].sort((a, b) => ({work: 0, idle: 1, sleep: 2}[a.state] - {work: 0, idle: 1, sleep: 2}[b.state]) || a.name.localeCompare(b.name));
  const rows = order.map(b => {
    const nx = nextScheduled(b, S.t);
    const sub = b.state === 'work' ? b.what : (nx ? `next: ${nx.label} · ${dayLabel(nx.t) === dayLabel(S.t) ? hm(nx.t) : dayLabel(nx.t) + ' ' + hm(nx.t)}` : (b.title || 'on call'));
    const pill = {work: 'working', idle: 'about', sleep: 'asleep'}[b.state];
    return `<div class="bot ${S.selected === b.id ? 'sel' : ''}" data-id="${b.id}"><div class="av" style="background:${b.hex}">${b.emoji}</div><div><div class="nm">${esc(b.name)}</div><div class="what" title="${esc(sub)}">${esc(sub)}</div></div><span class="pill ${b.state}">${pill}</span></div>`;
  }).join('');
  if (!force && rows === rosterSig) return; rosterSig = rows;
  el.innerHTML = rows;
  document.getElementById('rosterCount').textContent = `· ${S.bots.length} bots${S.data.eggs?.length ? ` + ${S.data.eggs.length} egg` : ''}`;
}
document.getElementById('roster').addEventListener('click', e => { const r = e.target.closest('.bot'); if (r) select(r.dataset.id); });

function select(id) { S.selected = S.selected === id ? null : id; const d = document.getElementById('detail'); d.hidden = !S.selected; renderRoster(true); if (S.selected) renderDetail(); }
let detailSig = '';
function renderDetail() {
  const b = S.byId[S.selected]; if (!b) return;
  const nx = nextScheduled(b, S.t);
  const lastEv = (S.eventsByBot[b.id] || []).filter(e => e.t <= S.t).slice(-1)[0];
  const ds = etDayStart(S.t); const ss = sessionsFor(b, ds);
  const html = `<button class="x" onclick="select('${b.id}')">×</button>
    <h3>${b.emoji} ${esc(b.name)}</h3><div class="t2">${esc(b.title || 'Grok Bot')} · works at ${esc(b.work.emoji + ' ' + b.work.name)}</div>
    <table>
      <tr><td>Right now</td><td><span class="pill ${b.state}">${b.state}</span> ${esc(b.what)}</td></tr>
      <tr><td>Next shift</td><td>${nx ? `${esc(nx.label)}<br>${dayLabel(nx.t)} ${hm(nx.t)} (in ${dur(nx.t - S.t)})` : '—'}</td></tr>
      <tr><td>Last tool activity</td><td>${lastEv ? `${esc(eventLabel(lastEv))}<br>${dayLabel(lastEv.t)} ${hm(lastEv.t)}` : '—'}</td></tr>
      <tr><td>Last output on disk</td><td>${b.artifactUpdatedAt ? `${dayLabel(Date.parse(b.artifactUpdatedAt))} ${hm(Date.parse(b.artifactUpdatedAt))}` : '—'}</td></tr>
      <tr><td>Logged tool events</td><td>${(b.eventCount || 0).toLocaleString()} + ${b.artifactWrites30d || 0} file bursts (30d)</td></tr>
      <tr><td>This day</td><td>${ss.length ? ss.map(s => `${hm(s.start)} ${s.kind === 'actual' ? '⚡' : s.kind === 'run' ? '✅' : s.kind === 'observed' ? '👀' : '⏰'}`).slice(0, 12).join(', ') : 'nothing scheduled'}</td></tr>
    </table>
    <h2 style="margin:12px 0 4px;font-size:12px;color:var(--mute);letter-spacing:1px">WHEN ${esc(b.name.toUpperCase())} WORKS <span style="text-transform:none;letter-spacing:0">(all logged events, ET)</span></h2>
    ${heatmap(b)}
    <h2 style="margin:12px 0 4px;font-size:12px;color:var(--mute);letter-spacing:1px">ROUTINES</h2>
    ${(b.routines || []).length ? b.routines.map(r => `<div class="rt"><b>${esc(r.name)}</b> ${r.enabled === false ? '<span class="pill">paused</span>' : ''}<div class="c">${esc(cronHuman(r.cron))}${r.medianMinutes ? ` · ~${r.medianMinutes} min per run` : ''} · ${r.runs.length} runs logged</div></div>`).join('') : `<div class="rt"><div class="c">No local routines${(b.observedRhythm || []).length ? `. Observed rhythm: ${b.observedRhythm.map(o => `${(o.hour % 12) || 12}:${String(o.minute).padStart(2, '0')} ${o.hour < 12 ? 'AM' : 'PM'}`).join(', ')}` : ''}</div></div>`}`;
  if (html === detailSig) return; detailSig = html;
  document.getElementById('detail').innerHTML = html;
}

// ---------- timeline ----------
const TL = {left: 132, top: 18, row: 12.4};
function renderTimeline() {
  const dpr = window.devicePixelRatio || 1, w = tl.width / dpr, h = tl.height / dpr;
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0); tctx.clearRect(0, 0, w, h);
  const ds = etDayStart(S.t), x0 = TL.left, x1 = w - 10, X = (ms) => x0 + (ms - ds) / DAY * (x1 - x0);
  const rows = [...S.bots].sort((a, b) => a.name.localeCompare(b.name));
  TL.row = Math.min(13, (h - TL.top - 4) / rows.length);
  // night bands
  tctx.fillStyle = 'rgba(26,42,48,.55)'; tctx.fillRect(X(ds), TL.top - 4, X(ds + 7 * HOUR) - X(ds), h); tctx.fillRect(X(ds + 19 * HOUR), TL.top - 4, x1 - X(ds + 19 * HOUR), h);
  tctx.font = '10px ui-monospace,monospace'; tctx.fillStyle = '#8aa399'; tctx.textAlign = 'center';
  for (let hh = 0; hh <= 24; hh += 3) { const x = X(etToMs(...ymd(ds), 0, 0) + hh * HOUR); tctx.fillText(hh === 0 || hh === 24 ? '12a' : hh === 12 ? '12p' : hh < 12 ? hh + 'a' : (hh - 12) + 'p', x, 11); tctx.fillStyle = 'rgba(44,70,80,.45)'; tctx.fillRect(x, TL.top - 4, 1, h); tctx.fillStyle = '#8aa399'; }
  rows.forEach((b, i) => {
    const y = TL.top + i * TL.row;
    tctx.textAlign = 'right'; tctx.fillStyle = S.selected === b.id ? '#e6b325' : '#d7e4dc'; tctx.font = '10px ui-monospace,monospace';
    tctx.fillText(`${b.emoji} ${b.name.replace('Boyd Family Times', 'Family Times').replace(' (archive)', ' (arch)')}`, x0 - 8, y + TL.row - 3);
    tctx.fillStyle = 'rgba(255,255,255,.03)'; tctx.fillRect(x0, y + 1, x1 - x0, TL.row - 2);
    for (const s of sessionsFor(b, ds)) {
      const a = X(Math.max(ds, s.start)), z = Math.max(a + 4, X(Math.min(ds + DAY, s.end)));
      tctx.globalAlpha = s.kind === 'scheduled' || s.kind === 'observed' ? 0.55 : 1;
      tctx.fillStyle = b.hex; tctx.fillRect(a, y + 2, z - a, TL.row - 4);
      if (s.kind === 'scheduled' || s.kind === 'observed') { tctx.strokeStyle = '#fff'; tctx.setLineDash([2, 2]); tctx.strokeRect(a, y + 2, z - a, TL.row - 4); tctx.setLineDash([]); }
      tctx.globalAlpha = 1;
    }
  });
  const nx = X(S.t);
  tctx.fillStyle = '#e6b325'; tctx.fillRect(nx - 1, TL.top - 6, 2, h); tctx.beginPath(); tctx.moveTo(nx - 5, TL.top - 8); tctx.lineTo(nx + 5, TL.top - 8); tctx.lineTo(nx, TL.top - 2); tctx.fill();
  if (S.mode === 'live' && etDayStart(Date.now()) === ds) { const rx = X(Date.now()); tctx.fillStyle = 'rgba(62,198,214,.8)'; tctx.fillRect(rx - 0.5, TL.top - 4, 1, h); }
  document.getElementById('tlTitle').textContent = `${dayLabel(S.t)} on the island`;
  document.getElementById('tlNote').textContent = S.mode === 'live' ? 'solid = real activity · dashed = scheduled/usual · drag to scrub' : 'real tool activity & routine runs from the fleet log · drag to scrub';
}
let dragging = false;
function scrubTo(ev) {
  const r = tl.getBoundingClientRect(), x = ev.clientX - r.left, x0 = TL.left, x1 = r.width - 10;
  const k = Math.max(0, Math.min(0.99999, (x - x0) / (x1 - x0)));
  S.t = etDayStart(S.t) + k * DAY; S.lastTickerT = S.t; S.ticker = [];
  if (S.mode === 'live') { setSpeed(S.speed === 1 ? 60 : S.speed); }
}
tl.addEventListener('pointerdown', e => { dragging = true; tl.setPointerCapture(e.pointerId); scrubTo(e); });
tl.addEventListener('pointermove', e => { if (dragging) scrubTo(e); });
tl.addEventListener('pointerup', () => { dragging = false; });

// ---------- canvas interaction ----------
function worldPos(ev) { const r = cv.getBoundingClientRect(); return {x: (ev.clientX - r.left - view.cssOx) / view.css, y: (ev.clientY - r.top - view.cssOy) / view.css, cx: ev.clientX - r.left, cy: ev.clientY - r.top}; }
function hitBot(p) { let best = null, bd = 18; for (const b of S.bots) { if (b.state === 'sleep' && Math.hypot(b.x - b.home.x, b.y - b.home.y - 4) < 4) { const d = Math.hypot(b.home.x - p.x, b.home.y - 12 - p.y); if (d < 20 && d < bd) { bd = d; best = b; } continue; } const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd) { bd = d; best = b; } } return best; }
function hitBuilding(p) { for (const [k, b] of Object.entries(BUILDINGS)) if (Math.abs(p.x - b.x) < 42 && p.y < b.y + 22 && p.y > b.y - 90) return [k, b]; return null; }
cv.addEventListener('mousemove', ev => {
  const p = worldPos(ev), b = hitBot(p), tt = document.getElementById('tooltip');
  S.hover = b ? b.id : null; cv.style.cursor = b ? 'pointer' : 'default';
  let html = '';
  if (!b && Math.hypot(BOYD.x - p.x, BOYD.y - 4 - p.y) < 14) html = `<b>🧑 Boyd</b><br><span style="color:#8fa3c9">The boss · Technology Director, KPD</span><br>${esc(BOYD.what)}`;
  else if (b) html = `<b>${b.emoji} ${esc(b.name)}</b><br><span style="color:#8fa3c9">${esc(b.title)}</span><br>${esc(b.what || '')}`;
  else { const hb = hitBuilding(p); if (hb) { const [k, bl] = hb; const who = S.bots.filter(o => o.building === k); html = `<b>${bl.emoji} ${esc(bl.name)}</b><br>${who.length ? who.map(o => `${o.emoji} ${esc(o.name)}: ${o.state === 'work' ? '⚡ ' + esc(o.what) : o.state}`).join('<br>') : k === 'stadium' ? 'Ravens · Orioles · Chelsea · Terps flags fly here' : k === 'commons' ? 'Where idle bots hang out' : ''}`; cv.style.cursor = 'help'; } }
  tt.hidden = !html; if (html) { tt.innerHTML = html; tt.style.left = Math.min(p.cx + 14, cv.clientWidth - 290) + 'px'; tt.style.top = (p.cy + 14) + 'px'; }
});
cv.addEventListener('mouseleave', () => { document.getElementById('tooltip').hidden = true; S.hover = null; });
cv.addEventListener('click', ev => { if (pan && pan.moved) return; const b = hitBot(worldPos(ev)); if (b) select(b.id); });

// ---------- controls ----------
function setMode(m) {
  S.mode = m; S.sessionsCache = {}; S.ticker = [];
  document.querySelectorAll('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.mode === m));
  document.getElementById('daySel').hidden = m !== 'replay';
  if (m === 'live') { S.t = Date.now(); setSpeed(1); S.playing = true; }
  else { S.replayDay = +document.getElementById('daySel').value; S.t = S.replayDay + 6 * HOUR; setSpeed(300); S.playing = true; }
  S.lastTickerT = S.t; for (const b of S.bots) b.wander = null;
}
function setSpeed(v) { S.speed = v; document.querySelectorAll('#speedSeg button').forEach(x => x.classList.toggle('on', +x.dataset.speed === v)); }
document.getElementById('modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
document.getElementById('speedSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; setSpeed(+b.dataset.speed); if (S.mode === 'live' && +b.dataset.speed === 1) S.t = Date.now(); });
document.getElementById('playBtn').addEventListener('click', () => { S.playing = !S.playing; });
document.getElementById('daySel').addEventListener('change', e => { S.replayDay = +e.target.value; S.t = S.replayDay + 6 * HOUR; S.sessionsCache = {}; S.ticker = []; S.lastTickerT = S.t; });
document.addEventListener('keydown', e => { if (e.code === 'Space' && e.target.tagName !== 'SELECT') { e.preventDefault(); S.playing = !S.playing; } if (e.key === 'Escape' && S.selected) select(S.selected); });
function buildDaySelect() {
  const counts = {};
  for (const e of S.allEvents) { const k = etDayStart(e.t); counts[k] = (counts[k] || 0) + 1; }
  const days = Object.keys(counts).map(Number).sort((a, b) => b - a);
  const best = days.reduce((m, d) => counts[d] > (counts[m] || 0) ? d : m, days[0]);
  const sel = document.getElementById('daySel'), cur = sel.value;
  sel.innerHTML = days.map(d => `<option value="${d}" ${String(d) === cur || (!cur && d === best) ? 'selected' : ''}>${dayLabel(d + 12 * HOUR)} · ${counts[d]} events${d === best ? ' 🔥' : ''}</option>`).join('');
}

// ---------- boot ----------
const qs = new URLSearchParams(location.search);
window.addEventListener('resize', resize);
load().catch(e => { document.getElementById('clockDate').textContent = 'Could not load fleet data: ' + e.message; throw e; }).then(() => {
  resize();
  if (qs.get('t')) { S.t = Date.parse(qs.get('t')); S.playing = qs.get('play') !== '0'; setSpeed(+(qs.get('speed') || 60)); }
  if (qs.get('mode') === 'replay') { if (qs.get('day')) { const want = etDayStart(Date.parse(qs.get('day') + 'T12:00:00-04:00')); document.getElementById('daySel').value = String(want); } setMode('replay'); if (qs.get('hour')) S.t = S.replayDay + (+qs.get('hour')) * HOUR; if (qs.get('speed')) setSpeed(+qs.get('speed')); S.playing = qs.get('play') !== '0'; }
  if (qs.get('select')) { const b = S.bots.find(x => x.name.toLowerCase() === qs.get('select').toLowerCase()); if (b) select(b.id); }
  // place bots at their targets immediately on first load
  updateBots(S.t, 0); for (const b of S.bots) { b.x = b.tx; b.y = b.ty; } updateBoyd(S.t, 0); BOYD.x = BOYD.tx; BOYD.y = BOYD.ty;
  S.lastTickerT = S.t - 2 * HOUR; pumpTicker();
  requestAnimationFrame(frame);
  setInterval(() => load().catch(() => {}), 60e3);
});
if (qs.get('debug') === '1') setInterval(() => { const m = S.bots.find(b => b.name === 'Michael'); const ev = S.eventsByBot[m.id] || []; document.title = `t=${new Date(S.t).toISOString()} mEvents=${ev.length} types=${[...new Set(ev.map(e=>e.type))]} sess=${JSON.stringify(sessionsFor(m, etDayStart(S.t)).map(s=>[new Date(s.start).toISOString(),s.kind]))} state=${m.state}`; }, 500);

// ---------- overlays: zzz, messages between bots, Boyd pings ----------
function tucked(b) { return b.state === 'sleep' && Math.hypot(b.x - b.home.x, b.y - b.home.y - 4) < 4; }
function drawOverlays(now, dk) {
  for (const b of S.bots) if (tucked(b)) {
    const {x, y} = b.home;
    ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) { const k = ((now / 2200 + i / 3 + b.phase) % 1); ctx.globalAlpha = (1 - k) * 0.95; ctx.fillStyle = '#e6b325'; ctx.font = `700 ${10 + k * 5}px ui-monospace,monospace`; ctx.fillText('z', x + 12 + k * 10, y - 28 - k * 16); }
    ctx.globalAlpha = 1;
    if (S.hover === b.id || S.selected === b.id || dk > 0.5) {
      ctx.font = '700 9px ui-monospace,monospace';
      const nm = b.name.replace('Boyd Family Times', 'Family Times').replace(' (archive)', ' ‹arch›');
      const tw = ctx.measureText(nm).width + 8; ctx.fillStyle = 'rgba(12,20,22,.88)'; ctx.fillRect(x - tw / 2, y + 4, tw, 12);
      ctx.fillStyle = '#e6b325'; ctx.fillText(nm, x, y + 13);
    }
  }
  const t = performance.now();
  S.pings = S.pings.filter(p => t - p.at < 2200);
  for (const p of S.pings) {
    const k = (t - p.at) / 2200, b = p.b, bx = tucked(b) ? b.home.x : b.x, by = tucked(b) ? b.home.y - 14 : b.y;
    ctx.strokeStyle = `rgba(230,179,37,${1 - k})`; ctx.lineWidth = 1; ctx.strokeRect(bx - 8 - k * 16, by - 8 - k * 16, 16 + k * 32, 16 + k * 32);
    ctx.globalAlpha = 1 - k; ctx.fillStyle = '#e6b325'; ctx.fillRect(bx + 10, by - 16 - k * 8, 6, 4); ctx.globalAlpha = 1;
  }
  const DUR = 1900;
  S.planes = S.planes.filter(p => t - p.at < DUR);
  for (const p of S.planes) {
    if (t < p.at) continue;
    const k = (t - p.at) / DUR, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const a = tucked(p.from) ? {x: p.from.home.x, y: p.from.home.y - 14} : p.from, z = tucked(p.to) ? {x: p.to.home.x, y: p.to.home.y - 14} : p.to;
    const mx = (a.x + z.x) / 2, my = Math.min(a.y, z.y) - 60 - Math.hypot(z.x - a.x, z.y - a.y) * 0.15;
    const q = (u) => ({x: (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * mx + u * u * z.x, y: (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * my + u * u * z.y});
    ctx.strokeStyle = `rgba(62,198,214,${0.75 * (1 - k)})`; ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.beginPath();
    for (let u = Math.max(0, e - 0.35); u <= e; u += 0.02) { const pt = q(u); u === Math.max(0, e - 0.35) ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y); }
    ctx.stroke(); ctx.setLineDash([]);
    const pt = q(e), nx = q(Math.min(1, e + 0.02)), ang = Math.atan2(nx.y - pt.y, nx.x - pt.x);
    ctx.save(); ctx.translate(pt.x, pt.y); ctx.rotate(ang);
    ctx.fillStyle = '#d7e2dc'; ctx.fillRect(-4, -2, 8, 4);
    ctx.fillStyle = '#3ec6d6'; ctx.fillRect(4, -1, 3, 2);
    ctx.fillStyle = '#e6b325';
    ctx.fillRect(-6, -5, 3, 2); ctx.fillRect(2, -5, 3, 2); ctx.fillRect(-6, 3, 3, 2); ctx.fillRect(2, 3, 3, 2);
    ctx.restore();
  }
}
// click the rocket to launch it (and it launches by itself at the usage reset)
cv.addEventListener('dblclick', ev => { const p = worldPos(ev), L = BUILDINGS.launchpad; if (Math.abs(p.x - L.x) < 30 && p.y < L.y && p.y > L.y - 140) launchRocket(); });
function launchRocket() { if (S.launchAt) return; S.launchAt = performance.now(); setTimeout(() => { S.launchAt = null; }, 9000); }
setInterval(() => { const r = Date.parse(S.data?.tokenFuel?.resetAtISO || ''); if (r && !S.launched && Date.now() >= r && Date.now() - r < 60e3) { S.launched = true; launchRocket(); } }, 1000);

// ---------- day report ("Island Gazette") ----------
const reportCache = {};
function dayReport(ds) {
  const key = ds + S.mode; if (reportCache[key]) return reportCache[key];
  const ev = S.allEvents.filter(e => e.t >= ds && e.t < ds + DAY);
  if (!ev.length) {
    const sched = [];
    for (const b of S.bots) for (const s of sessionsFor(b, ds)) if (s.kind === 'scheduled' || s.kind === 'observed') sched.push({b, s});
    sched.sort((a, b) => a.s.start - b.s.start);
    const gs = (S.data?.gameDays || []).filter(x => { const t = Date.parse(x.startET); return t >= ds && t < ds + DAY; });
    const g = gs.length ? {label: gs.map(x => `${x.label} at ${hm(Date.parse(x.startET))}`).join(' and '), startET: null} : null;
    return `<div class="gazette"><b>📰 Island Gazette · ${dayLabel(ds + 12 * HOUR)}</b><div>🗓️ Forecast: ${sched.length} shifts scheduled${sched.length ? `, first ${esc(sched[0].b.name)} at ${hm(sched[0].s.start)}, last ${esc(sched[sched.length - 1].b.name)} at ${hm(sched[sched.length - 1].s.start)}` : ''}</div>${g ? `<div>🏟️ Game day: ${esc(g.label)}. Idle bots head to the stadium</div>` : ''}<div class="small">No tool logs for this day on the box (local logs end Sep 16). Shifts come from schedules and observed rhythms.</div></div>`;
  }
  const by = {}, apps = {}, pairs = {}; let msgs = 0, boyd = 0, hosts = {};
  for (const e of ev) {
    by[e.bot] = (by[e.bot] || 0) + 1;
    if (e.type === 'dated_output' || e.type === 'routine_touch' || e.type === 'file_write') { if (e.type !== 'file_write') apps['Outputs'] = (apps['Outputs'] || 0) + 1; else apps['Files'] = (apps['Files'] || 0) + 1; }
    else if (e.type === 'agent_msg') { msgs++; const f = S.byId[e.from]?.name || '?', t = S.byId[e.bot]?.name || '?'; const k = [f, t].sort().join(' ↔ '); pairs[k] = (pairs[k] || 0) + 1; }
    else if (e.type === 'boyd_msg') boyd++;
    else apps[e.app] = (apps[e.app] || 0) + 1;
    if (e.host) hosts[e.host.replace(/^www\./, '')] = (hosts[e.host.replace(/^www\./, '')] || 0) + 1;
  }
  const top = (o, n = 1) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  const [busiest] = top(by), b = S.byId[busiest[0]];
  const first = ev[0], last = ev[ev.length - 1];
  const lines = [
    `🏆 Busiest: <b>${b ? b.emoji + ' ' + esc(b.name) : '?'}</b> (${busiest[1]} events)`,
    top(apps, 3).length ? `🧰 Top tools: ${top(apps, 3).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}` : '',
    msgs ? `✉️ ${msgs} bot-to-bot messages${top(pairs)[0] ? `, mostly ${esc(top(pairs)[0][0])}` : ''}` : '',
    boyd ? `📱 Boyd checked in ${boyd} time${boyd > 1 ? 's' : ''}` : '',
    top(hosts)[0] ? `🌐 Most visited: ${esc(top(hosts)[0][0])}` : '',
    `🌅 First stir ${hm(first.t)} (${esc(S.byId[first.bot]?.name || '')}) · 🌙 last ${hm(last.t)}`,
  ].filter(Boolean);
  return (reportCache[key] = `<div class="gazette"><b>📰 Island Gazette · ${dayLabel(ds + 12 * HOUR)}</b>${lines.map(l => `<div>${l}</div>`).join('')}</div>`);
}

// ---------- who-talks-to-whom overlay ----------
S.showNet = false;
function drawNetwork(ds) {
  const key = 'net' + ds;
  if (!reportCache[key]) {
    const all = S.mode === 'live';
    const pairs = {};
    for (const e of S.allEvents) { if (e.type !== 'agent_msg') continue; if (!all && (e.t < ds || e.t >= ds + DAY)) continue; const k = [e.from, e.bot].sort().join('|'); pairs[k] = (pairs[k] || 0) + 1; }
    reportCache[key] = pairs;
  }
  const pairs = reportCache[key], max = Math.max(1, ...Object.values(pairs));
  ctx.save(); ctx.lineCap = 'round';
  for (const [k, n] of Object.entries(pairs)) {
    const [a, b] = k.split('|').map(id => S.byId[id]); if (!a || !b) continue;
    const pa = a.home, pb = b.home;
    const mx = (pa.x + pb.x) / 2 + (PLAZA.x - (pa.x + pb.x) / 2) * 0.5, my = (pa.y + pb.y) / 2 + (PLAZA.y - (pa.y + pb.y) / 2) * 0.5;
    for (const [col, extra] of [['rgba(12,20,22,.7)', 3], [`rgba(62,198,214,${0.4 + 0.5 * n / max})`, 0]]) {
      ctx.strokeStyle = col; ctx.lineWidth = 1.5 + 7 * n / max + extra;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y - 14); ctx.quadraticCurveTo(mx, my, pb.x, pb.y - 14); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(15,23,42,.85)'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
    const q = {x: .25 * pa.x + .5 * mx + .25 * pb.x, y: .25 * pa.y + .5 * my + .25 * pb.y - 14};
    if (n / max > 0.15) { ctx.fillRect(q.x - 10, q.y - 8, 20, 13); ctx.fillStyle = '#e6b325'; ctx.fillText(n, q.x, q.y + 2); }
  }
  for (const b of S.bots) {
    ctx.font = '700 10px ui-monospace,monospace'; ctx.textAlign = 'center';
    const nm = `${b.emoji} ${b.name.replace('Boyd Family Times', 'Family Times').replace(' (archive)', ' ‹arch›')}`, tw = ctx.measureText(nm).width + 10;
    ctx.fillStyle = 'rgba(230,179,37,.95)'; ctx.fillRect(b.home.x - tw / 2, b.home.y - 48, tw, 13); ctx.fillStyle = '#1a1404'; ctx.fillText(nm, b.home.x, b.home.y - 38);
  }
  ctx.restore();
}
document.getElementById('netBtn').addEventListener('click', e => { S.showNet = !S.showNet; e.target.classList.toggle('on', S.showNet); e.target.textContent = S.showNet ? (S.mode === 'live' ? '✉️ All-time message map' : '✉️ This day\'s message map') : '✉️ Who talks to whom'; });
if (qs.get('net') === '1') { S.showNet = true; document.getElementById('netBtn').classList.add('on'); }

function togglePlaces() {
  const dir = document.getElementById('placesDir'); const btn = document.getElementById('placesBtn');
  if (!dir || !btn) return;
  dir.hidden = !dir.hidden; btn.classList.toggle('on', !dir.hidden);
  if (!dir.hidden) { renderPlacesDir._sig = ''; renderPlacesDir(); }
}
document.getElementById('placesBtn')?.addEventListener('click', togglePlaces);
if (qs.get('places') === '1') { const _pd = document.getElementById('placesDir'); if (_pd) { _pd.hidden = false; document.getElementById('placesBtn')?.classList.add('on'); } }
document.getElementById('placesDir')?.addEventListener('click', e => {
  const pl = e.target.closest('.pl'); if (!pl) return;
  const key = pl.dataset.focus; if (key) focusOn(key, 2.2);
});


// ---------- game days: idle bots pile into the stadium ----------
function currentGame(t) {
  for (const g of S.data?.gameDays || []) { const s = Date.parse(g.startET); if (t >= s - 20 * MIN && t <= s + (g.hours || 3) * HOUR) return g; }
  return null;
}
function nextGame(t) { let best = null; for (const g of S.data?.gameDays || []) { const s = Date.parse(g.startET); if (s > t && (!best || s < Date.parse(best.startET))) best = g; } return best; }
function stadiumSeat(b) {
  // fans sit in two rows along the front stands (lower arc) so they're drawn in front of the stadium
  const i = S.bots.indexOf(b), n = S.bots.length, st = BUILDINGS.stadium;
  const row = i % 2, k = Math.floor(i / 2), per = Math.ceil(n / 2);
  const a = Math.PI * (0.08 + 0.84 * (per > 1 ? k / (per - 1) : 0.5));
  const rx = row ? 84 : 66, ry = row ? 40 : 30;
  return {x: st.x + Math.cos(a) * rx, y: st.y + 4 + Math.sin(a) * ry};
}

// ---------- Boyd himself ----------
const BOYD = {x: 0, y: 0, tx: 0, ty: 0, what: '', home: {x: 712, y: 352}};
BUILDINGS.boyd = {x: 712, y: 352, name: "Boyd's Place", emoji: '🏠', decor: true};
function updateBoyd(t, dt) {
  if (!BOYD.x) { BOYD.x = BOYD.home.x; BOYD.y = BOYD.home.y + 8; }
  const recent = [];
  for (const b of S.bots) for (const e of S.eventsByBot[b.id] || []) if (e.type === 'boyd_msg' && e.t <= t && t - e.t < 6 * MIN) recent.push(e);
  recent.sort((a, b) => b.t - a.t);
  const p = etParts(t), night = p.h >= 23 || p.h < 6;
  if (recent.length) { const b = S.byId[recent[0].bot]; const bx = tucked(b) ? b.home.x : b.x, by = tucked(b) ? b.home.y : b.y; BOYD.tx = bx + 22; BOYD.ty = by + 4; BOYD.what = `📱 Chatting with ${b.name}`; BOYD.state = 'out'; }
  else if (S.game) { const st = BUILDINGS.stadium; BOYD.tx = st.x; BOYD.ty = st.y - 14; BOYD.what = `📣 Go ${S.game.label.split(' ')[0]}!`; BOYD.state = 'out'; }
  else if (night) { BOYD.tx = BOYD.home.x; BOYD.ty = BOYD.home.y + 4; BOYD.what = 'Asleep'; BOYD.state = 'sleep'; }
  else { BOYD.tx = BOYD.home.x + 18; BOYD.ty = BOYD.home.y + 14; BOYD.what = p.wd >= 1 && p.wd <= 5 && p.h >= 8 && p.h < 17 ? 'At KPD running AI ops' : 'Home with the family'; BOYD.state = 'home'; }
  const dx = BOYD.tx - BOYD.x, dy = BOYD.ty - BOYD.y, d = Math.hypot(dx, dy), sp = (90 + Math.min(S.speed, 1800) / 2.5) * dt;
  if (d > .5) { const k = Math.min(1, sp / d); BOYD.x += dx * k; BOYD.y += dy * k; BOYD.moving = d > 2; } else BOYD.moving = false;
}
function drawBoydHouse(now, dk) {
  const x = Math.round(BOYD.home.x), y = Math.round(BOYD.home.y);
  box(x, y, 48, 28, '#4a4458', '#2a2434');
  ctx.fillStyle = dk > .35 && BOYD.state !== 'sleep' ? '#e6b325' : '#141c1e';
  for (const wx of [-16, -8, 6, 14]) ctx.fillRect(x + wx, y - 16, 4, 3);
  flag(x + 26, y - 2, '#4c1d95', now, '#facc15');
  ctx.font = '700 10px ui-monospace,monospace'; ctx.textAlign = 'center';
  const t = "🏠 Boyd's Place", w = ctx.measureText(t).width + 10;
  ctx.fillStyle = 'rgba(12,20,22,.9)'; ctx.fillRect(x - w / 2, y + 6, w, 14);
  ctx.strokeStyle = '#e6b325'; ctx.strokeRect(x - w / 2, y + 6, w, 14);
  ctx.fillStyle = '#e7f0ea'; ctx.fillText(t, x, y + 16);
}
function drawBoyd(now) {
  if (BOYD.state === 'sleep' && Math.hypot(BOYD.x - BOYD.home.x, BOYD.y - BOYD.home.y - 4) < 4) return;
  const bob = BOYD.moving ? Math.abs(Math.sin(now / 120)) * 2 : 0;
  const x = Math.round(BOYD.x), y = Math.round(BOYD.y - bob);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x - 6, y + 10, 12, 3);
  const sw = BOYD.moving ? Math.round(Math.sin(now / 90) * 3) : 0;
  ctx.fillStyle = '#1c2422';
  ctx.fillRect(x - 4, y + 4, 3, 7); ctx.fillRect(x + 2, y + 4, 3, 7);
  ctx.fillRect(x - 5 + sw, y + 10, 4, 2); ctx.fillRect(x + 2 - sw, y + 10, 4, 2);
  ctx.fillStyle = '#4c1d95'; ctx.fillRect(x - 6, y - 8, 12, 12);
  ctx.fillStyle = '#e6b325'; ctx.font = 'bold 7px ui-monospace,monospace'; ctx.textAlign = 'center'; ctx.fillText('8', x, y);
  ctx.fillStyle = '#d7b48a'; ctx.fillRect(x - 4, y - 14, 8, 7);
  ctx.fillStyle = '#3a2a1c'; ctx.fillRect(x - 4, y - 16, 8, 3);
  ctx.font = '700 10px ui-monospace,monospace'; const tw = ctx.measureText('Boyd').width + 8;
  ctx.fillStyle = 'rgba(12,20,22,.9)'; ctx.fillRect(x - tw / 2, y + 14, tw, 12);
  ctx.fillStyle = '#e6b325'; ctx.fillText('Boyd', x, y + 23);
}

// ---------- cinema mode: loop the busiest real days at 30 min/s (great on a TV) ----------
if (qs.get('cinema') === '1') {
  const startCinema = () => {
    const counts = {}; for (const e of S.allEvents) { const k = etDayStart(e.t); counts[k] = (counts[k] || 0) + 1; }
    const days = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => +x[0]);
    let i = 0;
    const next = () => { document.getElementById('daySel').value = String(days[i % days.length]); setMode('replay'); S.t = S.replayDay + 5 * HOUR; setSpeed(1800); i++; };
    next();
    setInterval(() => { if (S.mode === 'replay' && S.t >= S.replayDay + 23.5 * HOUR) next(); }, 500);
    document.body.classList.add('cinema');
  };
  const wait = setInterval(() => { if (S.data) { clearInterval(wait); startCinema(); } }, 200);
}

// ---------- fleet health (pstack-style checks over metadata) ----------
function fleetHealth() {
  const out = [], now = Date.now();
  const lastSeen = (b) => { const ev = S.eventsByBot[b.id] || []; const t1 = ev.length ? ev[ev.length - 1].t : 0; const t2 = b.artifactUpdatedAt ? Date.parse(b.artifactUpdatedAt) : 0; return Math.max(t1, t2); };
  const names = {};
  for (const b of S.bots) for (const r of b.routines || []) (names[r.name] ||= []).push({b, r});
  for (const [n, list] of Object.entries(names)) if (list.length > 1) out.push({lvl: list.some(x => x.r.enabled === false) ? 'info' : 'warn', text: `“${n}” exists on ${list.map(x => `${x.b.name}${x.r.enabled === false ? ' (paused)' : ''}`).join(' and ')}`});
  for (const b of S.bots) {
    for (const r of b.routines || []) {
      const bad = (r.runs || []).filter(x => x.status && x.status !== 'ok');
      if (bad.length) out.push({lvl: 'warn', text: `${b.name}: ${bad.length} of ${r.runs.length} “${r.name}” runs didn't finish ok`});
      if (r.medianMinutes && r.medianMinutes > 12) out.push({lvl: 'info', text: `${b.name}: “${r.name}” takes ~${r.medianMinutes} min per run (heaviest routine)`});
    }
    const ls = lastSeen(b);
    const logEnd = S.allEvents.filter(e => e.type !== 'file_write').reduce((m, e) => Math.max(m, e.t), 0);
    if (!ls) out.push({lvl: 'info', text: `${b.name}: no activity logged on this box (lives server-side or idle)`});
    else if (logEnd - ls > 14 * DAY && now - ls > 14 * DAY && !(b.routines || []).some(r => r.enabled !== false)) out.push({lvl: 'info', text: `${b.name}: last active ${dayLabel(ls)}, ${Math.round((logEnd - ls) / DAY)} days before the local logs end, with no active routines. Retire it or give it a routine?`});
  }
  const egg = S.data.eggs || []; if (egg.length) out.push({lvl: 'info', text: `${egg.length} unhatched bot${egg.length > 1 ? 's' : ''} in the Hatchery (${egg.map(e => e.name).join(', ')}) with no persona yet`});
  out.push({lvl: 'info', text: `Local logs on this box end ${dayLabel(S.allEvents.filter(e => e.type !== 'file_write').reduce((m, e) => Math.max(m, e.t), 0))}. Newer activity lives server-side`});
  const order = {warn: 0, info: 1}; return out.sort((a, b) => order[a.lvl] - order[b.lvl]);
}
if (qs.get('health') === '1') document.getElementById('healthWrap').open = true;

// ---------- per-bot weekday × hour heatmap ----------
const heatCache = {};
function heatmap(b) {
  if (heatCache[b.id]) return heatCache[b.id];
  const grid = Array.from({length: 7}, () => Array(24).fill(0)); let max = 0;
  for (const e of S.eventsByBot[b.id] || []) { const p = etParts(e.t); max = Math.max(max, ++grid[p.wd][p.h]); }
  for (const r of b.routines || []) for (const run of r.runs || []) { const p = etParts(Date.parse(run.start)); max = Math.max(max, ++grid[p.wd][p.h]); }
  if (!max) return (heatCache[b.id] = '<div class="small">No logged activity on this box.</div>');
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let h = '<div class="heat">';
  for (let d = 0; d < 7; d++) { h += `<span class="hd">${days[d]}</span>`; for (let hr = 0; hr < 24; hr++) { const v = grid[d][hr]; h += `<i title="${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]} ${(hr % 12) || 12}${hr < 12 ? 'a' : 'p'}: ${v}" style="background:${v ? b.hex : '#1a2747'};opacity:${v ? 0.25 + 0.75 * Math.sqrt(v / max) : 1}"></i>`; } }
  h += '<span></span>' + [0, 6, 12, 18].map(x => `<span class="hx" style="grid-column:${x + 2} / span 6">${x === 0 ? '12a' : x === 12 ? '12p' : x < 12 ? x + 'a' : (x - 12) + 'p'}</span>`).join('') + '</div>';
  return (heatCache[b.id] = h);
}

// ---------- timeline hover tooltips ----------
tl.addEventListener('mousemove', ev => {
  if (dragging) return;
  const r = tl.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, x0 = TL.left, x1 = r.width - 10;
  const rows = [...S.bots].sort((a, b) => a.name.localeCompare(b.name)); const i = Math.floor((y - TL.top) / TL.row);
  const tt = document.getElementById('tltip'); const b = rows[i];
  if (!b || x < x0) { tt.hidden = true; return; }
  const ds = etDayStart(S.t), t = ds + (x - x0) / (x1 - x0) * DAY;
  const s = sessionsFor(b, ds).find(s => t >= s.start - 4 * MIN && t <= s.end + 4 * MIN);
  if (!s) { tt.hidden = true; return; }
  tt.innerHTML = `<b>${b.emoji} ${esc(b.name)}</b> · ${hm(s.start)}–${hm(s.end)}<br>${s.kind === 'actual' ? '⚡ ' + esc(s.label) + ` (${s.events.length} events)` : s.kind === 'run' ? '✅ ran “' + esc(s.label) + '”' : s.kind === 'observed' ? '👀 ' + esc(s.label) : '⏰ scheduled “' + esc(s.label) + '”'}`;
  tt.hidden = false; tt.style.left = Math.min(ev.clientX + 12, innerWidth - 300) + 'px'; tt.style.top = (ev.clientY - 50) + 'px';
});
tl.addEventListener('mouseleave', () => { document.getElementById('tltip').hidden = true; });
// click a building → open the card of the bot who works there
cv.addEventListener('click', ev => { if (pan && pan.moved) return; const p = worldPos(ev); if (hitBot(p)) return; const hb = hitBuilding(p); if (hb) { const who = S.bots.filter(o => o.building === hb[0]); if (who.length) select((who.find(o => o.state === 'work') || who[0]).id); } });

// ---------- zoom (wheel) & pan (drag) ----------
function applyCam() { const r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; const s = Math.min(r.width / W, r.height / H) * cam.z; const cx = (r.width - W * s) / 2 + cam.x, cy = (r.height - H * s) / 2 + cam.y; view = {s: s * dpr, ox: cx * dpr, oy: cy * dpr, css: s, cssOx: cx, cssOy: cy}; }
cv.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const before = {x: (mx - view.cssOx) / view.css, y: (my - view.cssOy) / view.css};
  cam.z = Math.max(1, Math.min(4, cam.z * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
  if (cam.z === 1) { cam.x = 0; cam.y = 0; applyCam(); return; }
  applyCam();
  cam.x += mx - (before.x * view.css + view.cssOx); cam.y += my - (before.y * view.css + view.cssOy); applyCam();
}, {passive: false});
let pan = null;
cv.addEventListener('pointerdown', ev => { if (cam.z > 1) pan = {x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y, moved: false}; });
window.addEventListener('pointermove', ev => { if (!pan) return; const dx = ev.clientX - pan.x, dy = ev.clientY - pan.y; if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true; cam.x = pan.cx + dx; cam.y = pan.cy + dy; applyCam(); cv.style.cursor = 'grabbing'; });
window.addEventListener('pointerup', () => { if (pan) { cv.style.cursor = 'default'; setTimeout(() => { pan = null; }, 0); } });
document.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; if (e.key === '0' || e.key === 'r') { cam.z = 1; cam.x = 0; cam.y = 0; applyCam(); } if (e.key === '+' || e.key === '=') { cam.z = Math.min(4, cam.z * 1.25); applyCam(); } if (e.key === '-') { cam.z = Math.max(1, cam.z / 1.25); if (cam.z === 1) { cam.x = 0; cam.y = 0; } applyCam(); } if (e.key === 'n') document.getElementById('netBtn').click(); if (e.key === 'p') togglePlaces(); if (e.key === 'l') setMode('live'); });

// ---------- optional sound: soft chimes when a bot clocks in, whoosh for messages ----------
S.sound = false; let actx = null;
function blip(freq, dur = 0.12, type = 'sine', vol = 0.05) {
  if (!S.sound) return; actx ||= new (window.AudioContext || window.webkitAudioContext)();
  const o = actx.createOscillator(), g = actx.createGain(); o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
}
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
setInterval(() => {
  if (!S.sound) return;
  for (const b of S.bots) { if (b.changed && performance.now() - b.changed < 450 && b.state === 'work' && !b.chimed) { b.chimed = true; blip(PENTA[S.bots.indexOf(b) % PENTA.length], 0.25, 'triangle', 0.06); } if (b.state !== 'work') b.chimed = false; }
}, 150);
document.getElementById('soundBtn').addEventListener('click', e => { S.sound = !S.sound; e.target.textContent = S.sound ? '🔊' : '🔈'; if (S.sound) blip(784, 0.2, 'triangle'); });
// deep link: ?focus=<building key>&zoom=2.5
function focusOn(key, z) {
  const b = BUILDINGS[key]; if (!b) return; cam.z = z || 2.5; cam.x = 0; cam.y = 0; applyCam();
  const r = cv.parentElement.getBoundingClientRect();
  cam.x = r.width / 2 - (b.x * view.css + view.cssOx); cam.y = r.height / 2 - ((b.y - 30) * view.css + view.cssOy); applyCam();
}
if (qs.get('focus')) { const wait2 = setInterval(() => { if (S.data && view.css) { clearInterval(wait2); focusOn(qs.get('focus'), +(qs.get('zoom') || 2.5)); } }, 100); }

// ================= tabs =================
S.tab = 'island';
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.getElementById('islandView').hidden = t !== 'island';
  document.getElementById('doctorView').hidden = t !== 'doctor';
  document.getElementById('statsView').hidden = t !== 'stats';
  document.body.className = document.body.className.replace(/\btab-\w+/g, '').trim() + ' tab-' + t;
  if (t === 'island') { resize(); }
  if (t === 'doctor') renderDoctor();
  if (t === 'stats') renderShipIt();
  if (history.replaceState) { const u = new URL(location.href); if (t === 'island') u.searchParams.delete('tab'); else u.searchParams.set('tab', t); history.replaceState(null, '', u); }
}
document.getElementById('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });

// ================= Fleet Doctor =================
async function loadDoctor() {
  if (window.BOT_ISLAND_DOCTOR) return (DOC = window.BOT_ISLAND_DOCTOR);
  const r = await fetch('/api/doctor', {cache: 'no-store'}); DOC = await r.json(); return DOC;
}
function gotoBot(name) { const b = S.bots.find(x => x.name === name); if (!b) return; setTab('island'); if (S.selected !== b.id) select(b.id); }
async function renderDoctor() {
  const el = document.getElementById('doctorView');
  if (!DOC) { el.innerHTML = '<div class="vcard">Examining the fleet…</div>'; try { await loadDoctor(); } catch (e) { el.innerHTML = `<div class="vcard">Couldn't load Fleet Doctor: ${esc(e.message)}</div>`; return; } }
  const d = DOC, c = d.counts, col = d.score >= 75 ? '#4ade80' : d.score >= 50 ? '#fbbf24' : '#f87171';
  const R = 74, C = 2 * Math.PI * R;
  const cats = Object.entries(d.categories);
  const fs = d.findings.filter(f => docFilter === 'all' || f.category === docFilter);
  const botLink = (txt, bot) => bot && S.bots.some(b => b.name === bot) ? txt.replace(bot, `<span class="who" data-bot="${esc(bot)}">${esc(bot)}</span>`) : txt;
  el.innerHTML = `<div class="vgrid">
    <div>
      <div class="vcard"><h2>Fleet health</h2>
        <div class="ring"><svg width="170" height="170"><circle cx="85" cy="85" r="${R}" stroke="#1f2c4d" stroke-width="14" fill="none"/><circle cx="85" cy="85" r="${R}" stroke="${col}" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="${C * d.score / 100} ${C}"/></svg>
          <div class="v"><div><b style="color:${col}">${d.score}</b><br><span>out of 100</span></div></div></div>
        <div class="sevrow"><span class="sv high">${c.high} high</span><span class="sv medium">${c.medium} medium</span><span class="sv low">${c.low} low</span><span class="sv info">${c.info} info</span></div>
        <p class="small" style="margin:12px 0 0">Read-only checks over routines, run history, tool logs, messages and output files. Nothing is changed. Logs on this box run through ${esc(dayLabel(Date.parse(d.logEnd)))}.</p>
        ${window.BOT_ISLAND_DOCTOR_HTML ? `<button class="btnlink" id="docOpen">📄 Open weekly report</button>` : `<a class="btnlink" href="/api/doctor/report" target="_blank">📄 Open weekly report</a>`}
        <p class="small" style="margin:8px 0 0">CLI: <code>python3 doctor.py</code> → <code>reports/fleet-health-&lt;date&gt;.html</code></p>
      </div>
      <div class="vcard" style="margin-top:14px"><h2>By category</h2>${cats.map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:4px 0"><span>${esc(v)}</span><b>${d.findings.filter(f => f.category === k).length}</b></div>`).join('')}</div>
    </div>
    <div>
      <div class="vcard"><h2>Findings &amp; fixes</h2>
        <div class="filters"><button class="chip ${docFilter === 'all' ? 'on' : ''}" data-f="all">All ${d.findings.length}</button>${cats.map(([k, v]) => `<button class="chip ${docFilter === k ? 'on' : ''}" data-f="${k}">${esc(v)}</button>`).join('')}</div>
        ${fs.map(f => `<div class="finding"><span class="sv ${f.severity}">${f.severity}</span><div><b>${botLink(esc(f.title), f.bot)}</b><div class="d">${esc(f.detail)}</div><div class="fx">💊 ${esc(f.fix)}</div></div></div>`).join('') || '<div class="small">Nothing in this category. 🎉</div>'}
      </div>
      <div class="vcard" style="margin-top:14px"><h2>Routines, heaviest first</h2>
        <table class="t"><tr><th>Bot</th><th>Routine</th><th>Schedule</th><th class="num">Runs</th><th class="num">OK</th><th class="num">Min/run</th><th class="num">Agent-min/wk</th><th class="num">Tools/run</th><th class="num">On schedule</th></tr>
        ${[...d.routines].sort((a, b) => b.minutesPerWeek - a.minutesPerWeek).map(r => `<tr><td><span class="who" data-bot="${esc(r.bot)}">${esc(r.bot)}</span></td><td>${esc(r.name)}${r.enabled === false ? ' <span class="pill">paused</span>' : ''}</td><td>${esc(cronHuman(r.cron))}</td><td class="num">${r.runs}</td><td class="num">${r.ok}/${r.runs}</td><td class="num">${r.medianMinutes || '–'}</td><td class="num">${Math.round(r.minutesPerWeek)}</td><td class="num">${Math.round(r.toolCallsPerRun)}</td><td class="num">${r.expected ? r.hit + '/' + r.expected : '–'}</td></tr>`).join('')}</table>
      </div>
    </div></div>`;
  el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { docFilter = b.dataset.f; renderDoctor(); });
  el.querySelectorAll('.who').forEach(w => w.onclick = () => gotoBot(w.dataset.bot));
  const o = document.getElementById('docOpen'); if (o) o.onclick = () => { const u = URL.createObjectURL(new Blob([window.BOT_ISLAND_DOCTOR_HTML], {type: 'text/html'})); window.open(u, '_blank'); };
}

// ================= Ship-it Stats =================
function shipItData() {
  const days = {}, perBot = {}, sent = {}, boyd = {}, runs = {}, tools = {}, outputs = {};
  const dayKey = (t) => etDayKey(t);
  const outMin = new Set();
  for (const e of S.allEvents) {
    const k = dayKey(e.t); days[k] = (days[k] || 0) + 1;
    const pb = (perBot[e.bot] ||= {}); pb[k] = (pb[k] || 0) + 1;
    if (e.type === 'agent_msg') sent[e.from] = (sent[e.from] || 0) + 1;
    else if (e.type === 'boyd_msg') boyd[e.bot] = (boyd[e.bot] || 0) + 1;
    else if (e.type === 'mcp_tool_call' || e.type === 'shell_command' || e.type === 'browser_navigation' || e.type === 'computer_use_session') tools[e.bot] = (tools[e.bot] || 0) + 1;
    else if (e.type === 'file_write' || e.type === 'dated_output') { const kk = e.bot + k; if (!outMin.has(kk)) { outMin.add(kk); outputs[e.bot] = (outputs[e.bot] || 0) + 1; } }
  }
  for (const b of S.bots) for (const r of b.routines || []) for (const x of r.runs || []) { if (x.status === 'ok') runs[b.id] = (runs[b.id] || 0) + 1; const k = dayKey(Date.parse(x.start)); const pb = (perBot[b.id] ||= {}); pb[k] = (pb[k] || 0) + 1; days[k] = (days[k] || 0) + 1; }
  const allDays = []; const keys = Object.keys(days).sort(); if (!keys.length) return null;
  for (let t = etDayStart(Date.parse(keys[0] + 'T12:00:00-04:00')); t <= etDayStart(Date.now()); t += DAY) allDays.push(etDayKey(t + 12 * HOUR));
  const uniq = [...new Set(allDays)];
  const streaks = {};
  for (const b of S.bots) {
    const pb = perBot[b.id] || {}; let cur = 0, best = 0, run = 0;
    for (const k of uniq) { if (pb[k]) { run++; best = Math.max(best, run); } else run = 0; }
    for (let i = uniq.length - 1; i >= 0 && pb[uniq[i]]; i--) cur++;
    streaks[b.id] = {cur, best};
  }
  return {days, perBot, sent, boyd, runs, tools, outputs, allDays: uniq, streaks};
}
function renderShipIt() {
  const el = document.getElementById('statsView'), D = shipItData();
  if (!D) { el.innerHTML = '<div class="vcard">No activity yet.</div>'; return; }
  const name = (id) => { const b = S.byId[id]; return b ? `${b.emoji} ${esc(b.name)}` : '?'; };
  const last30 = D.allDays.slice(-30);
  const ship = (id) => (D.runs[id] || 0) + (D.outputs[id] || 0) + (D.sent[id] || 0);
  const total30 = S.bots.reduce((n, b) => n + last30.reduce((m, k) => m + ((D.perBot[b.id] || {})[k] || 0), 0), 0);
  const totalShip = S.bots.reduce((n, b) => n + ship(b.id), 0);
  const totTools = Object.values(D.tools).reduce((a, b) => a + b, 0), totMsg = Object.values(D.sent).reduce((a, b) => a + b, 0), totRuns = Object.values(D.runs).reduce((a, b) => a + b, 0);
  let best = {v: 0}; for (const b of S.bots) for (const [k, v] of Object.entries(D.perBot[b.id] || {})) if (v > best.v) best = {v, k, id: b.id};
  const board = (title, obj, unit) => { const rows = Object.entries(obj).filter(([id]) => S.byId[id]).sort((a, b) => b[1] - a[1]).slice(0, 5); return `<div class="vcard board"><h2>${title}</h2><ol>${rows.map(([id, v], i) => `<li>${i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : ''}${name(id)} <b>${v.toLocaleString()}${unit ? ' ' + unit : ''}</b></li>`).join('') || '<li class="small">—</li>'}</ol></div>`; };
  const shipObj = Object.fromEntries(S.bots.map(b => [b.id, ship(b.id)]));
  const streakCur = Object.fromEntries(S.bots.map(b => [b.id, D.streaks[b.id].cur]).filter(x => x[1]));
  const streakBest = Object.fromEntries(S.bots.map(b => [b.id, D.streaks[b.id].best]).filter(x => x[1]));
  // matrix: bots × days
  const days = D.allDays.slice(-49), rows = [...S.bots].sort((a, b) => ship(b.id) - ship(a.id));
  const max = Math.max(1, ...rows.flatMap(b => days.map(k => (D.perBot[b.id] || {})[k] || 0)));
  let m = `<div class="matrix" style="grid-template-columns:170px repeat(${days.length},1fr) 70px">`;
  m += '<span></span>' + days.map((k, i) => `<span class="dl">${i % 7 === 0 ? k.slice(5).replace('-', '/') : ''}</span>`).join('') + '<span class="dl">streak</span>';
  for (const b of rows) {
    m += `<span class="lbl who" data-bot="${esc(b.name)}" style="text-decoration:none">${b.emoji} ${esc(b.name.replace('Boyd Family Times', 'Family Times'))}</span>`;
    m += days.map(k => { const v = (D.perBot[b.id] || {})[k] || 0; return `<i title="${esc(b.name)} · ${k}: ${v}" style="background:${v ? b.hex : '#17233f'};opacity:${v ? 0.3 + 0.7 * Math.sqrt(v / max) : 1}"></i>`; }).join('');
    const st = D.streaks[b.id]; m += `<span class="dl streak">${st.cur ? '🔥 ' + st.cur + 'd' : '–'}${st.best > st.cur ? ` · best ${st.best}` : ''}</span>`;
  }
  m += '</div>';
  const fleetDays = D.allDays.slice(-49), fmax = Math.max(1, ...fleetDays.map(k => D.days[k] || 0));
  const today = etDayStart(Date.now()), tev = S.allEvents.filter(e => e.t >= today && e.t < today + DAY);
  const tb = {}; for (const e of tev) { const x = (tb[e.bot] ||= {n: 0, first: e.t, last: e.t, kinds: new Set()}); x.n++; x.first = Math.min(x.first, e.t); x.last = Math.max(x.last, e.t); x.kinds.add(e.type === 'file_write' ? 'files' : e.type === 'dated_output' ? 'daily output' : e.type === 'routine_touch' ? 'routine' : e.type.replace(/_/g, ' ')); }
  const ed = (S.data.editions || []).find(x => x.date === etDayKey(Date.now()));
  const pending = []; for (const b of S.bots) for (const s of sessionsFor(b, today)) if (s.start > Date.now() && s.kind !== 'actual') pending.push({b, s});
  pending.sort((a, b) => a.s.start - b.s.start);
  const shippedToday = `<div class="vcard" style="margin-bottom:14px"><h2>📦 Shipped today · ${dayLabel(Date.now())}</h2>
    <table class="t"><tr><th>Bot</th><th>What</th><th>First</th><th>Last</th><th class="num">Events</th></tr>
    ${Object.entries(tb).sort((a, b) => a[1].first - b[1].first).map(([id, x]) => `<tr><td>${name(id)}</td><td>${esc([...x.kinds].join(', '))}${id === 'newspaper' || (S.byId[id]?.name === 'Boyd Family Times' && ed) ? ` · edition ${ed ? esc(ed.print === 'printed' ? 'printed 🖨️' : ed.print) : ''}` : ''}</td><td>${hm(x.first)}</td><td>${hm(x.last)}</td><td class="num">${x.n}</td></tr>`).join('') || '<tr><td colspan="5" class="small">Nothing yet today.</td></tr>'}
    </table>${pending.length ? `<p class="small" style="margin:8px 0 0">Still to come: ${pending.slice(0, 6).map(({b, s}) => `${hm(s.start)} ${b.emoji} ${esc(b.name)}`).join(' · ')}</p>` : ''}</div>`;
  el.innerHTML = `
    <p class="hero">The fleet shipped <em>${totalShip.toLocaleString()}</em> things: ${totRuns} routine runs, ${Object.values(D.outputs).reduce((a, b) => a + b, 0)} days of published output and ${totMsg} bot-to-bot handoffs, backed by <em>${totTools.toLocaleString()}</em> tool calls.</p>
    <div class="kpis">
      <div class="kpi"><b>${total30.toLocaleString()}</b><span>events in the last 30 days</span></div>
      <div class="kpi"><b>${name(Object.entries(shipObj).sort((a, b) => b[1] - a[1])[0][0])}</b><span>MVP (most shipped)</span></div>
      <div class="kpi"><b>${best.id ? name(best.id) : '–'}</b><span>busiest single day: ${best.v} events on ${best.k ? dayLabel(Date.parse(best.k + 'T12:00:00-04:00')) : ''}</span></div>
      <div class="kpi"><b>${Math.max(0, ...Object.values(streakBest))} days</b><span>longest streak (${name(Object.entries(streakBest).sort((a, b) => b[1] - a[1])[0]?.[0])})</span></div>
    </div>
    ${shippedToday}
    <div class="vcard"><h2>Daily activity per bot (last ${days.length} days) · darker = busier · 🔥 = current streak</h2>${m}
      <h2 style="margin-top:16px">Whole fleet per day</h2><div class="bars">${fleetDays.map(k => `<i title="${k}: ${D.days[k] || 0}" style="height:${100 * (D.days[k] || 0) / fmax}%"></i>`).join('')}</div>
      <p class="small" style="margin:8px 0 0">Aug 20 – Sep 16 come from full tool logs. After that, only outputs and the edition log are available on this box, so later days look quieter than they really were.</p></div>
    <div class="boards">
      ${board('🚢 Most shipped', shipObj)}
      ${board('🧰 Tool calls', D.tools)}
      ${board('✅ Routine runs completed', D.runs)}
      ${board('✉️ Handoffs sent to other bots', D.sent)}
      ${board('📱 Chats with Boyd', D.boyd)}
      ${board('🔥 Current streak (days)', streakCur, 'd')}
    </div>`;
  el.querySelectorAll('.who').forEach(w => w.onclick = () => gotoBot(w.dataset.bot));
}
loadDoctor().catch(() => {});
setInterval(() => { if (!window.BOT_ISLAND_DOCTOR) fetch('/api/doctor', {cache: 'no-store'}).then(r => r.json()).then(d => { DOC = d; if (S.tab === 'doctor') renderDoctor(); }).catch(() => {}); }, 120000);
if (qs.get('tab')) { const wt = setInterval(() => { if (S.data) { clearInterval(wt); setTab(qs.get('tab')); } }, 100); }

// deterministic stepping for the timelapse renderer (make_timelapse.sh): advance sim time in small sub-steps so bots walk between frames
window.botIslandStep = function (simMinutes, sub = 12) {
  const dt = 1 / 30;
  for (let i = 0; i < sub; i++) {
    S.t += simMinutes * MIN / sub;
    if (S.mode === 'replay' && S.t >= S.replayDay + DAY) S.t = S.replayDay + DAY - MIN;
    updateBots(S.t, dt); updateBoyd(S.t, dt); pumpTicker();
  }
  draw(performance.now()); renderUi();
  return hm(S.t);
};
