import { renderToString } from 'vue/server-renderer';
import { serializeBootSnapshot } from '@0disoft/saylo-core';
import { createRequestI18n } from 'virtual:saylo/server';
import { createApp, observeInstance } from './app.mjs';

export async function render(locale = 'ko') {
  const instance = await createRequestI18n({ locale });
  const observed = observeInstance(instance);
  try {
    return { html: await renderToString(createApp(observed.instance)),
      boot: serializeBootSnapshot(instance.getBootSnapshot()), locale: instance.getSnapshot().locale,
      resources: observed.stats() };
  } finally { instance.dispose(); }
}
