import i18next from 'i18next';
import { createAstFormat } from './ast-format.mjs';
import { freezeCatalogs, createBaseSchema, validateTranslation, InvalidArgumentError, UnknownMessageError, NamespaceNotLoadedError } from '@0disoft/saylo-core/runtime';

function readScope(input, baseLocale) {
  const result = {};
  if (input.availableLocales !== undefined) {
    if (!Array.isArray(input.availableLocales)) throw new RangeError('Declared locales must be an array.');
    result.availableLocales = Object.freeze(Intl.getCanonicalLocales(input.availableLocales).sort());
    if (!result.availableLocales.includes(baseLocale) || result.availableLocales.length !== input.availableLocales.length)
      throw new RangeError('Declared locales must be unique and include the base locale.');
  }
  for (const key of ['availableNamespaces', 'loadedNamespaces']) if (input[key] !== undefined) {
    const list = input[key];
    if (!Array.isArray(list) || new Set(list).size !== list.length || list.some(value =>
      typeof value !== 'string' || !value || value === '.' || value === '..' || /[:/\\\x00-\x1f]/.test(value)))
      throw new RangeError('Namespace lists must contain unique valid names.');
    result[key] = Object.freeze([...list].sort());
  }
  return Object.freeze(result);
}

// Experiment only. Receives parsed AST catalogs; no build-time parser in this module.
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

export async function createCatalogLayer(...args) {
  const layer = createCatalogLayerSync(...args);
  return { ...layer, replace: async (...values) => layer.replace(...values) };
}

export function createCatalogLayerSync(baseLocale, initialCatalogs, initialLocale, options = {}) {
  const timeZone = new Intl.DateTimeFormat('en', { timeZone: options.timeZone ?? 'UTC' }).resolvedOptions().timeZone;
  let scope = readScope(options, baseLocale);
  let current;
  const resourceCache = new WeakMap();
  const stats = { resourceDictionaries: 0, instances: 0 };
  function replace(input, locale = current?.locale ?? initialLocale, nextScope) {
    const candidateScope = nextScope === undefined ? scope : readScope({ ...scope, ...nextScope }, baseLocale);
    const declaredLocales = candidateScope.availableLocales;
    const catalogs = freezeCatalogs(input);
    const bases = new Map(catalogs.filter(c => c.locale === baseLocale).map(c => [c.namespace, c]));
    const loadedNamespaces = candidateScope.loadedNamespaces ?? Object.freeze([...bases.keys()].sort());
    const availableNamespaces = candidateScope.availableNamespaces ?? Object.freeze([...bases.keys()].sort());
    if (!bases.size && !(declaredLocales && candidateScope.availableNamespaces && loadedNamespaces.length === 0))
      throw new Error('A base catalog is required.');
    if (loadedNamespaces.some(namespace => !availableNamespaces.includes(namespace) || !bases.has(namespace)))
      throw new Error('Every loaded namespace must be available and have a base catalog.');
    const schemas = new Map([...bases].map(([namespace, catalog]) => [namespace, createBaseSchema(catalog)]));
    const pairs = new Map();
    const resources = Object.create(null);
    for (const catalog of catalogs) {
      if (declaredLocales && !declaredLocales.includes(catalog.locale))
        throw new Error('Loaded catalog locale is outside the declared manifest scope.');
      if (!loadedNamespaces.includes(catalog.namespace)) throw new Error('Catalog namespace is outside the loaded scope.');
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
    const availableLocales = declaredLocales ?? Object.freeze(Object.keys(resources).sort());
    const selected = availableLocales.includes(locale) ? locale : baseLocale;
    const engine = i18next.createInstance().use(createAstFormat(timeZone));
    stats.instances++;
    let completed = false, initializationError;
    const initializing = engine.init({ resources, lng: selected, fallbackLng: baseLocale, initAsync: false,
      ns: [...bases.keys()], keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false } }, error => {
      completed = true; initializationError = error;
    });
    // This resource-only engine must finish in the same call. No backend or
    // detector is installed; reject a future incompatible initialization path.
    initializing.catch(() => {});
    if (!completed || !engine.isInitialized) throw new Error('The resource engine did not initialize synchronously.');
    if (initializationError) throw initializationError;
    const t = (key, args) => {
      if (typeof key !== 'string') throw new UnknownMessageError(String(key));
      const parts = key.split(':');
      const [namespace, id] = parts;
      if (parts.length !== 2 || !id || !availableNamespaces.includes(namespace)) throw new UnknownMessageError(key);
      if (!loadedNamespaces.includes(namespace)) throw new NamespaceNotLoadedError(namespace, key);
      const base = bases.get(namespace);
      if (!base || !Object.hasOwn(base.messages, id)) throw new UnknownMessageError(key);
      const values = argumentsFor(key, schemas.get(namespace).keys[id], args);
      const target = pairs.get(JSON.stringify([selected, namespace]));
      const source = target && Object.hasOwn(target.messages, id) ? target : base;
      // Select the actual fallback source language. Keep ICU values separate
      // from reserved i18next options such as lng, ns, defaultValue and count.
      return engine.t(id, { lng: source.locale, ns: namespace, values });
    };
    const snapshot = Object.freeze({ locale: selected, baseLocale, timeZone, availableLocales, availableNamespaces, loadedNamespaces, t });
    scope = candidateScope;
    current = snapshot;
    return snapshot;
  }
  replace(initialCatalogs, initialLocale);
  return { getSnapshot: () => current, replace, getProbeStats: () => Object.freeze({ ...stats }) };
}
