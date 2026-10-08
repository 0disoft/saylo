import { serializeBootSnapshot } from '@0disoft/saylo-core';
import { createRequestI18n } from 'virtual:saylo/server';
import type { LayoutServerLoad } from './$types';
import type { AppSchema } from '#lib/generated.d.ts';

export const load: LayoutServerLoad = async ({ locals, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  const instance = await createRequestI18n<AppSchema>({ locale: locals.locale });
  try { return { sayloBoot: serializeBootSnapshot(instance.getBootSnapshot()) }; }
  finally { instance.dispose(); }
};
