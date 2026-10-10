import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import toRuntime from 'wuchale/runtime';
import { compileTranslation } from 'wuchale/compiler';
import { createTranslator, parseCatalog } from '../../packages/core/dist/index.js';
import { createLayer } from './i18next-layer.mjs';

const base = JSON.parse('{"greeting":"Hello {name}","omitted":"Required {name}","rows":"{count, plural, one {one row} other {# rows}}","empty":"base","literal.dot":"literal","__proto__":"prototype literal","constructor":"constructor literal","reserved":"{lng} / {ns}","removed":"remove me"}');
const translated = { greeting: 'Hi {name}', omitted: 'No argument', empty: '' };
const sources = (target = translated, original = base) => [
  { source: JSON.stringify(original), locale: 'en', namespace: 'demo' },
  { source: JSON.stringify(target), locale: 'ru', namespace: 'demo' },
];
const core = (target = translated) => {
  const catalogs = sources(target).map(({ source, ...options }) => parseCatalog(source, options));
  return createTranslator({ locale: 'ru', timeZone: 'UTC', baseCatalogs: [catalogs[0]], translations: [catalogs[1]] });
};
const capture = fn => { try { return { value: fn() }; } catch (error) { return { error: error.name }; } };
const observations = [];
const record = (id, expected, actual) => { assert.deepEqual(actual, expected, id); observations.push({ id, actual }); };
const native = i18next.createInstance().use(new ICU());
await native.init({ lng: 'ru', fallbackLng: 'en', initAsync: false, ns: ['demo'], defaultNS: 'demo',
  keySeparator: false, resources: { en: { demo: base }, ru: { demo: translated } }, interpolation: { escapeValue: false },
  i18nFormat: { bindI18nStore: 'added removed', parseErrorHandler: error => { throw error; } } });
const fixed = native.getFixedT('ru', 'demo');
assert.equal(fixed('greeting', { name: 'Ada' }), 'Hi Ada');
native.addResourceBundle('ru', 'demo', { ...translated, greeting: 'Updated {name}' }, false, true);
record('i18next_live_resource_update_with_cache_events', { value: 'Updated Ada' }, capture(() => native.t('greeting', { name: 'Ada' })));
record('i18next_fixed_t_observes_new_resources', { value: 'Updated Ada' }, capture(() => fixed('greeting', { name: 'Ada' })));
record('i18next_missing_key_returns_key', { value: 'absent' }, capture(() => native.t('absent')));
record('i18next_omitted_base_argument_is_not_required', { value: 'No argument' }, capture(() => native.t('omitted')));
record('i18next_fallback_icu_uses_selected_locale', { value: 'one row' }, capture(() => native.t('rows', { count: 21 })));
record('saylo_fallback_icu_uses_base_locale', { value: '21 rows' }, capture(() => core().t('demo:rows', { count: 21 })));
record('i18next_numeric_string_is_accepted', { value: '2 rows' }, capture(() => native.t('rows', { count: '2' })));

const layer = await createLayer('en', sources(), 'ru');
const snapshot = layer.getSnapshot();
const reference = core();
const cases = [
  ['greeting', { name: 'Ada' }], ['omitted', { name: 'Ada' }], ['omitted', undefined],
  ['rows', { count: 21 }], ['rows', { count: '2' }], ['rows', { count: NaN }],
  ['empty', undefined], ['literal.dot', undefined], ['__proto__', undefined], ['constructor', undefined],
  ['reserved', { lng: 'customer', ns: 'order' }], ['absent', undefined],
];
for (const [index, [id, args]] of cases.entries()) record(`layer_matches_saylo_${index}_${id}`,
  capture(() => reference.t(`demo:${id}`, args)), capture(() => snapshot.t(`demo:${id}`, args)));
