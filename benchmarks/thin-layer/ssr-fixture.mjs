import { createBaseSchema, createBootSnapshot, serializeBootSnapshot } from '@0disoft/saylo-core/runtime';
import { parseCatalog } from '../../packages/core/dist/index.js';

const unsafe = '</script><script>globalThis.__thinInjected=1</script>\u2028\u2029';
const source = locale => locale === 'en'
  ? { greeting: `Server {name} ${unsafe}`, when: '{at, date} / {at, time, ::HHmm}', rows: '{count, plural, one {one row} other {# rows}}' }
  : { greeting: `Сервер {name} ${unsafe}` };
export function createSsrFixture({ locale = 'ru', timeZone = 'UTC', sessionId = 'thin-ssr' } = {}) {
  const catalogs = ['en', 'ru'].map(locale => parseCatalog(JSON.stringify(source(locale)), { locale, namespace: 'demo' }));
  const namespaceSchemaFingerprint = createBaseSchema(catalogs[0]).fingerprint;
  const outcomes = catalogs.map(catalog => ({ sessionId, status: 'present', key: { locale: catalog.locale, namespace: 'demo' },
    catalogVersion: 1, namespaceSchemaFingerprint, catalog }));
  const manifest = { sessionId, registryRevision: 0, baseLocale: 'en', availableLocales: ['en', 'ru'], availableNamespaces: ['demo'],
    catalogs: outcomes.map(({ key, status, catalogVersion, namespaceSchemaFingerprint }) => ({ key, status, catalogVersion, namespaceSchemaFingerprint })) };
  const loaded = outcomes.filter(outcome => outcome.key.locale === 'en' || outcome.key.locale === locale);
  const boot = createBootSnapshot({ manifest, locale, timeZone, stateRevision: 0, loadedNamespaces: ['demo'], catalogOutcomes: loaded });
  const updates = ['Middle', 'Latest', 'Post'].map(label => catalogs.map(catalog => catalog.locale === locale
    ? parseCatalog(JSON.stringify({ ...source(locale), greeting: `${label} {name}` }), { locale, namespace: 'demo' }) : catalog));
  return { boot, wire: serializeBootSnapshot(boot), catalogs: loaded.map(outcome => outcome.catalog), updates };
}
