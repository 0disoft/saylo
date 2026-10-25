/** Complete, isolated route preset; application hooks and existing layouts remain owned by the app. */
export function svelteKitFiles(): Readonly<Record<string, string>> {
  return {
    'src/saylo/i18n.ts': `import { createI18n } from '@0disoft/saylo-core/runtime';
import type { BootSnapshot, CatalogSource } from '@0disoft/saylo-core';
import { createSayloSvelte } from '@0disoft/saylo-svelte';
import type { AppSchema } from './generated';

export const { setSayloContext, getI18n } = createSayloSvelte<AppSchema>();

export function createBootInstance(boot: BootSnapshot) {
  let source: CatalogSource = {
    readManifest: () => boot.manifest,
    loadCatalog: async (locale, namespace) => boot.catalogOutcomes.find(outcome =>
      outcome.key.locale === locale && outcome.key.namespace === namespace)
      ?? { status: 'failed', code: 'SSR_SCOPE', message: 'Catalog is outside the prepared SSR scope.' },
  };
  const instance = createI18n<AppSchema>({ initialSnapshot: boot, catalogSource: {
    readManifest: () => source.readManifest(),
    loadCatalog: (locale, namespace, signal) => source.loadCatalog(locale, namespace, signal),
  } });
  return { instance, attachSource: (next: CatalogSource) => { source = next; } };
}
`,
    'src/saylo/client.ts': `import { connectDev, createDevCatalogSource } from '@0disoft/saylo-vite/client';
import type { BootSnapshot, CatalogSource, I18n } from '@0disoft/saylo-core';
import type { AppSchema } from './generated';

export function connectBootClient(boot: BootSnapshot, instance: I18n<AppSchema>,
  attachSource: (source: CatalogSource) => void, hot?: NonNullable<ImportMeta['hot']>) {
  let active = true;
  let disconnect: (() => void) | undefined;
  const owned = hot ? createDevCatalogSource(boot.manifest, boot.catalogOutcomes, { hot }) : undefined;
  const source = owned ? Promise.resolve(owned) : import('virtual:saylo/lazy').then(module => module.catalogSource);
  const stop = () => {
    if (!active) return;
    active = false;
    try { disconnect?.(); } finally { owned?.dispose(); }
  };
  const ready = source.then(async catalogSource => {
    if (!active) return false;
    attachSource(catalogSource);
    disconnect = connectDev(instance, { catalogSource });
    await instance.refresh();
    return active;
  }).catch(error => { stop(); throw error; });
  return { ready, stop };
}
`,
    'src/routes/saylo/+layout.server.ts': `import { resolveLocale, resolveAcceptLanguage } from '@0disoft/saylo-core';
import { resolve as resolvePath } from '$app/paths';
import { serializeBootSnapshot } from '@0disoft/saylo-core/runtime';
import { catalogSource, createRequestI18n } from 'virtual:saylo/server';
import type { LayoutServerLoad } from './$types';
import type { AppSchema } from '../../saylo/generated';

export const prerender = false;

export const load: LayoutServerLoad = async ({ url, cookies, request, setHeaders }) => {
  const manifest = catalogSource.readManifest();
  const negotiated = resolveAcceptLanguage(request.headers.get('accept-language'), manifest.availableLocales, manifest.baseLocale);
  const locale = resolveLocale([url.searchParams.get('locale') ?? '', cookies.get('SAYLO_LOCALE') ?? '', negotiated],
    manifest.availableLocales, manifest.baseLocale);
  const instance = await createRequestI18n<AppSchema>({ locale, signal: request.signal });
  try {
    setHeaders({ 'cache-control': 'no-store' });
    cookies.set('SAYLO_LOCALE', locale, { path: resolvePath('/saylo'), httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:' });
    return { sayloBoot: serializeBootSnapshot(instance.getBootSnapshot(), { compact: true }) };
  } finally { instance.dispose(); }
};
`,
    'src/routes/saylo/+layout.svelte': `<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { decodeBootSnapshot } from '@0disoft/saylo-core/runtime';
  import { createBootInstance, setSayloContext } from '../../saylo/i18n';
  import { connectBootClient } from '../../saylo/client';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
  const boot = untrack(() => decodeBootSnapshot(data.sayloBoot));
  const { instance, attachSource } = createBootInstance(boot);
  const i18n = setSayloContext(instance);
  let name = $state('Saylo');
  let dialog: HTMLDialogElement;
  let ready = $state(false);
  let error = $state('');
  let generation = 0;
  onDestroy(() => { generation++; instance.dispose(); });
  onMount(() => {
    let active = true;
    const connection = connectBootClient(boot, instance, attachSource, import.meta.hot);
    void connection.ready.then(connected => { if (active) ready = connected; })
      .catch(cause => { if (active) error = String(cause); });
    return () => { active = false; connection.stop(); };
  });
  $effect(() => {
    if (!ready) return;
    const locale = decodeBootSnapshot(data.sayloBoot).locale;
    const request = ++generation;
    void instance.setLocale(locale).catch(cause => { if (request === generation) error = String(cause); });
  });
  async function selectLocale(locale: string) {
    error = '';
    const url = new URL(page.url.href);
    url.searchParams.set('locale', locale);
    try { await goto(url); } catch (cause) { error = String(cause); }
  }
</script>

<section lang={$i18n.locale}>
  <label>Language
    <select id="saylo-locale" disabled={!ready} value={$i18n.locale}
      onchange={event => { void selectLocale(event.currentTarget.value); }}>
      {#each $i18n.availableLocales as locale (locale)}<option value={locale}>{locale}</option>{/each}
    </select>
  </label>
  <label>Name <input id="saylo-name" bind:value={name} /></label>
  <h1 id="saylo-greeting">{$i18n.t('saylo:greeting', { name })}</h1>
  <button type="button" onclick={() => dialog.showModal()}>Open dialog</button>
  <dialog bind:this={dialog}>
    <p>{$i18n.t('saylo:greeting', { name })}</p>
    <button type="button" onclick={() => dialog.close()}>Close</button>
  </dialog>
  {#if error}<p role="alert">{error}</p>{/if}
  {@render children()}
</section>
`,
    'src/routes/saylo/+page.svelte': `<script lang="ts">
  import { getI18n } from '../../saylo/i18n';
  const i18n = getI18n();
</script>

<p id="saylo-child">{$i18n.t('saylo:greeting', { name: 'SvelteKit' })}</p>
`,
  };
}
