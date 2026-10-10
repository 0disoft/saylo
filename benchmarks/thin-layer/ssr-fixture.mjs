import { createBaseSchema, createBootSnapshot, serializeBootSnapshot } from '@0disoft/saylo-core/runtime';
import { parseCatalog } from '../../packages/core/dist/index.js';

const unsafe = '</script><script>globalThis.__thinInjected=1</script>\u2028\u2029';
const source = locale => locale === 'en'
  ? { greeting: `Server {name} ${unsafe}`, when: '{at, date} / {at, time, ::HHmm}', rows: '{count, plural, one {one row} other {# rows}}' }
  : { greeting: `Сервер {name} ${unsafe}` };
export function createSsrFixture({ locale = 'ru', timeZone = 'UTC', sessionId = 'thin-ssr', missingTarget = false } = {}) {
  if (missingTarget && locale === 'en') throw new Error('Cannot omit the base catalog.');
  const catalogs = ['en', 'ru'].map(locale => parseCatalog(JSON.stringify(source(locale)), { locale, namespace: 'demo' }));
  if (missingTarget) for (const locale of ['en', 'ru'])
    catalogs.push(parseCatalog('{"title":"Other namespace keeps locale available"}', { locale, namespace: 'help' }));
  const fingerprints = new Map(catalogs.filter(c => c.locale === 'en').map(c => [c.namespace, createBaseSchema(c).fingerprint]));
  const outcomes = catalogs.map(catalog => {
    const common = { sessionId, key: { locale: catalog.locale, namespace: catalog.namespace }, catalogVersion: 1 };
    return missingTarget && catalog.locale === locale && catalog.namespace === 'demo'
      ? { ...common, status: 'missing' }
      : { ...common, status: 'present', namespaceSchemaFingerprint: fingerprints.get(catalog.namespace), catalog };
  });
  const manifest = { sessionId, registryRevision: 0, baseLocale: 'en', availableLocales: ['en', 'ru'], availableNamespaces: [...fingerprints.keys()],
    catalogs: outcomes.map(({ key, status, catalogVersion, namespaceSchemaFingerprint }) => ({ key, status, catalogVersion, namespaceSchemaFingerprint })) };
  const loaded = outcomes.filter(outcome => outcome.key.namespace === 'demo' && (outcome.key.locale === 'en' || outcome.key.locale === locale));
  const boot = createBootSnapshot({ manifest, locale, timeZone, stateRevision: 0, loadedNamespaces: ['demo'], catalogOutcomes: loaded });
  const updates = ['Middle', 'Latest', 'Post'].map(label => catalogs.map(catalog => catalog.locale === locale && catalog.namespace === 'demo'
    ? parseCatalog(JSON.stringify({ ...source(locale), greeting: `${label} {name}` }), { locale, namespace: 'demo' }) : catalog));
  return { boot, wire: serializeBootSnapshot(boot), catalogs: loaded.filter(outcome => outcome.status === 'present').map(outcome => outcome.catalog), updates };
}
