<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { decodeBootSnapshot } from '@0disoft/saylo-core';
  import type { StoreSnapshot } from '@0disoft/saylo-core';
  import type { AppSchema } from '#lib/generated.d.ts';
  import type { DevSyncState, LiveDiagnostic } from '@0disoft/saylo-vite/client';
  import { createSupportRecorder } from '@0disoft/saylo-vite/client';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { LayoutProps } from './$types';
  import { createBootInstance, setSayloContext } from '#lib/i18n.ts';
  import { connectBootClient } from '#lib/client-connection.ts';
  import Workbench from '#lib/Workbench.svelte';
  import SupportPanel from '#lib/SupportPanel.svelte';
  import '#lib/style.css';
  import { formatDevSyncState } from '#lib/dev-status.ts';
  import { projectDemoMessages, setDemoView } from '#lib/demo-messages.ts';

  let { data, children }: LayoutProps = $props();
  const boot = untrack(() => decodeBootSnapshot(data.sayloBoot));
  const { instance, attachSource } = createBootInstance(boot);
  const i18n = setSayloContext(instance);
  const support = createSupportRecorder(__SAYLO_SUPPORT_ENV__);
  const lastRendered: { current: StoreSnapshot<AppSchema> | undefined } = { current: undefined };
  let name = $state('');
  const presentation = $derived(projectDemoMessages($i18n, lastRendered.current, name || 'Saylo'));
  const text = $derived(presentation.messages);
  setDemoView({ get current() { return presentation; } });
  $effect(() => { if (presentation.accepted) lastRendered.current = presentation.accepted; });
  $effect(() => {
    if (presentation.error) support.onDiagnostic({ message: presentation.error, diagnostics: [], operation: 'observer' });
  });
  let ready = $state(false);
  let diagnostic = $state.raw<LiveDiagnostic>({ message: '', diagnostics: [] });
  let handshakeMessage = $state('');
  let syncState = $state.raw<DevSyncState>();
  const connectionStatus = $derived(import.meta.hot ? formatDevSyncState(syncState) : '빌드된 카탈로그를 사용합니다.');
  const details = $derived([diagnostic.diagnostics.length
    ? diagnostic.diagnostics.map(value => `${value.sourceName}: ${value.message}`).join('\n') : diagnostic.message,
    handshakeMessage].filter(Boolean).join('\n'));
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
    // A removed locale can fall back while its old query remains in the URL.
    // Refetch even for that same URL when the locale is added back and selected.
    try { await goto(url, { reset: false, refreshAll: true }); }
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
      onDiagnostic: value => { support.onDiagnostic(value); if (value.operation === 'handshake') handshakeMessage = value.message; else diagnostic = value; },
      onSyncState: value => { support.onSyncState(value); syncState = value; if (value.status === 'connected') handshakeMessage = ''; }
    });
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
<main data-ready={ready} id="saylo-layout" lang={presentation.locale}>
  <header lang="ko">
    <a class="brand" href="/?locale={$i18n.locale}">Saylo <span lang="en">SvelteKit 3 · SSR</span></a>
    <label class="locale-control">화면 언어
      <select id="locale" value={pendingLocale ?? $i18n.locale} onchange={event => { void selectLocale(event.currentTarget.value); }}>
        {#each $i18n.availableLocales as locale (locale)}
          <option value={locale} lang={locale}>{locale === 'ko' ? '한국어' : locale === 'en' ? 'English' : locale}</option>
        {/each}
      </select>
    </label>
  </header>
  <nav class="demo-nav" aria-label="예제 페이지" lang="ko">
    <a id="home-link" lang={presentation.locale} href="/?locale={$i18n.locale}" aria-current={page.url.pathname === '/' ? 'page' : undefined}>{text.home}</a>
    <a id="about-link" lang={presentation.locale} href="/about?locale={$i18n.locale}" aria-current={page.url.pathname === '/about' ? 'page' : undefined}>{text.about}</a>
    <a id="leave-link" href="/plain?locale={$i18n.locale}">번역 화면 나가기</a>
  </nav>
  <p id="transition-error" role="alert" lang="ko">{transitionError}</p>
  <p id="render-error" class="hint" role="alert" lang="ko">{presentation.error}</p>
  {@render children()}
  <Workbench bind:name connection={connectionStatus} {details} messages={text} renderError={presentation.error} />
  <p id="status" class="hint" role="status" lang="ko">{connectionStatus}</p>
  <pre id="error" role="alert" lang="ko">{details}</pre>
  <SupportPanel recorder={support} {syncState} />
</main>
