import type { Handle } from '@sveltejs/kit/hooks';
import { resolveLocale, resolveAcceptLanguage } from '@0disoft/saylo-core/runtime';
import { catalogSource } from 'virtual:saylo/server';

/** App-owned priority: query, cookie, HTTP preferences, then the manifest base locale. */
export const handle: Handle = async ({ event, resolve }) => {
  const manifest = catalogSource.readManifest();
  const locale = resolveLocale([
    event.url.searchParams.get('locale') ?? '', event.cookies.get('saylo-locale') ?? '',
  ], manifest.availableLocales, resolveAcceptLanguage(
    event.request.headers.get('accept-language'), manifest.availableLocales, manifest.baseLocale,
  ));
  event.locals.locale = locale;
  return resolve(event, { transformPageChunk: ({ html }) => html.replace('%saylo.lang%', locale) });
};
