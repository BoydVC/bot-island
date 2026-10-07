// Timelapse renderer: one headless Chrome page, sim time stepped deterministically so bots visibly walk.
// Usage: node --experimental-websocket timelapse.mjs <port> <day YYYY-MM-DD> <fromHour> <toHour> <stepMinutes> <outDir>
import {spawn} from 'node:child_process';
import {writeFileSync, mkdirSync} from 'node:fs';
const [port = '4747', day = '2026-09-14', from = '4.5', to = '23.5', step = '5', out = '/tmp/tl'] = process.argv.slice(2);
mkdirSync(out, {recursive: true});
const dbg = 9900 + Math.floor(Math.random() * 300);
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${dbg}`, '--window-size=1600,1240', '--force-device-scale-factor=1', `--user-data-dir=/tmp/bot-island-tl-${dbg}`, 'about:blank'], {stdio: 'ignore'});
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); });
const ev = async (expr) => (await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true})).result?.result?.value;
try {
  let url; for (let i = 0; i < 50 && !url; i++) { try { url = (await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(x => x.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!url) await sleep(200); }
  ws = new WebSocket(url); await new Promise(r => ws.onopen = r);
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1240, deviceScaleFactor: 1, mobile: false});
  await send('Page.navigate', {url: `http://127.0.0.1:${port}/?mode=replay&day=${day}&hour=${from}&play=0&net=0&speed=1800`});
  for (let i = 0; i < 40 && !(await ev('!!(window.S && S.data && window.botIslandStep)')); i++) await sleep(250);
  await ev('setSpeed(1800); S.playing = false; null'); await sleep(300);
  await ev('botIslandStep(0, 60)');  // settle bots at their starting spots
  const n = Math.round((parseFloat(to) - parseFloat(from)) * 60 / parseFloat(step));
  for (let i = 0; i <= n; i++) {
    const t = await ev(`botIslandStep(${i ? step : 0})`);
    const shot = await send('Page.captureScreenshot', {format: 'png'});
    writeFileSync(`${out}/f${String(i).padStart(4, '0')}.png`, Buffer.from(shot.result.data, 'base64'));
    if (i % 24 === 0) console.log(`frame ${i}/${n} · ${t}`);
  }
} finally { try { ws?.close(); } catch {} chrome.kill('SIGKILL'); }
