import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createServerCloser } from '../../examples/ssr/server-lifecycle.mjs';

test('a Vite close failure still closes the listening HTTP server and concurrent callers await the same cleanup', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { if (server.listening) server.close(); });
  const failure = new Error('Vite close failed');
  let calls = 0;
  const close = createServerCloser({ async close() { calls++; throw failure; } }, server);
  const first = close();
  assert.equal(close(), first);
  await assert.rejects(first, error => error === failure);
  assert.equal(server.listening, false);
  assert.equal(calls, 1);
  assert.equal(close(), first);
});

test('both cleanup failures are reported after both resources have been attempted', async () => {
  const viteFailure = new Error('Vite failed'), httpFailure = new Error('HTTP failed');
  const close = createServerCloser({ async close() { throw viteFailure; } }, {
    close(callback) { callback(httpFailure); },
  });
  await assert.rejects(close(), error => error instanceof AggregateError &&
    error.errors[0] === viteFailure && error.errors[1] === httpFailure);
});

test('cleanup accepts HTTP servers that never started or have already closed', async () => {
  await createServerCloser(undefined, createServer())();
});
