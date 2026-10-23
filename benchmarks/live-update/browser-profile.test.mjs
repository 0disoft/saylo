import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { browserMetrics, localeBrowserMetrics, validateLocaleBrowserStages, browserStagePlugin } from './browser-profile.mjs';
import { beginBrowserSample, finishBrowserSample, measureBrowserStage } from './browser-probe.mjs';

test('full selection measures decode without patch and ends before reset work', () => {
  beginBrowserSample('locale-add');
  measureBrowserStage('decodeMs', () => 'decoded');
  measureBrowserStage('freezeMs', () => 'frozen');
  measureBrowserStage('acceptMs', () => {
    measureBrowserStage('acceptCheckMs', () => 'checked');
    measureBrowserStage('acceptFreezeMs', () => 'frozen outcome');
  });
  measureBrowserStage('snapshotMs', () => {
    measureBrowserStage('translatorMs', () => 'translator');
    measureBrowserStage('signatureMs', () => 'signature');
  });
  const sample = finishBrowserSample(1000);
  validateLocaleBrowserStages(sample, 1000);
  assert.deepEqual(Object.keys(sample.calls), localeBrowserMetrics);
  assert.ok(!('patchMs' in sample.calls));
  assert.equal(measureBrowserStage('freezeMs', () => 'reset'), 'reset');
  assert.equal(sample.calls.freezeMs, 1);
});

test('edit requirements remain patch-specific and missing full decode cannot report success', () => {
  beginBrowserSample();
  for (const metric of browserMetrics) measureBrowserStage(metric, () => {});
  assert.deepEqual(Object.keys(finishBrowserSample().calls), browserMetrics);
  beginBrowserSample('locale-add');
  assert.throws(() => beginBrowserSample(), /overlapping/);
  for (const metric of localeBrowserMetrics.filter(name => name !== 'decodeMs')) measureBrowserStage(metric, () => {});
  assert.throws(() => finishBrowserSample(1000), /Missing browser stage/);
});

test('selection acknowledgements reject missing calls, nonfinite timings and overlapping residuals', () => {
  const valid = { timings: { decodeMs: 10, freezeMs: 20, acceptMs: 20, acceptCheckMs: 2, acceptFreezeMs: 15,
    acceptOtherMs: 3, snapshotMs: 30, translatorMs: 12, signatureMs: 8,
    snapshotOtherMs: 10, selectionOtherMs: 20 }, calls: Object.fromEntries(localeBrowserMetrics.map(name => [name, 1])) };
  validateLocaleBrowserStages(valid, 100);
  const copy = () => structuredClone(valid);
  const missing = copy(); missing.calls.decodeMs = 0;
  assert.throws(() => validateLocaleBrowserStages(missing, 100));
  const invalid = copy(); invalid.timings.freezeMs = Infinity;
  assert.throws(() => validateLocaleBrowserStages(invalid, 100));
  const nested = copy(); nested.timings.translatorMs = 40;
  assert.throws(() => validateLocaleBrowserStages(nested, 100));
  const residual = copy(); residual.timings.selectionOtherMs = 60;
  assert.throws(() => validateLocaleBrowserStages(residual, 100));
  const acceptance = copy(); acceptance.timings.acceptFreezeMs = 25;
  assert.throws(() => validateLocaleBrowserStages(acceptance, 100));
  const incomplete = copy(); incomplete.calls.acceptFreezeMs = 2;
  assert.throws(() => validateLocaleBrowserStages(incomplete, 100), /Incomplete/);
  assert.throws(() => validateLocaleBrowserStages(valid, 50));
});

const registryUrl = new URL('../../packages/core/dist/loading-registry.js', import.meta.url);
const probeUrl = new URL('./browser-probe.mjs', import.meta.url);

