import { createElement as h } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { createHydrationLayer } from './hydration-layer.mjs';
import { SsrProbe } from './ssr-view.mjs';

const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let root, adapter;
async function report(route, data) {
  const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
try {
  const wire = document.getElementById('boot').textContent;
  const { caseId, expected, updates } = JSON.parse(document.getElementById('updates').textContent);
  adapter = await createHydrationLayer(wire);
  const boot = adapter.getServerSnapshot();
  let notifications = 0;
  adapter.subscribe(() => notifications++);
  await adapter.replace(updates[0]); await adapter.replace(updates[1]);
  assert(adapter.getSnapshot() === boot && notifications === 0, 'Early updates escaped the hydration barrier');
  const container = document.getElementById('root');
  const title = container.querySelector('h1'), input = container.querySelector('input');
  const dialog = container.querySelector('dialog');
  input.value = 'typed before hydration'; input.focus(); input.setSelectionRange(3, 3);
  const errors = [];
  let hydrated;
  const mounted = new Promise(resolve => { hydrated = resolve; });
  root = hydrateRoot(container, h(SsrProbe, { adapter, hydrated }), { onRecoverableError: error => errors.push(String(error)) });
  await mounted; await frame();
  assert(errors.length === 0, `Hydration recovered: ${errors}`);
  assert(container.querySelector('h1') === title && title.textContent === expected.initial, 'SSR title was replaced/mismatched');
  container.querySelector('button').click(); await frame();
  assert(container.querySelector('button').textContent === '1' && dialog.open, 'Component state did not update while barrier held');
  adapter.finishHydration(); await frame();
  assert(notifications === 1 && title.textContent === 'Latest Ada', 'Barrier did not publish only the newest snapshot');
  adapter.finishHydration(); assert(notifications === 1, 'Repeated barrier release published again');
  await adapter.replace(updates[2]); await frame();
  const preserved = container.querySelector('h1') === title && container.querySelector('input') === input &&
    container.querySelector('dialog') === dialog && input.value === 'typed before hydration' &&
    document.activeElement === input && input.selectionStart === 3 && container.querySelector('button').textContent === '1' && dialog.open;
  assert(preserved, 'DOM/input/focus/caret/component state lost');
  assert(title.textContent === 'Post Ada' && notifications === 2, 'Post-hydration replacement failed');
  assert(boot.t('demo:greeting', { name: 'Ada' }) === expected.initial, 'Old bound translation changed');
  assert(adapter.getSnapshot().timeZone === expected.timeZone, 'Boot timezone changed');
  if (expected.hostTimeZone) assert(new Intl.DateTimeFormat('en').resolvedOptions().timeZone === expected.hostTimeZone,
    'Browser host timezone emulation did not apply');
  assert(container.querySelector('#when').textContent === expected.when, 'Client/server date mismatch');
  assert(container.querySelector('#rows').textContent === '21 rows', 'Fallback source locale changed');
  assert(globalThis.__thinInjected === undefined, 'Unsafe serialized content executed');
  const observation = { caseId, locale: adapter.getSnapshot().locale, timeZone: adapter.getSnapshot().timeZone,
    missingTarget: expected.missingTarget,
    hostTimeZone: new Intl.DateTimeFormat('en').resolvedOptions().timeZone, when: container.querySelector('#when').textContent,
    fallbackPlural: container.querySelector('#rows').textContent,
    initial: boot.t('demo:greeting', { name: 'Ada' }), final: title.textContent, preserved, notifications,
    recoverableErrors: errors, injectionAbsent: true, userAgent: navigator.userAgent };
  root.unmount(); root = undefined; adapter.dispose(); adapter = undefined;
  const { next } = await report('/ack', observation);
  if (next) location.assign(next);
} catch (error) {
  root?.unmount(); adapter?.dispose();
  await report('/fail', { message: String(error) }).catch(() => {});
}
