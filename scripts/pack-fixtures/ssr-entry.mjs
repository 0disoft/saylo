import { createRequestI18n } from 'virtual:saylo/server';

export async function render(locale) {
  const instance = await createRequestI18n({ locale });
  try { return instance.getServerSnapshot().t('demo:greeting', { name: 'SSR' }); }
  finally { instance.dispose(); }
}
