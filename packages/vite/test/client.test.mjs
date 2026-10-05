import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createStore, parseCatalog } from '@saylo/core';
import { connectDev } from '../dist/client.js';
import { DIAGNOSTIC_EVENT, REQUEST_EVENT, SNAPSHOT_EVENT } from '../dist/types.js';

const catalog = text => parseCatalog(JSON.stringify({ hello: text }), { locale: 'ko', namespace: 'demo' });
const payload = (revision, text, sessionId = 'one') => JSON.parse(JSON.stringify({ kind: 'update', baseRevision: revision - 1, sessionId, revision, baseLocale: 'ko', catalogs: [catalog(text)] }));
const reply = (request, revision, text, sessionId = 'one') => ({ ...payload(revision, text, sessionId), kind: 'snapshot', request });
function fixture(t) {
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [catalog('초기')] });
  t.after(() => store.dispose());
  const hot = new EventEmitter();
  const disposers = [];
  const pruners = [];
  hot.dispose = callback => disposers.push(callback);
  hot.prune = callback => pruners.push(callback);
  const requests = [];
  hot.send = (event, request) => {
    requests.push(request);
    assert.equal(event, REQUEST_EVENT);
    assert.equal(hot.listenerCount(SNAPSHOT_EVENT), 1);
    assert.equal(hot.listenerCount(DIAGNOSTIC_EVENT), 1);
    hot.emit(SNAPSHOT_EVENT, { ...payload(0, '초기'), ...hot.snapshot, kind: 'snapshot', request });
  };
  return { hot, store, disposers, pruners, requests };
}

test('connect registers before request, dedupes revisions, and accepts a new session', t => {
  const { hot, store } = fixture(t);
  const updates = [];
  const stop = connectDev(store, { hot, onUpdate: catalogs => updates.push(catalogs) });
  t.after(stop);
  hot.emit(SNAPSHOT_EVENT, payload(1, '새 문구'));
  hot.emit(SNAPSHOT_EVENT, payload(1, '중복'));
  hot.emit(SNAPSHOT_EVENT, payload(1, '오래된 문구'));
  assert.equal(store.t('demo:hello'), '새 문구');
  assert.equal(updates.length, 2);
  assert.ok(Object.isFrozen(updates[1][0].messages.hello.ast));
  hot.snapshot = payload(1, '새 세션', 'two');
  hot.emit(SNAPSHOT_EVENT, payload(1, '새 세션 알림', 'two'));
  assert.equal(store.t('demo:hello'), '새 세션');
});

test('disconnect ignores late packets and reconnect requests the current snapshot', t => {
  const { hot, store, pruners } = fixture(t);
  const stop = connectDev(store, { hot });
  const late = hot.listeners(SNAPSHOT_EVENT)[0];
  stop();
  late(payload(9, '해제 후 늦은 응답'));
  assert.equal(store.t('demo:hello'), '초기');
  hot.send = (_, request) => hot.emit(SNAPSHOT_EVENT, reply(request, 10, '재연결 최신 문구'));
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
  hot.send = (_, request) => hot.emit(SNAPSHOT_EVENT, reply(request, 0, '다시 연결'));
  const stop = connectDev(store, { hot });
  assert.equal(store.t('demo:hello'), '다시 연결');
  stop();
});

test('store disposal releases its bridge without closing another store binding', t => {
  const { hot, store } = fixture(t);
  const other = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [catalog('다른 store')] });
  t.after(() => other.dispose());
  connectDev(store, { hot });
  hot.send = (_, request) => hot.emit(SNAPSHOT_EVENT, reply(request, 0, '다른 store'));
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

