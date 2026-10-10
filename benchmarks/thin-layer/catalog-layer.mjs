import i18next from 'i18next';
import ICU from 'i18next-icu';
import { freezeCatalogs, createBaseSchema, validateTranslation, InvalidArgumentError, UnknownMessageError } from '@0disoft/saylo-core/runtime';

// Experiment only. Receives parsed AST catalogs; no build-time parser in this module.
class ValuesICU extends ICU {
  parse(resource, options, ...context) { return super.parse(resource, options.values, ...context); }
}

function argumentsFor(key, schema, args) {
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args)))
    throw new InvalidArgumentError(key, undefined, 'Arguments must be an object.');
  const values = Object.create(null);
  for (const [name, contract] of Object.entries(schema)) {
    if (!args || !Object.hasOwn(args, name)) throw new InvalidArgumentError(key, name, 'Required argument is missing.');
    const value = args[name];
    if (typeof value === 'string' && contract.acceptedTypes.includes('string')) values[name] = value;
    else if (typeof value === 'number' && Number.isFinite(value) && contract.acceptedTypes.includes('number')) values[name] = value;
    else {
      let timestamp;
      if (contract.acceptedTypes.includes('date')) {
        try { timestamp = Date.prototype.getTime.call(value); } catch {}
      }
      if (!Number.isFinite(timestamp)) throw new InvalidArgumentError(key, name, 'Argument has the wrong type.');
      values[name] = timestamp;
    }
  }
  return values;
}

export async function createCatalogLayer(baseLocale, initialCatalogs, initialLocale) {
  let current;
  const resourceCache = new WeakMap();
  const stats = { resourceDictionaries: 0, instances: 0 };
  async function replace(input, locale = current?.locale ?? initialLocale) {
    const catalogs = freezeCatalogs(input);
    const bases = new Map(catalogs.filter(c => c.locale === baseLocale).map(c => [c.namespace, c]));
    if (!bases.size) throw new Error('A base catalog is required.');
    const schemas = new Map([...bases].map(([namespace, catalog]) => [namespace, createBaseSchema(catalog)]));
    const pairs = new Map();
    const resources = Object.create(null);
    for (const catalog of catalogs) {
      const pair = JSON.stringify([catalog.locale, catalog.namespace]);
      if (pairs.has(pair)) throw new Error('Duplicate catalog pair.');
      if (catalog.locale !== baseLocale) {
        const schema = schemas.get(catalog.namespace);
        if (!schema) throw new Error('Translation namespace has no baseline.');
        validateTranslation(schema, catalog);
      }
      pairs.set(pair, catalog);
      const language = resources[catalog.locale] ??= Object.create(null);
      let namespace = resourceCache.get(catalog);
      if (!namespace) {
        namespace = Object.create(null);
        for (const [id, message] of Object.entries(catalog.messages)) namespace[id] = message.ast;
        Object.freeze(namespace);
        resourceCache.set(catalog, namespace);
        stats.resourceDictionaries++;
      }
      language[catalog.namespace] = namespace;
    }
    const availableLocales = Object.freeze(Object.keys(resources).sort());
    const selected = availableLocales.includes(locale) ? locale : baseLocale;
    const engine = i18next.createInstance().use(new ValuesICU());
    stats.instances++;
    await engine.init({ resources, lng: selected, fallbackLng: baseLocale, initAsync: false,
      ns: [...bases.keys()], keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false },
      i18nFormat: { parseErrorHandler: error => { throw error; } } });
    const t = (key, args) => {
      if (typeof key !== 'string') throw new UnknownMessageError(String(key));
      const parts = key.split(':');
      const [namespace, id] = parts;
      const base = bases.get(namespace);
      if (parts.length !== 2 || !base || !Object.hasOwn(base.messages, id)) throw new UnknownMessageError(key);
      const values = argumentsFor(key, schemas.get(namespace).keys[id], args);
      const target = pairs.get(JSON.stringify([selected, namespace]));
      const source = target && Object.hasOwn(target.messages, id) ? target : base;
      // Select the actual fallback source language. Keep ICU values separate
      // from reserved i18next options such as lng, ns, defaultValue and count.
      return engine.t(id, { lng: source.locale, ns: namespace, values });
    };
    const snapshot = Object.freeze({ locale: selected, availableLocales,
      availableNamespaces: Object.freeze([...bases.keys()].sort()), t });
    current = snapshot;
    return snapshot;
  }
  await replace(initialCatalogs, initialLocale);
  return { getSnapshot: () => current, replace, getProbeStats: () => Object.freeze({ ...stats }) };
}
