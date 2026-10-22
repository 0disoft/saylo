import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { decodeBootSnapshot } from '@0disoft/saylo-core';

// Keep the HTTP probe separate from SvelteKit's development SSR fetch wrapper.
const requestFetch = globalThis.fetch.bind(globalThis);
let server;
try {
  let origin = process.argv[2];
  if (!origin) {
    const root = fileURLToPath(new URL('.', import.meta.url));
    process.chdir(root);
    server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    const address = server.httpServer.address();
    origin = `http://127.0.0.1:${address.port}`;
  }
  const request = async (query, expected, headers = {}) => {
    const search = query === undefined ? '' : `?locale=${encodeURIComponent(query)}`;
    const response = await requestFetch(`${origin}/${search}`, { headers, signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.ok(html.includes(`<html lang="${expected}">`));
    assert.ok(html.includes(expected === 'en' ? 'New words. Same input.' : '번역을 바꿔도, 입력은 그대로'));
    // Svelte's SSR snippets insert hydration comments inside otherwise identical text.
    const markup = html.replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(markup.includes('<strong>Saylo</strong>'), 'SSR rich name missing');
    assert.ok(markup.includes('<a href="#order-form">'), 'SSR app-owned rich link missing');
    const dataResponse = await requestFetch(`${origin}/__data.json${search}`, { headers, signal: AbortSignal.timeout(15000) });
    assert.equal(dataResponse.status, 200);
    const data = await dataResponse.json();
    const layout = data.nodes.find(node => node?.type === 'data' && node.data?.[0]?.sayloBoot !== undefined);
    assert.ok(layout, 'Layout boot data missing');
    const boot = decodeBootSnapshot(layout.data[layout.data[0].sayloBoot]);
    assert.equal(boot.locale, expected);
    assert.equal(boot.timeZone, 'UTC');
    assert.deepEqual(boot.loadedNamespaces, ['demo']);
  };
  const concurrent = await Promise.allSettled([
    request('ko', 'ko', { 'accept-language': 'en' }),
    request('en', 'en', { cookie: 'saylo-locale=ko' }),
    request(undefined, 'en', { 'accept-language': 'en-GB' }),
    request(undefined, 'ko', { cookie: 'saylo-locale=ko', 'accept-language': 'en' }),
  ]);
  for (const result of concurrent) if (result.status === 'rejected') throw result.reason;
  await request('EN', 'en');
  await request('en_US', 'ko');
  await request('fr', 'ko');
  await request('en-GB', 'en');
  await request(undefined, 'ko');
  await request(undefined, 'en', { 'accept-language': 'fr;q=1,en-GB;q=0.8,ko;q=0.2' });
  await request(undefined, 'ko', { 'accept-language': 'en;q=0.2,ko;q=0.8' });
  await request(undefined, 'ko', { 'accept-language': 'en-US,en;q=0,*;q=0.5' });
  await request(undefined, 'en', { 'accept-language': '*;q=0,en;q=1' });
  await request(undefined, 'en', { 'accept-language': 'broken;q=NaN,en;q=0.5' });
  await request(undefined, 'ko', { 'accept-language': '*;q=0' });
  await request(undefined, 'en', { cookie: 'saylo-locale=EN-gb', 'accept-language': 'ko' });
  await request('en_US', 'en', { cookie: 'saylo-locale=en' });
  await request('fr', 'en', { cookie: 'saylo-locale=en_US', 'accept-language': 'en' });
  await request('en', 'en', { cookie: 'saylo-locale=ko', 'accept-language': 'en;q=0' });
  console.log('[sveltekit] Concurrent SSR, matching boot data, parent lookup, query/cookie/header priority and q=0 passed.');
  if (server) {
    const { createRequestI18n } = await server.ssrLoadModule('virtual:saylo/server');
    const prepared = await createRequestI18n({ locale: 'en' });
    let boot;
    try { boot = prepared.getBootSnapshot(); } finally { prepared.dispose(); }
    const { createBootInstance } = await server.ssrLoadModule('/src/lib/i18n.ts');
    const { connectBootClient } = await server.ssrLoadModule('/src/lib/client-connection.ts');
    const listeners = new Map();
    const hot = {
      on(event, callback) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
      off(event, callback) { listeners.get(event)?.delete(callback); },
      send() {}, dispose() {}, prune() {},
    };
    const count = () => [...listeners.values()].reduce((sum, values) => sum + values.size, 0);
    const current = createBootInstance(boot);
    let connection;
    try {
      connection = connectBootClient({ boot, ...current, hot });
      assert.equal(await connection.ready, true);
      assert.ok(count() > 0, 'Live source did not register listeners');
      connection.stop(); connection.stop();
      assert.equal(count(), 0, 'Owned listeners survived layout cleanup');
    } finally { connection?.stop(); current.instance.dispose(); }
    const late = createBootInstance(boot);
    let attached = 0;
    try {
      connection = connectBootClient({ boot, instance: late.instance, hot,
        attachSource(source) { attached++; late.attachSource(source); } });
      connection.stop();
      assert.equal(await connection.ready, false);
      assert.equal(attached, 0, 'Late source reconnected after cleanup');
      assert.equal(count(), 0);
    } finally { connection?.stop(); late.instance.dispose(); }
    console.log('[sveltekit] Owned listener cleanup, idempotent stop and late connection cancellation passed.');
  }
} finally { await server?.close(); }
