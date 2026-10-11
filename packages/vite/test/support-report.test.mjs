import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogError, parseCatalog } from '@0disoft/saylo-core';
import { createSupportReport, createSupportRecorder } from '../dist/client.js';

test('real parser diagnostics discard paths, raw text, keys, arguments and request identifiers', () => {
  let failure;
  const secret = 'PRIVATE_TOKEN_123';
  try { parseCatalog(JSON.stringify({ [secret]: `{${secret}, plural, invalid}` }), {
    locale: 'en', namespace: 'private', sourceName: `C:/Users/${secret}/en/private.json`,
  }); } catch (error) { failure = error; }
  assert.ok(failure instanceof CatalogError);
  const report = createSupportReport({ diagnostics: [{ message: failure.message, diagnostics: failure.diagnostics,
    request: { scope: 'eager', requestId: secret, generation: 1, locale: 'en', namespaces: [secret] },
    stack: secret, extra: secret }], environment: { runtime: 'browser', node: '24.18.0',
    vite: '8.3.4', sayloVite: '0.1.0-alpha.4', token: secret } });
  assert.equal(report.events[0].diagnostics[0].code, 'INVALID_ICU');
  assert.deepEqual(Object.keys(report.events[0].diagnostics[0]), ['code', 'source', 'position']);
  assert.ok(report.events[0].diagnostics[0].position.line >= 1);
  const json = JSON.stringify(report);
  for (const excluded of [secret, 'C:/', 'private.json', 'requestId', 'stack', 'token']) assert.ok(!json.includes(excluded), excluded);
  assert.deepEqual(report.environment, { runtime: 'browser', node: '24.18.0', vite: '8.3.4', sayloVite: '0.1.0-alpha.4' });
});

test('strict allowlists reject arbitrary codes, environment labels and malformed positions', () => {
  const report = createSupportReport({ environment: { runtime: 'SECRET', node: '24.18.0\n',
    vite: 'https://token@example.test', sayloCore: '0.1.0-SECRET', sayloVite: '0.1.0+SECRET',
    sayloReact: '0.1.0-rc.2', sayloSvelte: '01.1.1', sayloTypegen: '0.1.0-alpha.4' },
    syncState: { status: 'SECRET', attempt: 1, maxAttempts: 3 }, diagnostics: [{ message: 'SECRET', operation: 'SECRET',
      diagnostics: [{ code: 'SECRET', sourceName: 'PRIVATE', position: { offset: -1, line: 0, column: Infinity, secret: 'SECRET' } },
        { code: '__proto__', sourceName: 'PRIVATE' }, { code: 'INVALID_JSON', sourceName: 'OTHER',
          position: { offset: 0, line: 1, column: 1, secret: 'SECRET' } }] }] });
  assert.deepEqual(report.environment, { runtime: 'unknown', sayloReact: '0.1.0-rc.2', sayloTypegen: '0.1.0-alpha.4' });
  assert.equal(report.syncState, undefined);
  assert.equal(report.events[0].operation, 'unknown');
  assert.deepEqual(report.events[0].diagnostics.map(d => [d.code, d.source]), [['UNKNOWN', 1], ['UNKNOWN', 1], ['INVALID_JSON', 2]]);
  assert.equal(report.events[0].diagnostics[0].position, undefined);
  assert.ok(!JSON.stringify(report).includes('SECRET'));
});

test('bounded history retains newest events and explicitly reports dropped rows', () => {
  const diagnostics = Array.from({ length: 70 }, () => ({ code: 'INVALID_JSON', sourceName: 'hidden' }));
  const inputs = Array.from({ length: 35 }, (_, i) => ({ message: '', operation: i === 34 ? 'observer' : 'handshake', diagnostics }));
  const report = createSupportReport({ diagnostics: inputs });
  assert.equal(report.omittedEvents, 3);
  assert.equal(report.events.length, 32);
  assert.equal(report.events.at(-1).operation, 'observer');
  assert.equal(report.events[0].diagnostics.length, 64);
  assert.equal(report.events[0].omittedDiagnostics, 6);
  const recorder = createSupportRecorder();
  for (const input of inputs) recorder.onDiagnostic(input);
  assert.deepEqual(recorder.getReport(), report);
});

test('recording immediately snapshots inputs; returned reports are deeply immutable and clear is explicit', () => {
  const env = { runtime: 'node', node: '24.18.0' };
  const recorder = createSupportRecorder(env);
  env.node = '99.0.0';
  const input = { operation: 'handshake', message: 'PRIVATE', diagnostics: [{ code: 'INVALID_JSON', sourceName: 'one',
    position: { offset: 2, line: 1, column: 3 } }] };
  const syncState = { status: 'failed', attempt: 3, maxAttempts: 3 };
  recorder.onDiagnostic(input);
  recorder.onSyncState(syncState);
  input.diagnostics[0].position.column = 9;
  input.operation = 'observer';
  syncState.status = 'connected';
  const report = recorder.getReport();
  assert.equal(report.environment.node, '24.18.0');
  assert.equal(report.syncState.status, 'failed');
  assert.equal(report.events[0].operation, 'handshake');
  assert.equal(report.events[0].diagnostics[0].position.column, 3);
  for (const value of [report, report.environment, report.syncState, report.events, report.events[0],
    report.events[0].diagnostics, report.events[0].diagnostics[0], report.events[0].diagnostics[0].position]) assert.ok(Object.isFrozen(value));
  recorder.onSyncState({ status: 'connected', attempt: 0, maxAttempts: 3 });
  recorder.onDiagnostic({ message: '', diagnostics: [] });
  assert.equal(recorder.getReport().events.length, 2, 'repair does not erase historical evidence');
  recorder.clear();
  assert.deepEqual(recorder.getReport(), createSupportReport({ environment: { runtime: 'node', node: '24.18.0' } }));
  assert.equal(report.events.length, 1, 'clear must not mutate a previously obtained report');
});
