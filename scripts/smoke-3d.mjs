import { writeFile } from 'node:fs/promises';

const endpoint = process.argv[2] || 'http://127.0.0.1:9222';
const screenshotPath = process.argv[3] || 'design/xiaoci-3d-preview.png';
const facing = Number(process.argv[4]);
const avatarState = process.argv[5];
const audioLevel = Number(process.argv[6]);
const settleMs = Number(process.argv[7]) || 350;
const pages = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const page = pages.find((entry) => entry.type === 'page' && entry.url.includes('127.0.0.1'));
if (!page) throw new Error('Local test page was not found in Chrome.');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function call(method, params = {}) {
  const id = ++requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await call('Runtime.enable');
await call('Page.enable');
let state = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const result = await call('Runtime.evaluate', {
    expression: `({
      bodyClass: document.body.className,
      ready: Boolean(window.xiaoci3d?.ready),
      modelCanvas: document.getElementById('char3d')?.toDataURL().length || 0,
      modelResponse: performance.getEntriesByName(new URL('models/xiaoci-rigged-v2.glb', location.href).href)[0]?.responseStatus || 0
    })`,
    returnByValue: true
  });
  state = result.result.value;
  if (state.ready || state.bodyClass.includes('three-fallback')) break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

console.log(JSON.stringify(state, null, 2));
if (!state?.ready || !state.bodyClass.includes('three-ready')) {
  throw new Error('The rigged character did not reach the ready state.');
}

if (Number.isFinite(facing)) await call('Runtime.evaluate', { expression: `window.xiaoci3d.setFacing(${facing})` });
if (['idle', 'listening', 'thinking', 'speaking'].includes(avatarState)) {
  await call('Runtime.evaluate', {
    expression: `window.xiaoci3d.setState(${JSON.stringify(avatarState)}); window.xiaoci3d.stateChangedAt = performance.now()`
  });
}
if (Number.isFinite(audioLevel)) {
  await call('Runtime.evaluate', { expression: `window.xiaoci3d.setAudioLevel(${audioLevel})` });
}
await new Promise((resolve) => setTimeout(resolve, settleMs));

const capture = await call('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,
  fromSurface: true
});
await writeFile(screenshotPath, Buffer.from(capture.data, 'base64'));
socket.close();
await new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }));
