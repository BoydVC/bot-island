// Smoke test: drives headless Chrome over CDP, exercises every mode/control, fails on any page error.
// Usage: node tests/smoke.mjs [port]
import {spawn} from 'node:child_process';
const port = process.argv[2] || '4747', dbg = 9333 + Math.floor(Math.random() * 500);
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, '--window-size=1600,1240', `--user-data-dir=/tmp/bot-island-smoke-${dbg}`, 'about:blank'], {stdio: 'ignore'});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(), errors = [];
async function connect() {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${dbg}/json`); const t = (await r.json()).find(x => x.type === 'page'); if (t) return t.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error('chrome did not start');
}
function send(method, params = {}) { return new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); }); }
async function ev(expr) { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error'); return r.result?.result?.value; }
const checks = [];
function check(name, ok, detail = '') { checks.push({name, ok: !!ok, detail}); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`); }
try {
  ws = new WebSocket(await connect());
  await new Promise(r => ws.onopen = r);
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push(d.params.entry.text); };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', {url: `http://127.0.0.1:${port}/`}); await sleep(2500);
  check('fleet loaded', await ev('S.bots.length') >= 10, `${await ev('S.bots.length')} bots, ${await ev('S.allEvents.length')} events`);
  check('every bot has a home + workplace', await ev('S.bots.every(b => b.home && b.work)'));
  const fps = await ev('new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(Math.round(n / 2)); }; requestAnimationFrame(f); })');
  check('animation running', fps > 10, `${fps} fps headless`);
  check('live clock ≈ now', await ev('Math.abs(S.t - Date.now()) < 5000'));
  await ev(`document.querySelector('#modeSeg [data-mode=replay]').click()`); await sleep(800);
  check('replay mode', await ev(`S.mode === 'replay' && S.speed === 300`), await ev('document.getElementById("daySel").selectedOptions[0].textContent'));
  await ev(`(() => { const s = document.getElementById('daySel'); s.value = String(etDayStart(Date.parse('2026-09-14T12:00:00-04:00'))); s.dispatchEvent(new Event('change')); S.t = S.replayDay + 8.72 * HOUR; setSpeed(1); })()`); await sleep(1200);
  check('morning rush has working bots', await ev(`S.bots.filter(b => b.state === 'work').length`) >= 2, (await ev(`S.bots.filter(b => b.state === 'work').map(b => b.name + ': ' + b.what).join(' | ')`)));
  check('gazette written', (await ev(`document.querySelector('.gazette')?.textContent || ''`)).includes('Busiest'));
  await ev(`document.querySelector('#speedSeg [data-speed="1800"]').click()`); await sleep(2500);
  check('fast-forward advances time', await ev(`S.t > S.replayDay + 9 * HOUR`), await ev('hm(S.t)'));
  check('ticker populated', await ev(`document.querySelectorAll('#ticker li').length`) > 2);
  await ev(`document.getElementById('netBtn').click()`); await sleep(300);
  check('network overlay toggles', await ev('S.showNet === true'));
  await ev(`select(S.bots.find(b => b.name === 'Pam').id)`); await sleep(600);
  check('bot card opens with heatmap', await ev(`!document.getElementById('detail').hidden && !!document.querySelector('#detail .heat')`));
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))`); await sleep(200);
  check('esc closes card', await ev(`document.getElementById('detail').hidden`));
  await ev(`document.getElementById('healthWrap').open = true`); await sleep(600);
  check('health check renders', await ev(`document.querySelectorAll('#healthCard .hl').length`) > 0, await ev(`document.querySelectorAll('#healthCard .hl').length + ' findings'`));
  await ev(`(() => { const r = tl.getBoundingClientRect(); const o = {clientX: r.left + TL.left + (r.width - TL.left - 10) * 0.5, clientY: r.top + 40, pointerId: 1, bubbles: true}; tl.dispatchEvent(new PointerEvent('pointerdown', o)); tl.dispatchEvent(new PointerEvent('pointerup', o)); })()`); await sleep(300);
  check('timeline scrub jumps to noon', await ev(`Math.abs(etParts(S.t).h - 12) <= 1`), await ev('hm(S.t)'));
  await ev(`document.querySelector('#modeSeg [data-mode=live]').click()`); await sleep(500);
  check('back to live', await ev(`S.mode === 'live' && Math.abs(S.t - Date.now()) < 5000`));
  await ev(`S.t = Date.parse('2026-10-11T21:00:00-04:00'); setSpeed(60)`); await sleep(800);
  check('game day fills stadium', await ev(`!!S.game && S.bots.filter(b => b.what.startsWith('📣')).length > 3`), await ev('S.game?.label'));
  await ev(`S.t = Date.parse('2026-10-08T02:30:00-04:00')`); await sleep(800);
  check('night: bots asleep', await ev(`S.bots.filter(b => b.state === 'sleep').length`) >= 10);
  await ev(`launchRocket()`); await sleep(300);
  check('rocket launches', await ev('!!S.launchAt'));
  check('game watch lists real fixtures', (await ev(`(() => { S.t = Date.parse('2026-10-08T09:00:00-04:00'); setSpeed(1); renderStats(); return document.querySelector('.gazette.upnext:last-of-type')?.textContent || document.getElementById('statsCard').textContent; })()`)).includes('Terps @ Ohio State'));
  await ev(`setTab('doctor')`); await sleep(1200);
  check('Fleet Doctor tab renders', await ev(`!document.getElementById('doctorView').hidden && document.querySelectorAll('#doctorView .finding').length > 3`), await ev(`DOC ? DOC.score + '/100, ' + DOC.findings.length + ' findings' : 'no doc'`));
  check('every finding has a fix', await ev(`DOC.findings.every(f => f.fix && f.fix.length > 10)`));
  await ev(`document.querySelector('#doctorView [data-f=failing]')?.click()`); await sleep(200);
  check('doctor filter works', await ev(`[...document.querySelectorAll('#doctorView .finding')].length === DOC.findings.filter(f => f.category === 'failing').length`));
  await ev(`setTab('stats')`); await sleep(600);
  check('Ship-it Stats renders', await ev(`!document.getElementById('statsView').hidden && document.querySelectorAll('#statsView .matrix i').length > 100 && document.querySelectorAll('#statsView .board').length === 6`), await ev(`document.querySelector('#statsView .hero')?.textContent.slice(0, 80)`));
  await ev(`setTab('island')`); await sleep(400);
  check('back to island tab', await ev(`!document.getElementById('islandView').hidden && document.getElementById('island').getBoundingClientRect().width > 300`));
  const doc = await (await fetch(`http://127.0.0.1:${port}/api/doctor`)).json();
  check('api doctor', typeof doc.score === 'number' && doc.findings.length > 0, `${doc.score}/100`);
  const rep = await (await fetch(`http://127.0.0.1:${port}/api/doctor/report`)).text();
  check('weekly report HTML', rep.includes('<html') && rep.length > 3000, `${Math.round(rep.length / 1024)} KB`);
  const api = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
  check('api health', api.ok, `snapshot ${api.snapshotAge}s old`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
} catch (e) { check('test harness', false, e.message); }
finally { try { ws?.close(); } catch {} chrome.kill('SIGKILL'); }
const failed = checks.filter(c => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