test('acceptance transform preserves valid, stale, payload and schema behavior and counts nested stages', async () => {
  const code = await readFile(registryUrl, 'utf8');
  const plugin = browserStagePlugin(true, 'locale-add');
  const transformed = plugin.transform(code, registryUrl.pathname).code;
  const executable = transformed.replaceAll('virtual:saylo-benchmark/browser-profile', probeUrl.href)
    .replace(/from '(\.\/[^']+)'/g, (_, relative) => `from '${new URL(relative, registryUrl).href}'`);
  const instrumented = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
  const original = await import(registryUrl.href);
  const { parseCatalog, createBaseSchema } = await import('../../packages/core/dist/index.js');
  const catalog = parseCatalog('{"probe":"ready"}', { locale: 'en', namespace: 'bench', sourceName: 'bench.json' });
  const fingerprint = createBaseSchema(catalog).fingerprint;
  const key = { locale: 'en', namespace: 'bench' };
  const manifestInput = { sessionId: 'test', registryRevision: 1, baseLocale: 'en', availableLocales: ['en'],
    availableNamespaces: ['bench'], catalogs: [{ key, status: 'present', catalogVersion: 1, namespaceSchemaFingerprint: fingerprint }] };
  const manifest = instrumented.readManifest(manifestInput);
  const originalManifest = original.readManifest(manifestInput);
  const received = Object.freeze(JSON.parse(JSON.stringify(catalog)));
  assert.equal(Object.isFrozen(received.messages.probe.ast), false);
  const outcome = { sessionId: 'test', key, status: 'present', catalogVersion: 1, namespaceSchemaFingerprint: fingerprint, catalog: received };
  beginBrowserSample('locale-add');
  const accepted = instrumented.acceptOutcome(manifest, key, outcome);
  measureBrowserStage('decodeMs', () => {});
  measureBrowserStage('freezeMs', () => {});
  measureBrowserStage('snapshotMs', () => {
    measureBrowserStage('translatorMs', () => {});
    measureBrowserStage('signatureMs', () => {});
  });
  const sample = finishBrowserSample(1000);
  validateLocaleBrowserStages(sample, 1000);
  for (const metric of ['acceptMs', 'acceptCheckMs', 'acceptFreezeMs']) assert.equal(sample.calls[metric], 1);
  assert.deepEqual(accepted, original.acceptOutcome(originalManifest, key, outcome));
  assert.ok(Object.isFrozen(accepted) && Object.isFrozen(accepted.key) && Object.isFrozen(accepted.catalog.messages));
  assert.ok(Object.isFrozen(accepted.catalog.messages.probe.ast) && Object.isFrozen(accepted.catalog.messages.probe.ast[0].location.start));
  for (const bad of [
    { ...outcome, sessionId: 'old' },
    { ...outcome, catalog: { ...catalog, locale: 'fr' } },
    { ...outcome, catalog: parseCatalog('{"probe":"{name}"}', { locale: 'en', namespace: 'bench', sourceName: 'bad.json' }) },
  ]) {
    let expected;
    try { original.acceptOutcome(originalManifest, key, bad); } catch (error) { expected = error; }
    assert.ok(expected);
    assert.throws(() => instrumented.acceptOutcome(manifest, key, bad), error => error.code === expected.code && error.message === expected.message);
  }
  assert.deepEqual([...plugin.transformed], ['acceptMs', 'snapshotMs']);
});

test('acceptance split fails closed on changed dist and edit/disabled modes leave acceptance alone', async () => {
  const code = await readFile(registryUrl, 'utf8');
  const plugin = browserStagePlugin(true, 'locale-add');
  assert.throws(() => plugin.assertTransformed(), /Incomplete/);
  assert.throws(() => plugin.transform(code.replace('return immutableSnapshot({ ...outcome, key: { ...key } });', 'return outcome;'), registryUrl.pathname), /acceptance split/);
  assert.equal(plugin.transformed.size, 0);
  const edit = browserStagePlugin(true).transform(code, registryUrl.pathname).code;
  assert.ok(edit.includes('export function acceptOutcome(manifest, key, outcome)'));
  assert.ok(!edit.includes('acceptCheckMs'));
  const disabled = browserStagePlugin(false, 'locale-add');
  assert.equal(disabled.transform(code, registryUrl.pathname), undefined);
  disabled.assertTransformed();
});
