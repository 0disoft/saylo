import { TYPE } from '@formatjs/icu-messageformat-parser';
import type { MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { CatalogError, freeze } from './diagnostics.js';
import type { ArgumentType, CatalogDiagnostic, CatalogSchema, MessageSchema, ParsedCatalog } from './types.js';

export function inferArguments(
  ast: readonly MessageFormatElement[],
  conflict: (argument: string, offset: number) => CatalogDiagnostic,
): MessageSchema {
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
  const schema: Record<string, { required: true; acceptedTypes: ArgumentType[] }> = Object.create(null);
  for (const [name, acceptedTypes] of types) schema[name] = { required: true, acceptedTypes };
  return freeze(schema);
}

export function createBaseSchema(catalog: ParsedCatalog): CatalogSchema {
  const keys: Record<string, MessageSchema> = Object.create(null);
  for (const [id, message] of Object.entries(catalog.messages)) keys[id] = message.arguments;
  const canonical = Object.keys(keys).sort().map(id => [id,
    Object.keys(keys[id]!).sort().map(name => [name, [...keys[id]![name]!.acceptedTypes].sort()]),
  ]);
  return freeze({ baseLocale: catalog.locale, namespace: catalog.namespace,
    fingerprint: `saylo-schema-v1:${JSON.stringify([catalog.namespace, canonical])}`, keys });
}

/** Missing keys/arguments are allowed; supplied translations cannot narrow the base. */
export function validateTranslation(base: CatalogSchema, translation: ParsedCatalog): void {
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
    for (const [argument, translated] of Object.entries(message.arguments)) {
      const accepted = Object.hasOwn(original, argument) ? original[argument] : undefined;
      if (!accepted) {
        diagnostics.push({ ...context, id, argument, position: message.position, code: 'UNKNOWN_ARGUMENT', message: `Translation introduces argument ${JSON.stringify(argument)} absent from the base message.` });
      } else if (!accepted.acceptedTypes.every(t => translated.acceptedTypes.includes(t))) {
        diagnostics.push({ ...context, id, argument, position: message.position, code: 'ARGUMENT_TYPE_NARROWING',
          message: `Translation argument ${JSON.stringify(argument)} must accept all base types (${accepted.acceptedTypes.join(' | ')}). If it needs a numeric contract, express that in the base message first.` });
      }
    }
  }
  if (diagnostics.length) throw new CatalogError(diagnostics);
}
