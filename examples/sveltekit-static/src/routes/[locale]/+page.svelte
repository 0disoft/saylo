<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { createI18n, decodeBootSnapshot } from '@0disoft/saylo-core/runtime';
  import { createSvelteStore } from '@0disoft/saylo-svelte';
  import { catalogSource } from 'virtual:saylo/lazy';
  import type { PageProps } from './$types';
  import type { AppSchema } from '../../lib/generated';
  import { locales } from '../../lib/locales';

  let { data }: PageProps = $props();
  const instance = createI18n<AppSchema>({ initialSnapshot: untrack(() => decodeBootSnapshot(data.boot)), catalogSource, maxCachedCatalogs: 6 });
  const i18n = createSvelteStore(instance);
  let name = $state('Saylo'), ready = $state(false), busy = $state(false), message = $state('');
  let dialog: HTMLDialogElement;
  onMount(() => { ready = true; });
  onDestroy(() => instance.dispose());
  $effect(() => { document.documentElement.lang = $i18n.locale; });

  async function selectLocale(locale: string) {
    busy = true; message = '';
    try {
      await instance.setLocale(locale);
      const url = new URL(page.url.href);
      url.pathname = `/${instance.getSnapshot().locale}/`;
      // Shallow routing preserves the form/dialog and avoids fetching another boot payload.
      replaceState(url, page.state);
    } catch (cause) { message = String(cause); }
    finally { busy = false; }
  }
  async function loadCart() {
    busy = true; message = '';
    try { await instance.loadNamespace('cart'); }
    catch (cause) { message = String(cause); }
    finally { busy = false; }
  }
</script>

<svelte:head><title>{$i18n.t('common:hello', { name })}</title></svelte:head>
<section lang={$i18n.locale}>
  <nav aria-label="Static language pages">{#each locales as locale}<a href={`/${locale}/`} data-sveltekit-reload>{locale}</a> {/each}</nav>
  <label>Language <select id="locale" value={$i18n.locale} disabled={!ready || busy} onchange={event => { void selectLocale(event.currentTarget.value); }}>
    {#each locales as locale}<option value={locale}>{locale}</option>{/each}
  </select></label>
  <label>Name <input id="name" bind:value={name} /></label>
  <h1 id="greeting">{$i18n.t('common:hello', { name })}</h1>
  <button id="load-cart" type="button" disabled={!ready || busy} onclick={() => { void loadCart(); }}>Load cart namespace</button>
  <p id="cart">{#if $i18n.loadedNamespaces.includes('cart')}{$i18n.t('cart:items', { count: 2 })}{/if}</p>
  <button id="open-dialog" type="button" onclick={() => dialog.showModal()}>Open dialog</button>
  <dialog bind:this={dialog}><p id="dialog-greeting">{$i18n.t('common:hello', { name })}</p><button id="close-dialog" type="button" onclick={() => dialog.close()}>Close</button></dialog>
  <p id="error" role="alert">{message}</p>
</section>
