<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { decodeBootSnapshot } from '@0disoft/saylo-core';
  import { connectDev } from '@0disoft/saylo-vite/client';
  import type { LiveDiagnostic } from '@0disoft/saylo-vite/client';
  import type { LayoutProps } from './$types';
  import { createBootInstance, setSayloContext } from '#lib/i18n.ts';
  import Workbench from '#lib/Workbench.svelte';
  import '#lib/style.css';

  let { data, children }: LayoutProps = $props();
  const { instance, attachSource } = untrack(() => createBootInstance(decodeBootSnapshot(data.sayloBoot)));
  const i18n = setSayloContext(instance);
  let ready = $state(false);
  let diagnostic = $state<LiveDiagnostic>({ message: '', diagnostics: [] });

  onMount(() => {
    let active = true;
    let disconnect: (() => void) | undefined;
    // The browser-only lazy source is deliberately absent from the SSR module graph.
    void import('virtual:saylo/lazy').then(async ({ catalogSource }) => {
      if (!active) return;
      attachSource(catalogSource);
      disconnect = connectDev(instance, { catalogSource,
        onDiagnostic: value => { diagnostic = value; } });
      await instance.refresh();
      if (active) ready = true;
    }).catch(error => {
      if (active) diagnostic = { message: error instanceof Error ? error.message : String(error), diagnostics: [] };
    });
    return () => { active = false; disconnect?.(); };
  });
  onDestroy(() => instance.dispose());
  $effect(() => { document.documentElement.lang = $i18n.locale; });
</script>

<svelte:head><title>Saylo · SvelteKit SSR demo</title></svelte:head>
<main data-ready={ready} id="saylo-layout">
  <header><a class="brand" href="/?locale={$i18n.locale}">Saylo <span>SvelteKit 3 · SSR</span></a></header>
  {@render children()}
  <Workbench />
  <p id="status" class="hint" role="status">{diagnostic.message ? '번역 연결을 확인해 주세요.'
    : ready ? '번역 파일을 저장하면 화면에 반영됩니다.' : '서버에서 준비한 번역을 표시합니다.'}</p>
  <pre id="error" role="alert">{diagnostic.message}</pre>
</main>
