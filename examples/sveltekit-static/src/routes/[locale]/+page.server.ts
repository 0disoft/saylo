import { error } from '@sveltejs/kit';
import { serializeBootSnapshot } from '@0disoft/saylo-core/runtime';
import { createRequestI18n } from 'virtual:saylo/server';
import type { PageServerLoad } from './$types';
import type { AppSchema } from '../../lib/generated';
import { locales } from '../../lib/locales';

export function entries() { return locales.map(locale => ({ locale })); }
// This load runs at prerender time; adapter-static deploys its output, not a server.
export const load: PageServerLoad = async ({ params }) => {
  if (!locales.some(locale => locale === params.locale)) error(404, 'Unknown locale');
  const instance = await createRequestI18n<AppSchema>({ locale: params.locale, initialNamespaces: ['common'] });
  try { return { boot: serializeBootSnapshot(instance.getBootSnapshot(), { compact: true }) }; }
  finally { instance.dispose(); }
};