test('initial handshake coalesces broadcasts and refuses replies behind the observed revision', t => {
  const { hot, store } = fixture(t);
  const requests = [];
  hot.send = (_, request) => requests.push(request);
  connectDev(store, { hot });
  hot.emit('vite:ws:connect');
  assert.equal(requests.length, 1); // Vite buffers the initial send.
  hot.emit(SNAPSHOT_EVENT, payload(2, '중간'));
  hot.emit(SNAPSHOT_EVENT, payload(3, '최신'));
  assert.equal(requests.length, 1);
  assert.equal(store.t('demo:hello'), '초기');
  hot.emit(SNAPSHOT_EVENT, reply(requests[0], 2, '늦은 snapshot'));
  assert.equal(requests.length, 2);
  hot.emit(SNAPSHOT_EVENT, reply(requests[0], 9, '이전 요청'));
  assert.equal(store.t('demo:hello'), '초기');
  hot.emit(SNAPSHOT_EVENT, reply(requests[1], 3, '최신'));
  assert.equal(store.t('demo:hello'), '최신');
});

test('revision gap requests one snapshot and late replies never roll back a newer update', t => {
  const { hot, store } = fixture(t);
  connectDev(store, { hot });
  hot.emit(SNAPSHOT_EVENT, payload(1, '정상'));
  const requests = [];
  hot.send = (_, request) => requests.push(request);
  hot.emit(SNAPSHOT_EVENT, payload(3, '갭'));
  hot.emit(SNAPSHOT_EVENT, payload(4, '갭 다음'));
  assert.equal(requests.length, 1);
  assert.equal(store.t('demo:hello'), '정상');
  hot.emit(SNAPSHOT_EVENT, reply(requests[0], 4, '복구'));
  hot.emit(SNAPSHOT_EVENT, payload(5, '연속 갱신'));
  hot.emit(SNAPSHOT_EVENT, reply(requests[0], 4, '중복 응답'));
  assert.equal(store.t('demo:hello'), '연속 갱신');
});

test('disconnect invalidates pending requests and reconnect uses the current locale and namespaces', t => {
  const { hot, store } = fixture(t);
  connectDev(store, { hot });
  const requests = [];
  hot.send = (_, request) => requests.push(request);
  hot.emit(SNAPSHOT_EVENT, payload(3, '갭'));
  hot.emit('vite:ws:disconnect');
  const en = parseCatalog('{"hello":"English"}', { locale: 'en', namespace: 'demo' });
  const help = parseCatalog('{"title":"도움말"}', { locale: 'ko', namespace: 'help' });
  store.replaceCatalogs([catalog('초기'), en, help]);
  store.setLocale('en');
  hot.emit(SNAPSHOT_EVENT, reply(requests[0], 3, '연결 끊김 뒤 응답'));
  hot.emit('vite:ws:connect');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].locale, 'en');
  assert.deepEqual(requests[1].namespaces, ['demo', 'help']);
  assert.ok(requests[1].generation > requests[0].generation);
  hot.emit(SNAPSHOT_EVENT, reply(requests[0], 9, '이전 연결'));
  assert.equal(store.t('demo:hello'), 'English');
  hot.emit(SNAPSHOT_EVENT, reply(requests[1], 0, '서버 재시작', 'two'));
  assert.equal(store.t('demo:hello'), '서버 재시작');
  hot.emit(SNAPSHOT_EVENT, payload(10, '폐기된 세션', 'one'));
  assert.equal(requests.length, 2);
  assert.equal(store.t('demo:hello'), '서버 재시작');
});

test('multiple stores on one hot context reject each other\'s replies and late diagnostics', t => {
  const { hot, store } = fixture(t);
  const other = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [catalog('다른 store')] });
  t.after(() => other.dispose());
  const requests = [];
  const errors = [];
  hot.send = (_, request) => requests.push(request);
  connectDev(store, { hot, onDiagnostic: d => errors.push(d) });
  connectDev(other, { hot });
  hot.emit(SNAPSHOT_EVENT, reply(requests[1], 0, '두 번째 응답'));
  assert.equal(store.t('demo:hello'), '초기');
  assert.equal(other.t('demo:hello'), '두 번째 응답');
  hot.emit('vite:ws:disconnect');
  hot.emit('vite:ws:connect');
  hot.emit(DIAGNOSTIC_EVENT, { message: '과거 진단', diagnostics: [], request: requests[0] });
  assert.equal(errors.length, 0);
  hot.emit(SNAPSHOT_EVENT, reply(requests[2], 0, '현재 요청'));
  hot.emit(DIAGNOSTIC_EVENT, { message: '현재 진단', diagnostics: [], request: requests[2] });
  assert.equal(store.t('demo:hello'), '현재 요청');
  assert.equal(errors.length, 1);
});

