import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Connect only to the disposable Chromium profile launched by the a11y runner.
export async function createKeyboardDriver(profile, target) {
  const until = Date.now() + 10000;
  let endpoint;
  while (Date.now() < until) {
    try {
      const port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
      endpoint = pages.find(page => page.type === 'page' && page.url === target)?.webSocketDebuggerUrl;
      if (endpoint) break;
    } catch { /* The owned browser may still be creating its page. */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(endpoint, 'Owned Chromium page did not expose its keyboard transport');
  const url = new URL(endpoint);
  assert.ok(url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let next = 0;
  const pending = new Map();
  const fail = () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Keyboard transport closed')); }
    pending.clear();
  };
  socket.addEventListener('close', fail);
  socket.addEventListener('error', fail);
  socket.addEventListener('message', event => {
    const reply = JSON.parse(event.data);
    const item = pending.get(reply.id);
    if (!item) return;
    pending.delete(reply.id); clearTimeout(item.timer);
    if (reply.error) item.reject(new Error(reply.error.message)); else item.resolve(reply.result);
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Keyboard command timed out: ${method}`)); }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    async press(action) {
      const codes = { Tab: 9, Escape: 27, Enter: 13, Home: 36, ArrowDown: 40, SelectAll: 65 };
      assert.ok(Object.hasOwn(codes, action) || action === 'ShiftTab', 'Unsupported verification key');
      const key = action === 'ShiftTab' ? 'Tab' : action === 'SelectAll' ? 'a' : action;
      const params = { key, code: action === 'SelectAll' ? 'KeyA' : key,
        windowsVirtualKeyCode: codes[action === 'ShiftTab' ? 'Tab' : action],
        modifiers: action === 'ShiftTab' ? 8 : action === 'SelectAll' ? 2 : 0 };
      await send('Input.dispatchKeyEvent', { ...params, type: 'keyDown', ...(key === 'Enter' ? { text: '\r' } : {}) });
      await send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
    },
    async write(text) {
      assert.ok(typeof text === 'string' && text.length <= 512, 'Verification text must be bounded');
      await send('Input.insertText', { text });
    },
    close() { fail(); socket.close(); },
  };
}
