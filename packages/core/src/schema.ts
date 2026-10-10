import { TYPE } from '@formatjs/icu-messageformat-parser/no-parser.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { CatalogError, freeze, isDeepFrozen } from './diagnostics.js';
import type { ArgumentType, CatalogDiagnostic, CatalogSchema, MessageSchema, ParsedCatalog } from './types.js';

// The canonical cache is owned by one parse. Its shortcut dies with that cache;
// signatures and shared schema identity stay identical to the general ICU path.
const plainContracts = new WeakMap<Map<string, MessageSchema>, Map<string | undefined, MessageSchema>>();

function plainArgument(ast: readonly MessageFormatElement[]): string | undefined | false {
  let name: string | undefined;
  for (const element of ast) {
    if (element.type === TYPE.literal) continue;
    if (element.type !== TYPE.argument || (name !== undefined && name !== element.value)) return false;
    name = element.value;
  }
  return name;
}

export function inferArguments(
  ast: readonly MessageFormatElement[],
  conflict: (argument: string, offset: number) => CatalogDiagnostic,
  cache: Map<string, MessageSchema>,
): MessageSchema {
  const name = plainArgument(ast);
  if (name !== false) {
    let plain = plainContracts.get(cache);
    const reused = plain?.get(name);
    if (reused) return reused;
    // Literal-only and repeated uses of one plain argument cannot conflict.
    // Keep the existing encounter/type signature for cross-path sharing.
    const signature = name === undefined ? '[]' : JSON.stringify([[name, ['string', 'number']]]);
    let schema = cache.get(signature);
    if (!schema) {
      const record: Record<string, { required: true; acceptedTypes: ArgumentType[] }> = Object.create(null);
      if (name !== undefined) record[name] = { required: true, acceptedTypes: ['string', 'number'] };
      schema = freeze(record);
      cache.set(signature, schema);
    }
    if (!plain) { plain = new Map(); plainContracts.set(cache, plain); }
    plain.set(name, schema);
    return schema;
  }
  const types = new Map<string, ArgumentType[]>();
  const diagnostics: CatalogDiagnostic[] = [];
  function use(name: string, accepted: ArgumentType[], offset: number) {
    const previous = types.get(name);
    const intersection = previous ? previous.filter(t => accepted.includes(t)) : accepted;
    if (intersection.length === 0 && previous?.length !== 0) diagnostics.push(conflict(name, offset));
    types.set(name, intersection);
  }
  function walk(elements: readonly MessageFormatElement[]) {
    for (const element of elements) {
      const offset = element.location?.start.offset ?? 0;
      switch (element.type) {
        case TYPE.argument: use(element.value, ['string', 'number'], offset); break;
        case TYPE.number: use(element.value, ['number'], offset); break;
        case TYPE.date:
        case TYPE.time: use(element.value, ['number', 'date'], offset); break;
        case TYPE.select:
        case TYPE.plural:
          use(element.value, element.type === TYPE.select ? ['string'] : ['number'], offset);
          for (const branch of Object.values(element.options)) walk(branch.value);
          break;
        case TYPE.tag: walk(element.children); break;
        // Literal text and # do not introduce arguments.
      }
    }
  }
  walk(ast);
  if (diagnostics.length) throw new CatalogError(diagnostics);
  // Keep encounter/type order in the key, preserving the serialized schema.
  // Always walk first so a prior success cannot hide a message-local conflict.
  const signature = JSON.stringify([...types]);
  const cached = cache.get(signature);
  if (cached) return cached;
  const schema: Record<string, { required: true; acceptedTypes: ArgumentType[] }> = Object.create(null);
  for (const [name, acceptedTypes] of types) schema[name] = { required: true, acceptedTypes };
  const frozenSchema = freeze(schema);
  cache.set(signature, frozenSchema);
  return frozenSchema;
}

const schemas = new WeakMap<ParsedCatalog, CatalogSchema>();

