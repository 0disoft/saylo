import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Connect only to the owned headless test profile, never a user's browser.
export async function connectChromeProtocol(profile, child) {
  let lines;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Owned Chrome exited before its protocol became available');
    try { lines = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; await delay(50); }
  }
  if (!lines || !/^\d+$/.test(lines[0]) || !lines[1]?.startsWith('/devtools/browser/'))
    throw new Error('Owned Chrome did not expose a valid protocol endpoint');
  const endpoint = `127.0.0.1:${lines[0]}`;
  const protocol = await (await fetch(`http://${endpoint}/json/protocol`, { signal: AbortSignal.timeout(10000) })).json();
  for (const [domain, command] of [['Target', 'createTarget'], ['Target', 'attachToTarget'], ['Emulation', 'setTimezoneOverride'], ['Page', 'navigate']]) {
    if (!protocol.domains.find(item => item.domain === domain)?.commands.some(item => item.name === command))
      throw new Error(`Owned Chrome does not expose ${domain}.${command}`);
  }
  const socket = new WebSocket(`ws://${endpoint}${lines[1]}`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Protocol connection timeout')); }, 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Protocol connection failed')); }, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id); clearTimeout(request.timer);
    if (data.error) request.reject(new Error(JSON.stringify(data.error)));
    else request.resolve(data.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Protocol connection closed')); }
    pending.clear();
  });
  return {
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Protocol call timeout: ${method}`)); }, 10000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { socket.close(); },
  };
}
