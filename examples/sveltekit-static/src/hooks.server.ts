import type { Handle } from '@sveltejs/kit/hooks';
import { locales } from './lib/locales';

// Prerender stamps the document language into each static HTML file.
export const handle: Handle = ({ event, resolve }) => {
  const locale = locales.find(locale => locale === event.params.locale) ?? 'en';
  return resolve(event, { transformPageChunk: ({ html }) => html.replace('<html lang="en">', `<html lang="${locale}">`) });
};
