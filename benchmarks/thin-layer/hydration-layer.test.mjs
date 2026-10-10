import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCatalog, createBootSnapshot, serializeBootSnapshot } from '../../packages/core/dist/index.js';
import { createHydrationLayer } from './hydration-layer.mjs';
import { createSsrFixture } from './ssr-fixture.mjs';

test('boot decoding rejects malformed wire, schema mismatch and conflicting timezone', async () => {
  const fixture = createSsrFixture();
  await assert.rejects(createHydrationLayer('{'), { code: 'INVALID_BOOT' });
  const corrupted = JSON.parse(fixture.wire);
  corrupted.baseSchemas[0].fingerprint = 'wrong';
  await assert.rejects(createHydrationLayer(JSON.stringify(corrupted)), { code: 'INVALID_BOOT' });
  await assert.rejects(createHydrationLayer(fixture.wire, { timeZone: 'Asia/Seoul' }), { code: 'INVALID_BOOT' });
  const alias = await createHydrationLayer(fixture.wire, { timeZone: 'Etc/UTC' });
  assert.equal(alias.getSnapshot().timeZone, 'UTC'); alias.dispose();
});

test('multiple early replacements stay boot-bound until one idempotent release', async () => {
  const fixture = createSsrFixture();
  const adapter = await createHydrationLayer(fixture.wire);
  const retained = adapter.getServerSnapshot();
  const initial = retained.t('demo:greeting', { name: 'Ada' });
  let notifications = 0;
  const unsubscribe = adapter.subscribe(() => notifications++);
  await adapter.replace(fixture.updates[0]); await adapter.replace(fixture.updates[1]);
  assert.equal(adapter.getSnapshot(), retained); assert.equal(notifications, 0);
  adapter.finishHydration();
  assert.equal(adapter.getSnapshot().t('demo:greeting', { name: 'Ada' }), 'Latest Ada');
  assert.equal(notifications, 1);
  adapter.finishHydration(); assert.equal(notifications, 1);
  await adapter.replace(fixture.updates[2]); assert.equal(notifications, 2);
  assert.equal(adapter.getSnapshot().t('demo:greeting', { name: 'Ada' }), 'Post Ada');
  assert.equal(retained.t('demo:greeting', { name: 'Ada' }), initial);
  unsubscribe(); adapter.dispose();
});

test('invalid queued translations do not replace the last valid pending candidate', async () => {
  const fixture = createSsrFixture();
  const adapter = await createHydrationLayer(fixture.wire);
  await adapter.replace(fixture.updates[1]);
  const invalid = [fixture.updates[1][0], parseCatalog('{"greeting":"{unexpected}"}', { locale: 'ru', namespace: 'demo' })];
  await assert.rejects(adapter.replace(invalid), { name: 'CatalogError' });
  adapter.finishHydration();
  assert.equal(adapter.getSnapshot().t('demo:greeting', { name: 'Ada' }), 'Latest Ada');
  adapter.dispose();
});

test('simultaneous requests have separate hydration barriers and timezones', async () => {
  const fixtures = ['UTC', 'Asia/Seoul', 'America/Los_Angeles'].map(timeZone => createSsrFixture({ timeZone }));
  const adapters = await Promise.all(fixtures.map(fixture => createHydrationLayer(fixture.wire)));
  await Promise.all(adapters.map((adapter, index) => adapter.replace(fixtures[index].updates[1])));
  const retained = adapters.map(adapter => adapter.getServerSnapshot());
  adapters[1].finishHydration();
  assert.equal(adapters[0].getSnapshot(), retained[0]); assert.equal(adapters[2].getSnapshot(), retained[2]);
  assert.equal(adapters[1].getSnapshot().t('demo:greeting', { name: 'Ada' }), 'Latest Ada');
  for (let i = 0; i < adapters.length; i++) {
    assert.equal(adapters[i].getSnapshot().timeZone, fixtures[i].boot.timeZone);
    adapters[i].dispose();
  }
});

test('disposal removes listeners and rejects updates/subscriptions without emitting on release', async () => {
  const fixture = createSsrFixture();
  const adapter = await createHydrationLayer(fixture.wire);
  let notifications = 0;
  adapter.subscribe(() => notifications++);
  await adapter.replace(fixture.updates[1]); adapter.dispose(); adapter.dispose(); adapter.finishHydration();
  assert.equal(notifications, 0);
  assert.throws(() => adapter.subscribe(() => {}), { name: 'I18nDisposedError' });
  await assert.rejects(adapter.replace(fixture.updates[2]), { name: 'I18nDisposedError' });
});

test('explicit missing target pairs preserve the selected boot locale and manifest availability', async () => {
  const fixture = createSsrFixture();
  const input = structuredClone(fixture.boot);
  input.manifest.catalogs = input.manifest.catalogs.map(meta => meta.key.locale === 'ru'
    ? { key: meta.key, status: 'missing', catalogVersion: 1 } : meta);
  input.catalogOutcomes = input.catalogOutcomes.map(outcome => outcome.key.locale === 'ru'
    ? { sessionId: outcome.sessionId, key: outcome.key, status: 'missing', catalogVersion: 1 } : outcome);
  const adapter = await createHydrationLayer(serializeBootSnapshot(createBootSnapshot(input)));
  const retained = adapter.getServerSnapshot();
  assert.equal(retained.locale, 'ru'); assert.deepEqual(retained.availableLocales, ['en', 'ru']);
  assert.ok(retained.t('demo:greeting', { name: 'Ada' }).startsWith('Server Ada'));
  await adapter.replace(fixture.updates[1]); adapter.finishHydration();
  assert.equal(adapter.getSnapshot().locale, 'ru');
  assert.equal(adapter.getSnapshot().t('demo:greeting', { name: 'Ada' }), 'Latest Ada');
  assert.ok(retained.t('demo:greeting', { name: 'Ada' }).startsWith('Server Ada'));
  adapter.dispose();
});
