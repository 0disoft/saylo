import { createBaseSchema, parseCatalog } from '@0disoft/saylo-core';

export const fixtureCatalog = parseCatalog(JSON.stringify(Object.fromEntries([
  ['plain', 'Hello'], ['amount', '{count, plural, one {# item} other {# items}}'],
  ['when', '{at, date}'], ['greeting', 'Hello {name}'],
  ['choice', '{mode, select, a {{extra}} other {none}}'],
  ['mixed', '{count} {count, number}'], ['dotted.key', 'Literal dot'], ['__proto__', '{constructor}'],
])), { locale: 'ko', namespace: 'cart' });
export const fixtureSchema = createBaseSchema(fixtureCatalog);
