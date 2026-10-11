import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { connectDev, createSupportRecorder } from '@0disoft/saylo-vite/client';

const catalog = text => parseCatalog(JSON.stringify({ hello: text }), { locale: 'ko', namespace: 'demo' });
const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [catalog('before')] });
const hot = new EventEmitter();
hot.dispose = () => {};
hot.prune = () => {};
hot.send = (event, request) => {
  assert.equal(event, 'saylo:request-eager-snapshot');
  hot.emit('saylo:eager-snapshot', { kind: 'snapshot', request, sessionId: 'packed', revision: 0,
    baseLocale: 'ko', catalogs: [catalog('after')] });
};
const states = [];
const recorder = createSupportRecorder();
let stop;
try {
  stop = connectDev(store, { hot, onSyncState: state => {
    assert.ok(Object.isFrozen(state));
    assert.equal(state.maxAttempts, 3);
    states.push([state.status, state.attempt]);
    recorder.onSyncState(state);
  } });
  assert.deepEqual(states, [['connecting', 1], ['connected', 0]]);
  assert.equal(store.t('demo:hello'), 'after');
  assert.equal(recorder.getReport().syncState.status, 'connected');
  stop();
  stop();
  hot.emit('vite:ws:disconnect');
  assert.deepEqual(states, [['connecting', 1], ['connected', 0]], 'Callbacks survived disconnect cleanup.');
  assert.equal(recorder.getReport().syncState.status, 'connected', 'Recorder must keep its last observation.');
  assert.ok(hot.eventNames().every(event => hot.listenerCount(event) === 0));
  console.log('[pack] Installed eager onSyncState, frozen states, support integration and listener cleanup passed.');
} finally { stop?.(); store.dispose(); }
