import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { decodeBootSnapshot } from '@0disoft/saylo-core';

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
  const request = async (query, expected) => {
    const response = await fetch(`${origin}/?locale=${encodeURIComponent(query)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.ok(html.includes(`<html lang="${expected}">`));
    assert.ok(html.includes(expected === 'en' ? 'New words. Same input.' : '번역을 바꿔도, 입력은 그대로'));
    const dataResponse = await fetch(`${origin}/__data.json?locale=${encodeURIComponent(query)}`);
    assert.equal(dataResponse.status, 200);
    const data = await dataResponse.json();
    const layout = data.nodes.find(node => node.type === 'data' && node.data?.[0]?.sayloBoot !== undefined);
    assert.ok(layout, 'Layout boot data missing');
    const boot = decodeBootSnapshot(layout.data[layout.data[0].sayloBoot]);
    assert.equal(boot.locale, expected);
    assert.equal(boot.timeZone, 'UTC');
    assert.deepEqual(boot.loadedNamespaces, ['demo']);
  };
  await Promise.all([request('ko', 'ko'), request('en', 'en'), request('en', 'en'), request('ko', 'ko')]);
  await request('EN', 'en');
  await request('en_US', 'ko');
  await request('fr', 'ko');
  console.log('[sveltekit] Concurrent ko/en SSR, matching boot data, canonical locale and base fallback passed.');
} finally { await server?.close(); }
