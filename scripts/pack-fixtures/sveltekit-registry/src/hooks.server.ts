import type { Handle } from '@sveltejs/kit/hooks';
import { catalogSource } from 'virtual:saylo/server';

/** Query locale belongs to this request. Unknown/malformed tags use the base locale. */
export const handle: Handle = async ({ event, resolve }) => {
  const manifest = catalogSource.readManifest();
  let locale = manifest.baseLocale;
  try {
    const candidate = Intl.getCanonicalLocales(event.url.searchParams.get('locale') ?? locale)[0];
    if (candidate && manifest.availableLocales.includes(candidate)) locale = candidate;
  } catch { /* Invalid query locale uses the base locale. */ }
  event.locals.locale = locale;
  return resolve(event, { transformPageChunk: ({ html }) => html.replace('%saylo.lang%', locale) });
};
