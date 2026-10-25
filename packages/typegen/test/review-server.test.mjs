import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { startReviewServer } from '../dist/review-server.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'saylo-review-server-'));
  const localesDir = path.join(root, 'locales');
  for (const locale of ['en', 'ko']) await mkdir(path.join(localesDir, locale), { recursive: true });
  await writeFile(path.join(localesDir, 'en/common.json'), JSON.stringify({ title: 'Hello {name}' }));
  await writeFile(path.join(localesDir, 'ko/common.json'), JSON.stringify({}));
  const server = await startReviewServer({ localesDir, baseLocale: 'en', checkLocales: ['ko'] });
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

test('incomplete bodies cannot exceed the admitted request budget and disconnects release slots', async t => {
  const f = await fixture(t);
  const held = [];
  t.after(() => { for (const request of held) request.destroy(); });
  await Promise.all(Array.from({ length: 32 }, () => new Promise((resolve, reject) => {
    const request = httpRequest(f.server.url + '/api/preview', {
      method: 'POST', headers: { ...f.headers, 'Content-Length': '100' },
    });
    held.push(request);
    request.on('error', () => {});
    request.write('{', error => error ? reject(error) : resolve());
  })));
  assert.equal((await fetch(f.server.url + '/api/state', { headers: f.headers })).status, 503);
  const closed = held.map(request => new Promise(resolve => request.once('close', resolve)));
  for (const request of held) request.destroy();
  await Promise.all(closed);
  assert.equal((await fetch(f.server.url + '/api/state', { headers: f.headers })).status, 200);
});
