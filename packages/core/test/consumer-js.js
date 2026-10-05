// @ts-check
import { createBaseSchema, parseCatalog, validateTranslation } from '@saylo/core';

const parsed = parseCatalog('{"x":"{n, number}"}', { locale: 'ko', namespace: 'cart' });
const base = createBaseSchema(parsed);
validateTranslation(base, parseCatalog('{"x":"Items"}', { locale: 'en', namespace: 'cart' }));
// @ts-expect-error required namespace in typed JS too
parseCatalog('{}', { locale: 'ko' });
// @ts-expect-error immutable in JS too
base.keys.x.n.acceptedTypes.push('string');
