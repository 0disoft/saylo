import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';
import saylo from '@0disoft/saylo-vite';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const parent = path.join(repository, 'benchmarks');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const observations = [];
for (const recoveryGapMs of [0, 60, 0]) {
  const root = await mkdtemp(path.join(parent, '.rapid-probe-'));
  let server, timeout;
  try {
    for (const locale of ['en', 'fr']) {
      await mkdir(path.join(root, 'locales', locale), { recursive: true });
      await writeFile(path.join(root, 'locales', locale, 'demo.json'), '{"greeting":"Initial"}');
    }
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(root, 'main.mjs'), "export {catalogSource} from 'virtual:saylo/server';");
    server = await createServer({ configFile: false, root, logLevel: 'silent',
      plugins: [saylo({ localesDir: 'locales', baseLocale: 'en' })], server: { middlewareMode: true } });
    const { catalogSource } = await server.ssrLoadModule('/main.mjs');
    const file = path.join(root, 'locales/fr/demo.json');
    let resolveDiagnostic;
    const received = new Promise(resolve => { resolveDiagnostic = resolve; });
    const events = [];
    let diagnosticAt;
    const original = server.ws.send.bind(server.ws);
    server.ws.send = (...args) => {
      if (args[0]?.event === 'saylo:eager-diagnostic' && args[0].data.message) {
        diagnosticAt = performance.now(); resolveDiagnostic();
      }
      return original(...args);
    };
    server.watcher.on('change', changed => { if (path.resolve(changed) === file) events.push(performance.now()); });
    await delay(150); // Let the initial watcher settle; no browser or adapter involved.
    const startedAt = performance.now();
    await writeFile(file, '{');
    await Promise.race([received, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('No invalid JSON diagnostic.')), 2000);
    })]);
    clearTimeout(timeout);
    if (recoveryGapMs) await delay(recoveryGapMs);
    const validWriteStartedAt = performance.now();
    await writeFile(file, '{"greeting":"Recovered"}');
    await delay(250); // Observation window, not a latency benchmark.
    const result = await catalogSource.loadCatalog('fr', 'demo');
    assert.equal(result.status, 'present');
    const source = result.catalog.messages.greeting.source;
    const observation = { recoveryGapMs, validWriteAfterDiagnosticMs: validWriteStartedAt - diagnosticAt,
      changeEvents: events.map(time => time - startedAt), source,
      recovered: source === 'Recovered', revision: catalogSource.readManifest().registryRevision };
    observations.push(observation); console.log(JSON.stringify(observation));
  } finally {
    clearTimeout(timeout); await server?.close();
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('.rapid-probe-'))
      throw new Error('Refusing to remove a path outside the owned fixture.');
    await rm(resolved, { recursive: true, force: true });
  }
}
const files = ['benchmarks/thin-layer/rapid-recovery.mjs', 'packages/vite/dist/index.js',
  'packages/vite/dist/live-registry.js', 'node_modules/vite/dist/node/chunks/node.js', 'package-lock.json'];
const codeHashes = Object.fromEntries(await Promise.all(files.map(async file =>
  [file, createHash('sha256').update(await readFile(path.join(repository, file))).digest('hex')])));
const result = { schema: 'saylo-rapid-recovery-probe-v1', observedAt: new Date().toISOString(), node: process.version,
  scope: 'Three sequential fresh Vite SSR fixtures, real watcher, invalid JSON followed by valid write after diagnostic. No browser/i18next/UI. Catalog read 250ms after valid write; not a latency or cross-platform reliability claim. Bundled watcher contains a 50ms change-event throttle, but this probe does not disable it or prove causation.',
  codeHashes, observations };
await writeFile(new URL('../results/rapid-recovery-2026-10-11.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
