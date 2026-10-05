import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createStore, parseCatalog } from '@saylo/core';
import { connectDev } from '../dist/client.js';
import { DIAGNOSTIC_EVENT, REQUEST_EVENT, SNAPSHOT_EVENT } from '../dist/types.js';

const catalog = text => parseCatalog(JSON.stringify({ hello: text }), { locale: 'ko', namespace: 'demo' });
const payload = (revision, text, sessionId = 'one') => JSON.parse(JSON.stringify({ sessionId, revision, baseLocale: 'ko', catalogs: [catalog(text)] }));
function fixture(t) {
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [catalog('초기')] });
  t.after(() => store.dispose());
  const hot = new EventEmitter();
  const disposers = [];
  const pruners = [];
  hot.dispose = callback => disposers.push(callback);
  hot.prune = callback => pruners.push(callback);
  hot.send = event => {
    assert.equal(event, REQUEST_EVENT);
    assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 1);
    assert.equal(hot.listenerCount(DIAGNOSTIC_EVENT), 1);
    hot.emit(SNAPSHOT_EVENT, payload(0, '초기'));
  };
  return { hot, store, disposers, pruners };
}

test('connect registers before request, dedupes revisions, and accepts a new session', t => {
  const { hot, store } = fixture(t);
  const updates = [];
  const stop = connectDev(store, { hot, onUpdate: catalogs => updates.push(catalogs) });
  t.after(stop);
  hot.emit(SNAPSHOT_EVENT, payload(1, '새 문구'));
  hot.emit(SNAPSHOT_EVENT, payload(1, '중복'));
  hot.emit(SNAPSHOT_EVENT, payload(0, '오래된 문구'));
  assert.equal(store.t('demo:hello'), '새 문구');
  assert.equal(updates.length, 2);
  assert.ok(Object.isFrozen(updates[1][0].messages.hello.ast));
  hot.emit(SNAPSHOT_EVENT, payload(0, '새 세션', 'two'));
  assert.equal(store.t('demo:hello'), '새 세션');
});

test('disconnect ignores late packets and reconnect requests the current snapshot', t => {
  const { hot, store, pruners } = fixture(t);
  const stop = connectDev(store, { hot });
  const late = hot.listeners(SNAPSHOT_EVENT)[0];
  stop();
  late(payload(9, '해제 후 늦은 응답'));
  assert.equal(store.t('demo:hello'), '초기');
  hot.send = () => hot.emit(SNAPSHOT_EVENT, payload(10, '재연결 최신 문구'));
  connectDev(store, { hot });
  assert.equal(store.t('demo:hello'), '재연결 최신 문구');
  pruners[0]();
  assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 0);
  assert.equal(hot.listenerCount(DIAGNOSTIC_EVENT), 0);
});

test('failed initial request releases binding so connect can be retried', t => {
  const { hot, store } = fixture(t);
  hot.send = () => { throw new Error('socket unavailable'); };
  assert.throws(() => connectDev(store, { hot }), /socket unavailable/);
  assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 0);
  hot.send = () => hot.emit(SNAPSHOT_EVENT, payload(0, '다시 연결'));
  const stop = connectDev(store, { hot });
  assert.equal(store.t('demo:hello'), '다시 연결');
  stop();
});

test('store disposal releases its bridge without closing another store binding', t => {
  const { hot, store } = fixture(t);
  const other = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [catalog('다른 store')] });
  t.after(() => other.dispose());
  connectDev(store, { hot });
  hot.send = () => {};
  connectDev(other, { hot });
  assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 2);
  store.dispose();
  assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 1);
  hot.emit(SNAPSHOT_EVENT, payload(1, '다른 store 갱신'));
  assert.equal(other.t('demo:hello'), '다른 store 갱신');
  other.dispose();
  assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 0);
  assert.equal(hot.listenerCount(DIAGNOSTIC_EVENT), 0);
});

test('single store binding and idempotent stop/dispose remove all listeners', t => {
  const { hot, store, disposers } = fixture(t);
  const stop = connectDev(store, { hot });
  assert.equal(connectDev(store, { hot }), stop);
  stop(); stop();
  assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 0);
  const again = connectDev(store, { hot });
  assert.notEqual(again, stop);
  assert.equal(disposers.length, 1);
  disposers[0](); disposers[0]();
  assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 0);
  assert.equal(hot.listenerCount(DIAGNOSTIC_EVENT), 0);
});

test('malformed envelope, wrong base and invalid registry retain last good store', t => {
  const { hot, store } = fixture(t);
  const errors = [];
  const stop = connectDev(store, { hot, onDiagnostic: d => errors.push(d) });
  t.after(stop);
  hot.emit(SNAPSHOT_EVENT, null);
  hot.emit(SNAPSHOT_EVENT, { ...payload(1, 'wrong'), baseLocale: 'en' });
  hot.emit(SNAPSHOT_EVENT, { ...payload(1, 'wrong'), catalogs: [] });
  assert.equal(errors.length, 3);
  assert.equal(store.t('demo:hello'), '초기');
  hot.emit(SNAPSHOT_EVENT, payload(1, '복구'));
  assert.equal(store.t('demo:hello'), '복구');
});

test('subscriber failure reports committed update without replaying it', t => {
  const { hot, store } = fixture(t);
  let calls = 0;
  const errors = [];
  store.subscribe(() => { calls++; throw new Error('render failed'); });
  const stop = connectDev(store, { hot, onDiagnostic: d => errors.push(d) });
  t.after(stop);
  hot.emit(SNAPSHOT_EVENT, payload(1, '새 문구'));
  hot.emit(SNAPSHOT_EVENT, payload(1, '중복'));
  assert.equal(calls, 1);
  assert.equal(errors.length, 1);
  assert.equal(store.t('demo:hello'), '새 문구');
});

test('without Vite hot context connectDev is a production no-op', t => {
  const { store } = fixture(t);
  const stop = connectDev(store);
  stop(); stop();
  assert.equal(store.t('demo:hello'), '초기');
});
