import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { IntlMessageFormat } from 'intl-messageformat';
import { createTranslator, parseCatalog } from '../../packages/core/dist/index.js';
import { createCatalogLayer } from './catalog-layer.mjs';

const zones = ['UTC', 'Asia/Seoul', 'America/Los_Angeles'];
const messages = {
  dateDefault: '{at, date}', timeDefault: '{at, time}',
  dateSkeleton: '{at, date, ::yyyyMMdd}', timeSkeleton: '{at, time, ::HHmm}',
  nestedSkeleton: '{kind, select, date {{at, date, ::yyyyMMdd}} other {{at, time, ::HHmm}}}',
};
for (const style of ['short', 'medium', 'long', 'full']) {
  messages[`date${style}`] = `{at, date, ${style}}`;
  messages[`time${style}`] = `{at, time, ${style}}`;
}
const translated = { ...messages };
delete translated.datefull; // Also test the source locale of a fallback.
const catalogs = [messages, translated].map((source, index) => parseCatalog(JSON.stringify(source), {
  locale: index ? 'ru' : 'en', namespace: 'demo',
}));

async function observe() {
  const hostZone = new Intl.DateTimeFormat('en').resolvedOptions().timeZone;
  assert.equal(hostZone, process.env.TZ);
  const core = timeZone => createTranslator({ locale: 'ru', timeZone,
    baseCatalogs: [catalogs[0]], translations: [catalogs[1]] });
  const utc = core('UTC'), host = core(hostZone);
  const layer = await createCatalogLayer('en', catalogs, 'ru');
  const configured = await createCatalogLayer('en', catalogs, 'ru', { timeZone: hostZone });
  assert.equal(layer.getSnapshot().timeZone, 'UTC');
  assert.equal(configured.getSnapshot().timeZone, hostZone);
  // Public formats option: add UTC to every built-in named date/time style.
  // No static vendor objects or global Intl APIs are mutated.
  const formats = Object.fromEntries(['date', 'time'].map(type => [type,
    Object.fromEntries(Object.entries(IntlMessageFormat.formats[type])
      .map(([style, options]) => [style, { ...options, timeZone: 'UTC' }]))]));
  const namedUTC = i18next.createInstance().use(new ICU());
  await namedUTC.init({ lng: 'ru', fallbackLng: 'en', ns: ['demo'], defaultNS: 'demo',
    initAsync: false, keySeparator: false, interpolation: { escapeValue: false },
    resources: { en: { demo: messages }, ru: { demo: translated } },
    i18nFormat: { formats, parseErrorHandler: error => { throw error; } } });
  const rows = [];
  for (const instant of ['2026-01-01T00:30:00.000Z', '2026-06-30T23:30:00.000Z']) {
    for (const argumentType of ['number', 'Date']) {
      const at = argumentType === 'Date' ? new Date(instant) : Date.parse(instant);
      for (const id of Object.keys(messages)) {
        for (const kind of id === 'nestedSkeleton' ? ['date', 'time'] : ['date']) {
          const args = { at, kind };
          const key = `demo:${id}`;
          const actual = layer.getSnapshot().t(key, args);
          const expected = utc.t(key, args);
          const hostExpected = host.t(key, args);
          const native = namedUTC.t(id, { ...args, lng: Object.hasOwn(translated, id) ? 'ru' : 'en' });
          const configuredActual = configured.getSnapshot().t(key, args);
          assert.equal(actual, expected, `default UTC/${hostZone}/${id}/${instant}/${argumentType}`);
          assert.equal(configuredActual, hostExpected, `explicit zone/${hostZone}/${id}/${instant}/${argumentType}`);
          if (/^(date|time)(short|medium|long|full)$/.test(id) || id === 'timeDefault')
            assert.equal(native, expected, `named UTC/${id}`);
          rows.push({ id, kind, instant, argumentType, expectedUTC: expected, actualLayer: actual,
            expectedHost: hostExpected, configuredLayer: configuredActual,
            publicNamedUTC: native, layerMatchesUTC: actual === expected,
            configuredMatchesHost: configuredActual === hostExpected, namedMatchesUTC: native === expected });
        }
      }
    }
  }
  if (hostZone === 'UTC') assert.ok(rows.every(row => row.layerMatchesUTC && row.namedMatchesUTC));
  else {
    assert.ok(rows.every(row => row.layerMatchesUTC && row.configuredMatchesHost));
    for (const id of ['dateDefault', 'dateSkeleton', 'timeSkeleton', 'nestedSkeleton'])
      assert.ok(rows.some(row => row.id === id && !row.namedMatchesUTC), `${hostZone}/${id} exposes unnamed/skeleton gap`);
  }
  return { hostZone, cases: rows.length, layerUTCFailures: rows.filter(row => !row.layerMatchesUTC).length,
    configuredTimeZoneFailures: rows.filter(row => !row.configuredMatchesHost).length,
    publicNamedUTCFailures: rows.filter(row => !row.namedMatchesUTC).length, rows };
}

