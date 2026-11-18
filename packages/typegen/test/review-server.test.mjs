import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { startReviewServer } from '../dist/review-server.js';

async function fixture(t, options) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-review-server-'));
  const localesDir = path.join(root, 'locales');
  for (const locale of ['en', 'ko']) await mkdir(path.join(localesDir, locale), { recursive: true });
  await writeFile(path.join(localesDir, 'en/common.json'), JSON.stringify({ title: 'Hello {name}' }));
  await writeFile(path.join(localesDir, 'ko/common.json'), JSON.stringify({}));
  const server = await startReviewServer({ localesDir, baseLocale: 'en', checkLocales: ['ko'] }, options);
  t.after(async () => {
    await server.close();
    assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('saylo-review-server-'));
    await rm(root, { recursive: true, force: true });
  });
  const html = await (await fetch(server.url)).text();
  const token = /const token="([a-f0-9]+)"/.exec(html)[1];
  const headers = { Authorization: 'Bearer ' + token, Origin: server.url, 'Content-Type': 'application/json' };
  const state = async () => (await fetch(server.url + '/api/state', { headers })).json();
  const post = (action, data, extra = {}) => fetch(server.url + '/api/' + action,
    { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(data) });
  return { root, localesDir, server, html, headers, state, post };
}
const draft = (state, translation) => ({ revision: state.revision, entry: { ...state.rows[0], translation }, reviewer: 'Reviewer' });

test('local review authenticates API requests, rejects foreign origins/hosts, and bounds bodies', async t => {
  const f = await fixture(t);
  assert.match(f.html, /Translation review/);
  assert.equal((await fetch(f.server.url + '/api/state')).status, 403);
  const current = await f.state();
  assert.equal((await f.post('save', draft(current, '안녕 {name}'), { Origin: 'https://evil.test' })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    const request = httpRequest(f.server.url + '/api/state', { headers: { Host: 'evil.test' } }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode));
    }); request.once('error', reject); request.end();
  });
  assert.equal(foreignHost, 403);
  assert.equal((await f.post('preview', draft(current, 'x'.repeat(300000)))).status, 413);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.localesDir, 'ko/common.json'), 'utf8')), {});
});

test('review preserves authorization, route, body and stale revision error precedence', async t => {
  let reads = 0;
  const f = await fixture(t, { readCatalog(file) { reads++; return readFile(file, 'utf8'); } });
  const { Origin: _origin, ...withoutOrigin } = f.headers;
  const { Authorization: _authorization, ...withoutAuthorization } = f.headers;
  async function rejectRequest(endpoint, headers, status, error, body = '{') {
    const response = await fetch(f.server.url + '/api/' + endpoint, { method: 'POST', headers, body });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
  }
  await rejectRequest('unknown', { ...withoutAuthorization, Origin: 'https://elsewhere.test' }, 403, 'Review authorization required.');
  await rejectRequest('unknown', { ...f.headers, Origin: 'https://elsewhere.test' }, 403, 'Invalid review origin.');
  await rejectRequest('unknown', withoutOrigin, 404, 'Unknown review endpoint.');
  await rejectRequest('save', withoutOrigin, 403, 'Review writes require the same origin.');
  await rejectRequest('save', { ...f.headers, 'Content-Type': 'text/plain' }, 415, 'Use application/json.');
  await rejectRequest('save', f.headers, 400, 'Invalid draft request.', '[]');
  assert.equal(reads, 0);
  const current = await f.state();
  await rejectRequest('save', f.headers, 409, 'Catalogs, metadata or approvals changed. Refresh before saving.', '{}');
  await rejectRequest('save', f.headers, 400, 'Invalid translation draft.', JSON.stringify({ revision: current.revision }));
});

test('review counts all search matches and returns the first 200 in catalog order', async t => {
  const f = await fixture(t);
  const ids = Array.from({ length: 201 }, (_, i) => 'key' + String(i).padStart(3, '0'));
  const messages = Object.fromEntries(ids.map(id => [id, 'Common text']));
  await writeFile(path.join(f.localesDir, 'en/common.json'), JSON.stringify(messages));
  const search = async q => (await fetch(f.server.url + '/api/state?' + new URLSearchParams({ q }), { headers: f.headers })).json();
  const first = await search('COMMON TEXT');
  assert.equal(first.total, 201);
  assert.deepEqual(first.rows.map(row => row.id), ids.slice(0, 200));
  assert.ok(first.rows.every(row => row.status === 'untranslated'));
  assert.equal(first.diagnostics.length, 200);
  const last = await search('KEY200');
  assert.equal(last.total, 1);
  assert.deepEqual(last.rows.map(row => row.id), [ids.at(-1)]);
});