export function createBaseSchema(catalog: ParsedCatalog): CatalogSchema {
  const cacheable = isDeepFrozen(catalog);
  const cached = cacheable ? schemas.get(catalog) : undefined;
  if (cached) return cached;
  const keys: Record<string, MessageSchema> = Object.create(null);
  for (const [id, message] of Object.entries(catalog.messages)) keys[id] = message.arguments;
  const canonical = Object.keys(keys).sort().map(id => [id,
    Object.keys(keys[id]!).sort().map(name => [name, [...keys[id]![name]!.acceptedTypes].sort()]),
  ]);
  const schema = freeze({ baseLocale: catalog.locale, namespace: catalog.namespace,
    fingerprint: `saylo-schema-v2:sha256:${bytesToHex(sha256(utf8ToBytes(JSON.stringify([catalog.namespace, canonical]))))}`, keys });
  if (cacheable) schemas.set(catalog, schema);
  return schema;
}

const validatedArguments = new WeakMap<MessageSchema, WeakSet<MessageSchema>>();
const validatedCatalogs = new WeakMap<CatalogSchema, WeakSet<ParsedCatalog>>();

/** Missing keys/arguments are allowed; supplied translations cannot narrow the base. */
export function validateTranslation(base: CatalogSchema, translation: ParsedCatalog): void {
  // Only library-recognized deep-frozen inputs can reuse a complete result.
  // Key/schema changes get new identities; weak references do not retain snapshots.
  const cacheableCatalog = isDeepFrozen(base) && isDeepFrozen(translation);
  const acceptedCatalogs = cacheableCatalog ? validatedCatalogs.get(base) : undefined;
  if (acceptedCatalogs?.has(translation)) return;
  const context = { locale: translation.locale, namespace: translation.namespace, sourceName: translation.sourceName };
  if (base.namespace !== translation.namespace) {
    throw new CatalogError([{ ...context, code: 'NAMESPACE_MISMATCH', message: `Expected namespace ${JSON.stringify(base.namespace)}.` }]);
  }
  const diagnostics: CatalogDiagnostic[] = [];
  for (const [id, message] of Object.entries(translation.messages)) {
    const original = Object.hasOwn(base.keys, id) ? base.keys[id] : undefined;
    if (!original) {
      diagnostics.push({ ...context, id, position: message.position, code: 'UNKNOWN_MESSAGE', message: 'Translation introduces a key absent from the base catalog.' });
      continue;
    }
    const cacheable = isDeepFrozen(message.arguments) && isDeepFrozen(original);
    const cached = cacheable ? validatedArguments.get(message.arguments) : undefined;
    if (cached?.has(original)) continue;
    const start = diagnostics.length;
    for (const [argument, translated] of Object.entries(message.arguments)) {
      const accepted = Object.hasOwn(original, argument) ? original[argument] : undefined;
      if (!accepted) {
        diagnostics.push({ ...context, id, argument, position: message.position, code: 'UNKNOWN_ARGUMENT', message: `Translation introduces argument ${JSON.stringify(argument)} absent from the base message.` });
      } else if (!accepted.acceptedTypes.every(t => translated.acceptedTypes.includes(t))) {
        diagnostics.push({ ...context, id, argument, position: message.position, code: 'ARGUMENT_TYPE_NARROWING',
          message: `Translation argument ${JSON.stringify(argument)} must accept all base types (${accepted.acceptedTypes.join(' | ')}). If it needs a numeric contract, express that in the base message first.` });
      }
    }
    if (cacheable && diagnostics.length === start) {
      const contracts = cached ?? new WeakSet<MessageSchema>();
      contracts.add(original);
      if (!cached) validatedArguments.set(message.arguments, contracts);
    }
  }
  if (diagnostics.length) throw new CatalogError(diagnostics);
  if (cacheableCatalog) {
    const accepted = acceptedCatalogs ?? new WeakSet<ParsedCatalog>();
    accepted.add(translation);
    if (!acceptedCatalogs) validatedCatalogs.set(base, accepted);
  }
}
