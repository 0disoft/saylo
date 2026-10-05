import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { serializeBootSnapshot } from '@saylo/core';
import { createRequestI18n } from 'virtual:saylo/server';
import { App, SayloProvider } from './app.mjs';

export async function render(locale = 'ko') {
  const instance = await createRequestI18n({ locale });
  try { return { html: renderToString(h(SayloProvider, { instance }, h(App))), boot: serializeBootSnapshot(instance.getBootSnapshot()) }; }
  finally { instance.dispose(); }
}
