import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { clientStagePlugins, validateClientStages } from './client-profile.mjs';
import * as probe from './client-probe.mjs';
import { freeze, isDeepFrozen } from '../../packages/core/dist/diagnostics.js';
import { localeBrowserMetrics } from './browser-profile.mjs';

function remainingStages() {
  for (const m of ['decodeMs', 'freezeMs'])
    probe.measureBrowserStage(m, () => {});
  probe.measureBrowserStage('snapshotMs', () => {
    probe.measureBrowserStage('translatorMs', () => {});
    probe.measureBrowserStage('signatureMs', () => {});
  });
}
test('app and optimizer helper copies share observations without changing product freeze trust', async () => {
  const other = await import('./client-probe.mjs?optimizer-copy');
  const receivedAt = performance.now();
  probe.beginClientSample(receivedAt);
  const catalog = { nested: { value: 1 } };
  other.observeViteFrozen([freeze(catalog)]);
  other.observeCoreTrust({ status: 'present', key: { locale: 'en-GB', namespace: 'bench' }, catalog }, isDeepFrozen);
  other.measureBrowserStage('acceptMs', () => {
    other.measureBrowserStage('acceptCheckMs', () => {});
    other.measureBrowserStage('acceptFreezeMs', () => {});
  });
  remainingStages();
  other.captureClientPublication(performance.now());
  const committedAt = performance.now();
  const result = probe.finishClientSample(committedAt);
  validateClientStages(result, committedAt - receivedAt);
  assert.deepEqual(result.trust, { locale: 'en-GB', namespace: 'bench', sameCatalog: true, trusted: true });
  assert.equal(isDeepFrozen(Object.freeze({ nested: {} })), false);
  assert.equal(other.measureBrowserStage('decodeMs', () => 'reset'), 'reset');
});

test('trust can be false for the same frozen object and invalid publication cannot pass', () => {
  const receivedAt = performance.now();
  probe.beginClientSample(receivedAt);
  assert.throws(() => probe.beginClientSample(receivedAt), /overlapping/);
  const catalog = Object.freeze({ nested: {} });
  probe.observeViteFrozen([catalog]);
  probe.observeCoreTrust({ status: 'present', key: { locale: 'en-GB', namespace: 'bench' }, catalog }, isDeepFrozen);
  probe.measureBrowserStage('acceptMs', () => {
    probe.measureBrowserStage('acceptCheckMs', () => {});
    probe.measureBrowserStage('acceptFreezeMs', () => freeze(catalog));
  });
  remainingStages();
  assert.throws(() => probe.captureClientPublication(receivedAt - 1), /publication/);
  probe.captureClientPublication(performance.now());
  assert.throws(() => probe.captureClientPublication(performance.now()), /publication/);
  assert.throws(() => probe.measureBrowserStage('decodeMs', () => {}), /after publication/);
  const committedAt = performance.now();
  const sample = probe.finishClientSample(committedAt);
  validateClientStages(sample, committedAt - receivedAt);
  assert.equal(sample.trust.sameCatalog, true);
  assert.equal(sample.trust.trusted, false);
  assert.ok(Object.isFrozen(catalog.nested));
  const copy = () => structuredClone(sample);
  const overlapping = copy(); overlapping.timings.clientOtherMs += 10;
  assert.throws(() => validateClientStages(overlapping, committedAt - receivedAt), /windows/);
  const missing = copy(); missing.calls.freezeMs = 0;
  assert.throws(() => validateClientStages(missing, committedAt - receivedAt), /observations/);
  assert.throws(() => validateClientStages(sample, NaN), /observations/);
  probe.beginClientSample(performance.now());
  assert.throws(() => probe.finishClientSample(performance.now()), /Incomplete/);
});

