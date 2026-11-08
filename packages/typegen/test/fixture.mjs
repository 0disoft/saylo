import { createBaseSchema, parseCatalog } from '@0disoft/saylo-core';

export const fixtureCatalog = parseCatalog(JSON.stringify(Object.fromEntries([
  ['plain', 'Hello'], ['amount', '{count, plural, one {# item} other {# items}}'],
  ['when', '{at, date}'], ['greeting', 'Hello {name}'],
  ['choice', '{mode, select, a {{extra}} other {none}}'],
  ['mixed', '{count} {count, number}'], ['dotted.key', 'Literal dot'], ['__proto__', '{constructor}'],
])), { locale: 'ko', namespace: 'cart' });
export const fixtureSchema = createBaseSchema(fixtureCatalog);

export const fixtureRichSchema = createBaseSchema(parseCatalog(JSON.stringify({
  terms: '<link>{name}</link>', empty: 'No tags', literal: '<strong>Literal</strong>',
}), { locale: 'en', namespace: 'demo', richText: { terms: ['strong', 'link'], empty: [] } }));
