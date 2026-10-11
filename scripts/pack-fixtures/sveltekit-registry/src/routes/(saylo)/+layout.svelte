<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { decodeBootSnapshot } from '@0disoft/saylo-core';
  import type { LiveDiagnostic } from '@0disoft/saylo-vite/client';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { LayoutProps } from './$types';
  import { createBootInstance, setSayloContext } from '#lib/i18n.ts';
  import { connectBootClient } from '#lib/client-connection.ts';
  import Workbench from '#lib/Workbench.svelte';
  import '#lib/style.css';

  let { data, children }: LayoutProps = $props();
  const boot = untrack(() => decodeBootSnapshot(data.sayloBoot));
  const { instance, attachSource } = createBootInstance(boot);
  const i18n = setSayloContext(instance);
  let ready = $state(false);
  let diagnostic = $state<LiveDiagnostic>({ message: '', diagnostics: [] });
  let pendingLocale = $state<string>();
  let transitionError = $state('');
  let navigationGeneration = 0;
  let routeGeneration = 0;

  async function selectLocale(locale: string) {
    const generation = ++navigationGeneration;
    pendingLocale = locale;
    transitionError = '';
    const url = new URL(page.url.href);
    url.searchParams.set('locale', locale);
    try { await goto(url, { reset: false }); }
    catch (error) {
      if (generation === navigationGeneration) {
        pendingLocale = undefined;
        transitionError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  onMount(() => {
    let active = true;
    const connection = connectBootClient({ boot, instance, attachSource, hot: import.meta.hot,
      onDiagnostic: value => { diagnostic = value; } });
    void connection.ready.then(connected => {
      if (active && connected) ready = true;
    }).catch(error => {
      if (active) diagnostic = { message: error instanceof Error ? error.message : String(error), diagnostics: [] };
    });
    return () => { active = false; connection.stop(); };
  });
  onDestroy(() => instance.dispose());
  $effect(() => { document.documentElement.lang = $i18n.locale; });
  $effect(() => {
    if (!ready) return;
    const locale = decodeBootSnapshot(data.sayloBoot).locale;
    const generation = ++routeGeneration;
    pendingLocale = locale === instance.getSnapshot().locale ? undefined : locale;
    transitionError = '';
    void instance.setLocale(locale).then(() => {
      if (generation === routeGeneration) pendingLocale = undefined;
    }).catch(error => {
      if (generation === routeGeneration) {
        pendingLocale = undefined;
        transitionError = error instanceof Error ? error.message : String(error);
      }
    });
  });
</script>

<svelte:head><title>Saylo · SvelteKit SSR demo</title></svelte:head>
<main data-ready={ready} id="saylo-layout">
  <header>
    <a class="brand" href="/?locale={$i18n.locale}">Saylo <span>SvelteKit 3 · SSR</span></a>
    <label class="locale-control">화면 언어
      <select id="locale" value={pendingLocale ?? $i18n.locale} onchange={event => { void selectLocale(event.currentTarget.value); }}>
        {#each $i18n.availableLocales as locale (locale)}
          <option value={locale}>{locale === 'ko' ? '한국어' : locale === 'en' ? 'English' : locale}</option>
        {/each}
      </select>
    </label>
  </header>
  <nav class="demo-nav" aria-label="예제 페이지">
    <a id="home-link" href="/?locale={$i18n.locale}" aria-current={page.url.pathname === '/' ? 'page' : undefined}>{$i18n.t('demo:home')}</a>
    <a id="about-link" href="/about?locale={$i18n.locale}" aria-current={page.url.pathname === '/about' ? 'page' : undefined}>{$i18n.t('demo:about')}</a>
    <a id="leave-link" href="/plain?locale={$i18n.locale}">번역 화면 나가기</a>
  </nav>
  <p id="transition-error" role="alert">{transitionError}</p>
  {@render children()}
  <Workbench />
  <p id="status" class="hint" role="status">{diagnostic.message ? '번역 연결을 확인해 주세요.'
    : ready ? import.meta.hot ? '번역 파일을 저장하면 화면에 반영됩니다.' : '빌드된 번역을 사용합니다.'
    : '서버에서 준비한 번역을 표시합니다.'}</p>
  <pre id="error" role="alert">{diagnostic.diagnostics.length
    ? diagnostic.diagnostics.map(value => `${value.sourceName}: ${value.message}`).join('\n') : diagnostic.message}</pre>
</main>
