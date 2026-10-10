import { createBaseSchema, parseCatalog } from '../../packages/core/dist/index.js';

const pair = (locale, namespace) => JSON.stringify([locale, namespace]);
export function createLazyFixture() {
  const records = new Map(), versions = new Map(), holds = new Set(), pending = [], watchers = [];
  let sessionId = 'lazy-first', registryRevision = 0, override;
  const calls = [];
  for (const locale of ['en', 'ru', 'ja']) for (const namespace of ['demo', 'help']) {
    const content = namespace === 'demo' ? { greeting: `${locale} {name}`,
      ...(locale === 'en' ? { when: '{at, date}', rows: '{count, plural, one {one row} other {# rows}}' } : {}) } : { title: `${locale}-help {name}` };
    const id = pair(locale, namespace);
    records.set(id, parseCatalog(JSON.stringify(content), { locale, namespace })); versions.set(id, 1);
  }
  const manifest = () => {
    if (override) return override;
    const namespaces = [...records.values()].filter(c => c.locale === 'en').map(c => c.namespace).sort();
    return { sessionId, registryRevision, baseLocale: 'en',
      availableLocales: [...new Set([...records.values()].map(c => c.locale))].sort(), availableNamespaces: namespaces,
      catalogs: [...versions].map(([id, catalogVersion]) => {
        const [locale, namespace] = JSON.parse(id), catalog = records.get(id);
        return { key: { locale, namespace }, catalogVersion, status: catalog ? 'present' : 'missing',
          ...(catalog ? { namespaceSchemaFingerprint: createBaseSchema(records.get(pair('en', namespace))).fingerprint } : {}) };
      }) };
  };
  const outcome = (locale, namespace) => {
    const id = pair(locale, namespace), catalog = records.get(id);
    return { sessionId, key: { locale, namespace }, status: catalog ? 'present' : 'missing', catalogVersion: versions.get(id) ?? 0,
      ...(catalog ? { namespaceSchemaFingerprint: createBaseSchema(records.get(pair('en', namespace))).fingerprint, catalog } : {}) };
  };
  const source = { readManifest: manifest, loadCatalog(locale, namespace, signal) {
    const id = pair(locale, namespace), captured = outcome(locale, namespace);
    const call = { id, sessionId, version: captured.catalogVersion, signal }; calls.push(call);
    for (const watcher of [...watchers]) if (watcher.id === id) { watchers.splice(watchers.indexOf(watcher), 1); watcher.resolve(call); }
    if (!holds.has(id)) return Promise.resolve(captured);
    return new Promise(resolve => { pending.push({ id, captured, resolve, call }); });
  } };
  const put = (locale, namespace, content) => {
    const id = pair(locale, namespace);
    records.set(id, parseCatalog(JSON.stringify(content), { locale, namespace })); versions.set(id, (versions.get(id) ?? 0) + 1); registryRevision++;
  };
  const remove = (locale, namespace) => { const id = pair(locale, namespace); records.delete(id); versions.set(id, (versions.get(id) ?? 0) + 1); registryRevision++; };
  return { source, calls, manifest, outcome, put, remove,
    seed: (locale = 'en', namespaces = ['demo']) => namespaces.flatMap(namespace => [...new Set(['en', locale])].map(locale => outcome(locale, namespace))),
    hold(locale, namespace) { holds.add(pair(locale, namespace)); },
    unhold(locale, namespace) { holds.delete(pair(locale, namespace)); },
    release(locale, namespace) { const id = pair(locale, namespace); holds.delete(id);
      for (const entry of [...pending]) if (entry.id === id) { pending.splice(pending.indexOf(entry), 1); entry.resolve(entry.captured); } },
    wait(locale, namespace) {
      const id = pair(locale, namespace), existing = pending.find(entry => entry.id === id);
      if (existing) return Promise.resolve(existing.call);
      return new Promise(resolve => watchers.push({ id, resolve }));
    },
    removeLocale(locale) { for (const catalog of [...records.values()]) if (catalog.locale === locale) remove(locale, catalog.namespace); },
    removeNamespace(namespace) { for (const catalog of [...records.values()]) if (catalog.namespace === namespace) remove(catalog.locale, namespace); },
    switchSession(next) { sessionId = next; registryRevision = 0; for (const id of versions.keys()) versions.set(id, records.has(id) ? 1 : 0); },
    override(value) { override = value; },
  };
}
