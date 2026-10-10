import test from 'node:test';
import assert from 'node:assert/strict';
import { IntlMessageFormat } from 'intl-messageformat';
import { parseCatalog, createTranslator } from '../../packages/core/dist/index.js';
import { createCatalogLayer } from './catalog-layer.mjs';
import { createLayer } from './i18next-layer.mjs';

const at = new Date('2026-01-01T00:30:00.000Z');
const message = '{at, date} / {at, time, ::HHmm}';
const catalog = (locale, when = message) => parseCatalog(JSON.stringify({ when }), { locale, namespace: 'demo' });
const reference = (catalogs, locale, timeZone) => createTranslator({ locale, timeZone,
  baseCatalogs: catalogs.filter(c => c.locale === 'en'), translations: catalogs.filter(c => c.locale !== 'en') });

test('default UTC, canonical aliases and invalid timezones follow the core contract', async () => {
  const catalogs = [catalog('en')];
  const layer = await createCatalogLayer('en', catalogs, 'en');
  const alias = await createCatalogLayer('en', catalogs, 'en', { timeZone: 'Etc/UTC' });
  assert.equal(layer.getSnapshot().timeZone, 'UTC');
  assert.equal(alias.getSnapshot().timeZone, 'UTC');
  assert.equal(layer.getSnapshot().t('demo:when', { at }), reference(catalogs, 'en', 'UTC').t('demo:when', { at }));
  await assert.rejects(createCatalogLayer('en', catalogs, 'en', { timeZone: 'invalid-zone' }), RangeError);
});

test('simultaneous requests with shared catalogs keep different timezones and original AST intact', async () => {
  const catalogs = [catalog('en')];
  const astBefore = JSON.stringify(catalogs);
  const formatsBefore = JSON.stringify(IntlMessageFormat.formats);
  const [seoul, la] = await Promise.all(['Asia/Seoul', 'America/Los_Angeles']
    .map(timeZone => createCatalogLayer('en', catalogs, 'en', { timeZone })));
  const expected = timeZone => reference(catalogs, 'en', timeZone).t('demo:when', { at });
  for (let i = 0; i < 3; i++) {
    assert.equal(seoul.getSnapshot().t('demo:when', { at }), expected('Asia/Seoul'));
    assert.equal(la.getSnapshot().t('demo:when', { at }), expected('America/Los_Angeles'));
  }
  assert.notEqual(expected('Asia/Seoul'), expected('America/Los_Angeles'));
  assert.equal(JSON.stringify(catalogs), astBefore);
  assert.equal(JSON.stringify(IntlMessageFormat.formats), formatsBefore);
});

test('replacements bind new text without changing retained snapshots, timezone or another request', async () => {
  const catalogs = [catalog('en'), catalog('ru')];
  const layers = await Promise.all(['Asia/Seoul', 'America/Los_Angeles']
    .map(timeZone => createCatalogLayer('en', catalogs, 'ru', { timeZone })));
  const retained = layers.map(layer => layer.getSnapshot());
  const expected = retained.map(snapshot => snapshot.t('demo:when', { at }));
  const changed = [catalogs[0], catalog('ru', `Updated ${message}`)];
  await layers[0].replace(changed);
  assert.equal(layers[0].getSnapshot().t('demo:when', { at }), `Updated ${expected[0]}`);
  assert.equal(layers[0].getSnapshot().timeZone, 'Asia/Seoul');
  assert.equal(layers[0].getProbeStats().resourceDictionaries, 3, 'reuse unchanged base dictionary');
  assert.equal(retained[0].t('demo:when', { at }), expected[0]);
  assert.equal(retained[1].t('demo:when', { at }), expected[1]);
  assert.equal(layers[1].getSnapshot(), retained[1]);
  const accepted = layers[0].getSnapshot();
  await assert.rejects(layers[0].replace([catalogs[0], catalog('ru', '{unexpected}')]), { name: 'CatalogError' });
  assert.equal(layers[0].getSnapshot(), accepted);
  assert.equal(accepted.t('demo:when', { at }), `Updated ${expected[0]}`);
});

test('fallback dates use the source locale and fixed timezone after selected locale removal', async () => {
  const catalogs = [catalog('en'), parseCatalog('{}', { locale: 'ru', namespace: 'demo' })];
  const layer = await createCatalogLayer('en', catalogs, 'ru', { timeZone: 'America/Los_Angeles' });
  const expected = reference(catalogs, 'ru', 'America/Los_Angeles').t('demo:when', { at });
  assert.equal(layer.getSnapshot().t('demo:when', { at }), expected);
  await layer.replace([catalogs[0]]);
  assert.equal(layer.getSnapshot().locale, 'en');
  assert.equal(layer.getSnapshot().timeZone, 'America/Los_Angeles');
  assert.equal(layer.getSnapshot().t('demo:when', { at }), expected);
});

test('Node source adapter forwards timezone and ignores later caller option mutations', async () => {
  const options = { timeZone: 'Asia/Seoul' };
  const sources = [{ source: JSON.stringify({ when: message }), locale: 'en', namespace: 'demo' }];
  const layer = await createLayer('en', sources, 'en', options);
  const expected = reference([catalog('en')], 'en', options.timeZone).t('demo:when', { at });
  options.timeZone = 'America/Los_Angeles';
  await layer.replace([{ ...sources[0], source: JSON.stringify({ when: `Latest ${message}` }) }]);
  assert.equal(layer.getSnapshot().timeZone, 'Asia/Seoul');
  assert.equal(layer.getSnapshot().t('demo:when', { at }), `Latest ${expected}`);
});