if (process.argv.includes('--worker')) {
  process.stdout.write(JSON.stringify(await observe()));
} else {
  const root = new URL('../../', import.meta.url);
  const paths = ['benchmarks/thin-layer/timezone-probe.mjs', 'benchmarks/thin-layer/catalog-layer.mjs',
    'benchmarks/thin-layer/ast-format.mjs',
    'benchmarks/thin-layer/package-lock.json', 'packages/core/src/formatters.ts',
    'packages/core/src/translator.ts', 'packages/core/dist/formatters.js', 'packages/core/dist/translator.js'];
  const entries = new Map(paths.map(path => [path, new URL(path, root)]));
  for (const name of ['i18next', 'i18next-icu', 'intl-messageformat'])
    entries.set(`thin-layer dependency entry: ${name}`, new URL(import.meta.resolve(name)));
  const coreRequire = createRequire(new URL('packages/core/dist/formatters.js', root));
  entries.set('core dependency entry: intl-messageformat', coreRequire.resolve('intl-messageformat'));
  const fingerprint = async () => Object.fromEntries(await Promise.all([...entries].map(async ([path, location]) => [path,
    createHash('sha256').update(await readFile(location)).digest('hex')])));
  const before = await fingerprint();
  const results = zones.map(zone => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
      env: { ...process.env, TZ: zone }, encoding: 'utf8', timeout: 15000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  });
  assert.deepEqual(await fingerprint(), before, 'source and dist unchanged');
  const versions = Object.fromEntries(await Promise.all(['i18next', 'i18next-icu', 'intl-messageformat']
    .map(async name => [name, JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, import.meta.url))).version])));
  const output = process.argv.indexOf('--out');
  const out = output < 0 ? new URL('../results/thin-layer-timezone-fixed-2026-10-11.json', import.meta.url) : process.argv[output + 1];
  assert.ok(out, '--out requires a path');
  await writeFile(out, JSON.stringify({ format: 'saylo-thin-layer-timezone-v2', observedAt: new Date().toISOString(),
    node: process.version, versions, hashes: before,
    scope: 'Node-only default UTC and explicit timezone contract probe for the custom i18next i18nFormat layer. Native i18next-icu formats workaround remains a separate reference. Separate child processes control host TZ; no global formatter mutation. Not browser/SSR hydration/performance proof.',
    results }, null, 2) + '\n');
  for (const { hostZone, cases, layerUTCFailures, configuredTimeZoneFailures, publicNamedUTCFailures } of results)
    console.log(`${hostZone}: ${cases} cases, default UTC mismatches ${layerUTCFailures}, explicit zone mismatches ${configuredTimeZoneFailures}, native named-format UTC mismatches ${publicNamedUTCFailures}`);
  console.log(`Saved ${out}`);
}