test('normal-prebundle transformation preserves acceptance and observes core trust before freeze', async () => {
  const url = new URL('../../packages/core/dist/loading-registry.js', import.meta.url);
  const code = await readFile(url, 'utf8');
  const plugins = clientStagePlugins(true);
  const transformed = plugins.optimizer.transform(code, url.pathname).code;
  const executable = transformed.replace(/from '[^']*client-probe.mjs'/g, `from '${new URL('./client-probe.mjs', import.meta.url).href}'`)
    .replace(/from '(\.\/[^']+)'/g, (_, relative) => `from '${new URL(relative, url).href}'`);
  const instrumented = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
  const original = await import(url);
  const { parseCatalog, createBaseSchema } = await import('../../packages/core/dist/index.js');
  const base = parseCatalog('{"probe":"ready"}', { locale: 'en', namespace: 'bench', sourceName: 'base.json' });
  const fingerprint = createBaseSchema(base).fingerprint;
  const key = { locale: 'en-GB', namespace: 'bench' };
  const manifestInput = { sessionId: 'test', registryRevision: 1, baseLocale: 'en', availableLocales: ['en', 'en-GB'],
    availableNamespaces: ['bench'], catalogs: [{ key: { locale: 'en', namespace: 'bench' }, status: 'present', catalogVersion: 1,
      namespaceSchemaFingerprint: fingerprint }, { key, status: 'present', catalogVersion: 1, namespaceSchemaFingerprint: fingerprint }] };
  const manifest = instrumented.readManifest(manifestInput);
  const catalog = JSON.parse(JSON.stringify({ ...base, locale: 'en-GB' }));
  const outcome = { sessionId: 'test', key, status: 'present', catalogVersion: 1, namespaceSchemaFingerprint: fingerprint, catalog };
  const receivedAt = performance.now();
  probe.beginClientSample(receivedAt);
  probe.observeViteFrozen([freeze(catalog)]);
  const accepted = instrumented.acceptOutcome(manifest, key, outcome);
  remainingStages(); probe.captureClientPublication(performance.now());
  const committedAt = performance.now(), sample = probe.finishClientSample(committedAt);
  validateClientStages(sample, committedAt - receivedAt);
  assert.equal(sample.trust.trusted, true);
  assert.deepEqual(accepted, original.acceptOutcome(original.readManifest(manifestInput), key, outcome));
  for (const bad of [{ ...outcome, sessionId: 'old' }, { ...outcome, catalog: { ...catalog, locale: 'fr' } }]) {
    let expected;
    try { original.acceptOutcome(original.readManifest(manifestInput), key, bad); } catch (error) { expected = error; }
    assert.ok(expected);
    assert.throws(() => instrumented.acceptOutcome(manifest, key, bad), error => error.code === expected.code && error.message === expected.message);
  }
  for (const bad of [undefined, { ...outcome, key: undefined }, { ...outcome, catalog: undefined }]) {
    let expected;
    try { original.acceptOutcome(original.readManifest(manifestInput), key, bad); } catch (error) { expected = error; }
    assert.ok(expected);
    probe.beginClientSample(performance.now());
    assert.throws(() => instrumented.acceptOutcome(manifest, key, bad), error => error.code === expected.code && error.message === expected.message);
    assert.throws(() => probe.finishClientSample(performance.now()), /Incomplete/);
  }
  assert.ok(transformed.includes("import { isDeepFrozen } from './diagnostics.js'"));
  assert.throws(() => plugins.assertTransformed(), /Incomplete/);
});

test('disabled mode performs no product transforms and optimizer instrumentation fails closed', async () => {
  const url = new URL('../../packages/core/dist/loading-registry.js', import.meta.url);
  const code = await readFile(url, 'utf8');
  const disabled = clientStagePlugins(false);
  assert.equal(disabled.optimizer.transform(code, url.pathname), undefined);
  assert.equal(disabled.plugin.transform(code, url.pathname), undefined);
  const resolved = disabled.plugin.resolveId('virtual:saylo-benchmark/client-profile');
  assert.ok(disabled.plugin.load(resolved).includes('clientStagesEnabled = false'));
  disabled.assertTransformed();
  const active = clientStagePlugins(true);
  assert.throws(() => active.optimizer.transform(code.replace('return freeze({ ...outcome, key: { ...key } });', 'return outcome;'), url.pathname), /acceptance split/);
  assert.equal(active.optimizerTransformed.size, 0);
});
