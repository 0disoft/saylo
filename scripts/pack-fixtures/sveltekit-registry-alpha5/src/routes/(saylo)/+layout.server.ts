import { serializeBootSnapshot } from '@0disoft/saylo-core';
import { createRequestI18n } from 'virtual:saylo/server';
import type { LayoutServerLoad } from './$types';
import type { AppSchema } from '#lib/generated.d.ts';

export const load: LayoutServerLoad = async ({ locals, url, setHeaders }) => {
  // SvelteKit must rerun this layout load when the URL locale changes during navigation.
  url.searchParams.get('locale');
  setHeaders({ 'cache-control': 'no-store' });
  const instance = await createRequestI18n<AppSchema>({ locale: locals.locale });
  try { return { sayloBoot: serializeBootSnapshot(instance.getBootSnapshot()) }; }
  finally { instance.dispose(); }
};