const initialStats = layer.getProbeStats();
await layer.replace(sources({ ...translated, greeting: 'Updated {name}' }));
const updateStats = layer.getProbeStats();
record('layer_incremental_preparation_reuses_unchanged_base', { parsedCatalogs: 1, resourceDictionaries: 1 }, {
  parsedCatalogs: updateStats.parsedCatalogs - initialStats.parsedCatalogs,
  resourceDictionaries: updateStats.resourceDictionaries - initialStats.resourceDictionaries,
});
record('layer_keeps_old_snapshot_bound_text', { value: 'Hi Ada' }, capture(() => snapshot.t('demo:greeting', { name: 'Ada' })));
record('layer_commits_new_text', { value: 'Updated Ada' }, capture(() => layer.getSnapshot().t('demo:greeting', { name: 'Ada' })));
const accepted = layer.getSnapshot();
await assert.rejects(layer.replace(sources({ greeting: '{unexpected}' })), error => error.name === 'CatalogError');
assert.equal(layer.getSnapshot(), accepted);
observations.push({ id: 'layer_rejects_invalid_schema_before_commit', actual: { snapshotIdentityRetained: true } });
await assert.rejects(layer.replace([{ ...sources()[0], source: '{"broken":"{"}' }, sources()[1]]), error => error.name === 'CatalogError');
assert.equal(layer.getSnapshot(), accepted);
observations.push({ id: 'layer_rejects_invalid_icu_before_commit', actual: { snapshotIdentityRetained: true } });
const retained = base.removed;
const withoutKey = { ...base }; delete withoutKey.removed;
await layer.replace(sources(translated, withoutKey));
record('layer_replaces_deleted_keys', { error: 'UnknownMessageError' }, capture(() => layer.getSnapshot().t('demo:removed')));
record('layer_old_snapshot_keeps_deleted_key', { value: retained }, capture(() => snapshot.t('demo:removed')));
const other = await createLayer('en', sources({ ...translated, greeting: 'Other {name}' }), 'ru');
record('layer_request_instances_are_isolated', { value: 'Other Ada' }, capture(() => other.getSnapshot().t('demo:greeting', { name: 'Ada' })));
record('layer_first_request_is_unchanged', { value: 'Hi Ada' }, capture(() => layer.getSnapshot().t('demo:greeting', { name: 'Ada' })));
await layer.replace([...sources(), { source: '{"greeting":"こんにちは {name}"}', locale: 'ja', namespace: 'demo' }], 'ja');
record('layer_added_locale_is_selectable', { value: 'こんにちは Ada' }, capture(() => layer.getSnapshot().t('demo:greeting', { name: 'Ada' })));
assert.deepEqual(layer.getSnapshot().availableLocales, ['en', 'ja', 'ru']);
assert.deepEqual(snapshot.availableLocales, ['en', 'ru']);
await layer.replace([sources()[0]], 'ja');
record('layer_removed_selected_locale_falls_back', { value: 'Hello Ada' }, capture(() => layer.getSnapshot().t('demo:greeting', { name: 'Ada' })));
assert.equal(layer.getSnapshot().locale, 'en');

const compiled = { c: [compileTranslation('Hi {0}')] };
const runtime = toRuntime(compiled, 'en');
record('wuchale_compiled_positional_interpolation', { value: 'Hi Ada' }, capture(() => runtime(0, ['Ada'])));
record('wuchale_named_icu_input_needs_conversion', { value: 'Hi {name}' }, capture(() => toRuntime({ c: [compileTranslation('Hi {name}')] }, 'en')(0, ['Ada'])));
record('wuchale_missing_positional_argument_is_not_rejected', { value: 'Hi undefined' }, capture(() => runtime(0)));
compiled.c = [compileTranslation('Updated {0}')];
record('wuchale_runtime_observes_module_replacement', { value: 'Updated Ada' }, capture(() => runtime(0, ['Ada'])));
function deepFreeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}
const isolated = toRuntime(deepFreeze({ c: structuredClone(compiled.c) }), 'en');
compiled.c = [compileTranslation('Later {0}')];
record('wuchale_isolated_module_keeps_snapshot', { value: 'Updated Ada' }, capture(() => isolated(0, ['Ada'])));
assert.throws(() => { isolated._.c[0][0] = 'Mutated '; }, TypeError);
observations.push({ id: 'wuchale_isolated_module_is_deeply_immutable', actual: { mutationRejected: true } });

const packages = {};
for (const name of ['i18next', 'i18next-icu', 'intl-messageformat', 'wuchale']) {
  const metadata = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, import.meta.url), 'utf8'));
  packages[name] = metadata.version;
}
const files = [new URL('probe.mjs', import.meta.url), new URL('i18next-layer.mjs', import.meta.url), new URL('catalog-layer.mjs', import.meta.url),
  new URL('package-lock.json', import.meta.url), new URL('../../packages/core/dist/schema.js', import.meta.url),
  new URL('../../packages/core/dist/catalog.js', import.meta.url), new URL('../../packages/core/dist/translator.js', import.meta.url)];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const codeHashes = Object.fromEntries(await Promise.all(files.map(async url =>
  [fileURLToPath(url).replace(fileURLToPath(new URL('../..', import.meta.url)), '').replaceAll('\\', '/').replace(/^\//, ''), hash(await readFile(url))])));
const result = { schema: 'saylo-thin-layer-contract-probe-v1', observedAt: new Date().toISOString(),
  environment: { node: process.version }, packages, codeHashes,
  scope: 'Node contract probe only: public i18next/ICU/Wuchale extension APIs and an isolated i18next AST-resource prototype reusing Saylo parser/schema. Native observations describe tested API behavior, not library defects. No Vite/browser, typegen, lazy session protocol, performance, memory, production bundle or timezone proof.',
  prototypeCosts: ['Saylo parser/schema retained', 'new i18next and ICU instances per committed snapshot',
    'incremental parsed catalog and AST resource reuse; revision instances still rebuilt', 'separate argument validation and source-locale fallback routing',
    'public error classes reused; no UI subscription/loader/disposal API implemented'], observations };
await writeFile(new URL('../results/thin-layer-contracts-2026-10-11.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ packages, observations: observations.length, result: 'benchmarks/results/thin-layer-contracts-2026-10-11.json' }));