test('review preview never writes, saving validates ICU and approvals remain explicit with audit context', async t => {
  const f = await fixture(t); let state = await f.state();
  assert.equal(state.rows[0].status, 'untranslated');
  assert.equal((await (await f.post('preview', draft(state, '안녕 {name}'))).json()).blocked, false);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.localesDir, 'ko/common.json'), 'utf8')), {});
  assert.equal((await (await f.post('preview', draft(state, '{name, number}'))).json()).blocked, true);
  assert.equal((await (await f.post('approve', draft(state, '안녕 {name}'))).json()).blocked, true);
  const saved = await (await f.post('save', draft(state, '안녕 {name}'))).json();
  assert.equal(saved.blocked, false);
  assert.equal(JSON.parse(await readFile(path.join(f.localesDir, 'ko/common.json'), 'utf8')).title, '안녕 {name}');
  await assert.rejects(readFile(path.join(f.root, '.saylo-reviews.json')), { code: 'ENOENT' });
  state = await f.state();
  const approved = await (await f.post('approve', draft(state, '안녕 {name}'))).json();
  assert.equal(approved.blocked, false);
  const ledger = JSON.parse(await readFile(path.join(f.root, '.saylo-reviews.json'), 'utf8'));
  assert.equal(ledger.entries[0].reviewer, 'Reviewer');
  assert.equal((await f.state()).rows[0].status, 'approved');
});

test('same-revision competing edits serialize and reject the stale request; shutdown is idempotent', async t => {
  const f = await fixture(t); const state = await f.state();
  const results = await Promise.all(['First {name}', 'Second {name}'].map(text => f.post('save', draft(state, text))));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  await writeFile(path.join(f.localesDir, 'en/common.json'), JSON.stringify({ title: 'Changed {name}' }));
  assert.equal((await f.post('save', draft(state, 'Stale {name}'))).status, 409);
  await f.server.close(); await f.server.close();
  await assert.rejects(fetch(f.server.url));
});

test('disconnecting an active review cancels its scan and lets the next request proceed', { timeout: 5000 }, async t => {
  const started = Promise.withResolvers(), released = Promise.withResolvers();
  const reads = [];
  t.after(() => released.resolve());
  const f = await fixture(t, {
    async readCatalog(file, signal) {
      reads.push(path.basename(path.dirname(file)));
      if (reads.length === 1) {
        started.resolve(signal);
        const aborted = Promise.withResolvers();
        const abort = () => aborted.resolve();
        signal.addEventListener('abort', abort, { once: true });
        try {
          if (!signal.aborted) await Promise.race([aborted.promise, released.promise]);
          signal.throwIfAborted();
        } finally { signal.removeEventListener('abort', abort); }
      }
      return readFile(file, 'utf8');
    },
  });
  const controller = new AbortController();
  const disconnected = assert.rejects(fetch(f.server.url + '/api/state', { headers: f.headers, signal: controller.signal }),
    { name: 'AbortError' });
  const scanSignal = await started.promise;
  controller.abort();
  await disconnected;
  const state = await f.state();
  assert.equal(scanSignal.aborted, true);
  assert.deepEqual(reads, ['en', 'en', 'ko']);
  assert.equal(state.total, 1);
});

test('incomplete bodies cannot exceed the admitted request budget and disconnects release slots', async t => {
  const f = await fixture(t);
  const held = [];
  t.after(() => { for (const request of held) request.destroy(); });
  await Promise.all(Array.from({ length: 32 }, () => new Promise((resolve, reject) => {
    const request = httpRequest(f.server.url + '/api/preview', {
      method: 'POST', headers: { ...f.headers, 'Content-Length': '100', Expect: '100-continue' },
    });
    held.push(request);
    request.on('error', () => {});
    request.once('error', reject);
    // A completed client write only confirms local buffering. The server's
    // continue response is received after its synchronous admission checks.
    request.once('continue', () => { request.write('{'); resolve(); });
    request.flushHeaders();
  })));
  assert.equal((await fetch(f.server.url + '/api/state', { headers: f.headers })).status, 503);
  const closed = held.map(request => new Promise(resolve => request.once('close', resolve)));
  for (const request of held) request.destroy();
  await Promise.all(closed);
  // Client close can precede the server's abort cleanup on a different OS.
  const signal = AbortSignal.timeout(2000);
  let status;
  do { status = (await fetch(f.server.url + '/api/state', { headers: f.headers, signal })).status; }
  while (status === 503);
  assert.equal(status, 200);
});
