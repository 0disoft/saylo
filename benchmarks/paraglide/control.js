const documentId = crypto.randomUUID();
let latest, initialInput, active, wake, starting = false, initialPage = false;
async function request(route, data) {
  const response = await fetch(`/__bench/${route}`, data === undefined ? {} : { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const fail = error => { void request('fail', { message: String(error) }).catch(() => {}); };
async function waitForCommit(predicate) {
  while (!latest || !predicate(latest)) await new Promise(resolve => { wake = resolve; });
}
async function control() {
  const boot = await request('ready', { documentId, userAgent: navigator.userAgent });
  initialPage = boot.initial;
  if (initialPage) {
    await waitForCommit(() => true);
    initialInput = latest.input;
    latest.seed();
    await waitForCommit(value => value.state === 'preserved state');
  }
  while (true) {
    active = await request('command');
    if (active.kind === 'done') return;
    if (active.kind === 'calibrate') { await request('ack', { token: active.token }); continue; }
    if (!active.saved) await request('armed', { token: active.token });
    await waitForCommit(value => value.text === active.expected && value.locale === 'en');
    const committedAt = latest.committedAt;
    if (document.getElementById('probe').textContent !== active.expected) throw new Error('Incorrect DOM translation.');
    await request('ack', { token: active.token, text: latest.text, documentId,
      inputNodePreserved: initialPage && latest.input === initialInput,
      inputValuePreserved: latest.input.value === 'preserved input',
      componentStatePreserved: latest.state === 'preserved state',
      commitToAckDispatchMs: performance.now() - committedAt });
  }
}
export const controller = { commit(value) {
  latest = { ...value, committedAt: performance.now() };
  wake?.(); wake = undefined;
  if (!starting) { starting = true; void control().catch(fail); }
} };
