import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyOidc } from '../verify-oidc.mjs';

const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: '0disoft/saylo', GITHUB_REF: 'refs/heads/main',
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://github.example/oidc?request=1', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret' };
const response = data => ({ ok: true, status: 201, json: async () => data });

test('rejects local or wrong-repository runs before requesting credentials', async () => {
  for (const override of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_REF: 'refs/heads/other' }])
    await assert.rejects(verifyOidc({ env: { ...env, ...override }, request: () => { throw new Error('network must not run'); } }), /Saylo main workflow/);
});

test('exchanges package-scoped tokens without exposing them in output', async () => {
  const logs = [], calls = [];
  await verifyOidc({ env, log: line => logs.push(line), request: async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return response({ value: 'id-secret' });
    return response({ token_type: 'oidc', token: 'registry-secret', expires: new Date(Date.now() + 60000).toISOString() });
  } });
  assert.equal(calls.length, 5);
  assert.equal(new URL(calls[0].url).searchParams.get('audience'), 'npm:registry.npmjs.org');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer request-secret');
  for (const [i, id] of ['core', 'react', 'typegen', 'vite'].entries()) {
    assert.equal(calls[i + 1].url, `https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/@0disoft%2fsaylo-${id}`);
    assert.equal(calls[i + 1].options.method, 'POST');
    assert.equal(calls[i + 1].options.headers.Authorization, 'Bearer id-secret');
    assert.equal(calls[i + 1].options.redirect, 'error');
  }
  assert.equal(logs.length, 5);
  assert.ok(!logs.join('\n').includes('secret'));
});

test('redacts backend, transport and malformed-token failures', async () => {
  for (const failure of [
    () => { throw new Error('transport exposed id-secret'); },
    () => ({ ok: false, status: 401, json: async () => ({ error: 'registry-secret' }) }),
    () => response({ token_type: 'oidc', token: 'registry-secret', expires: 'invalid' }),
  ]) {
    let count = 0;
    await assert.rejects(verifyOidc({ env, request: async () => ++count === 1 ? response({ value: 'id-secret' }) : failure() }),
      error => error.message.includes('npm OIDC exchange failed') && !error.message.includes('secret'));
  }
});