test('snapshot scope mismatch and invalid request identities retain the last good state', t => {
  const { hot, store } = fixture(t);
  const requests = [];
  const errors = [];
  hot.send = (_, request) => requests.push(request);
  connectDev(store, { hot, onDiagnostic: d => errors.push(d) });
  hot.emit(SNAPSHOT_EVENT, reply({ ...requests[0], generation: 99 }, 0, '다른 generation'));
  hot.emit(SNAPSHOT_EVENT, reply({ ...requests[0], locale: 'en' }, 0, '다른 범위'));
  assert.equal(errors.length, 1);
  assert.equal(store.t('demo:hello'), '초기');
  hot.emit(SNAPSHOT_EVENT, reply(requests[0], 0, '정상 응답'));
  assert.equal(store.t('demo:hello'), '정상 응답');
});

test('stale replies have a retry bound and a later update can recover', t => {
  const { hot, store } = fixture(t);
  const requests = [];
  const errors = [];
  connectDev(store, { hot, onDiagnostic: d => errors.push(d) });
  hot.send = (_, request) => {
    requests.push(request);
    hot.emit(SNAPSHOT_EVENT, reply(request, 0, '오래된 응답'));
  };
  hot.emit(SNAPSHOT_EVENT, payload(3, '갭'));
  assert.equal(requests.length, 3);
  assert.match(errors[0].message, /after 3 attempts/);
  assert.equal(store.t('demo:hello'), '초기');
  hot.send = (_, request) => hot.emit(SNAPSHOT_EVENT, reply(request, 4, '복구'));
  hot.emit(SNAPSHOT_EVENT, payload(4, '최신 알림'));
  assert.equal(store.t('demo:hello'), '복구');
});

test('unanswered snapshots retry with a new generation and stop cancels the timer', async t => {
  const { hot, store } = fixture(t);
  const requests = [];
  const errors = [];
  let exhausted;
  const done = new Promise(resolve => { exhausted = resolve; });
  hot.send = (_, request) => requests.push(request);
  const stop = connectDev(store, { hot, requestTimeoutMs: 10, onDiagnostic: d => { errors.push(d); exhausted(); } });
  await done;
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests.map(r => r.generation)).size, 3);
  assert.equal(errors.length, 1);
  assert.equal(store.t('demo:hello'), '초기');
  hot.emit('vite:ws:disconnect');
  hot.emit('vite:ws:connect');
  stop();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(requests.length, 4);
  assert.equal(hot.listenerCount('vite:ws:disconnect'), 0);
  assert.equal(hot.listenerCount('vite:ws:connect'), 0);
});

test('a first socket connection after exhausted buffered requests starts a fresh handshake', t => {
  const { hot, store } = fixture(t);
  const requests = [];
  hot.send = (_, request) => {
    requests.push(request);
    hot.emit(SNAPSHOT_EVENT, payload(3, '수신 revision'));
    hot.emit(SNAPSHOT_EVENT, reply(request, 0, '오래된 응답'));
  };
  connectDev(store, { hot });
  assert.equal(requests.length, 3);
  hot.send = (_, request) => hot.emit(SNAPSHOT_EVENT, reply(request, 3, '연결 후 복구'));
  hot.emit('vite:ws:connect');
  assert.equal(store.t('demo:hello'), '연결 후 복구');
});
