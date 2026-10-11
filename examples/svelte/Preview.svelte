<script lang="ts">
  import type { StoreSnapshot } from '@0disoft/saylo-core';
  import type { AppSchema } from './generated';
  import { getI18n } from './i18n';
  import { projectDemoMessages } from './demo-messages';
  let { connection = '', details = '', onRenderDiagnostic }: { connection?: string; details?: string; onRenderDiagnostic: (message: string) => void } = $props();
  const i18n = getI18n();
  let name = $state('');
  let note = $state('');
  let count = $state(2);
  const lastRendered: { current: StoreSnapshot<AppSchema> | undefined } = { current: undefined };
  const presentation = $derived(projectDemoMessages($i18n, lastRendered.current, Number(count)));
  const text = $derived(presentation.messages);
  $effect(() => {
    // Remember only the view that reached the committed component.
    if (presentation.accepted) lastRendered.current = presentation.accepted;
  });
  $effect(() => { if (presentation.error) onRenderDiagnostic(presentation.error); });
  let confirmation = $state('');
  let open = $state(false);
  let dialog = $state<HTMLDialogElement>();
  let pendingLocale = $state<string>();
  let transitionError = $state('');
  let generation = 0;

  async function selectLocale(locale: string) {
    const request = ++generation;
    pendingLocale = locale;
    transitionError = '';
    try { await $i18n.setLocale(locale); }
    catch (error) { if (request === generation) transitionError = error instanceof Error ? error.message : String(error); }
    finally { if (request === generation) pendingLocale = undefined; }
  }
  $effect(() => { document.documentElement.lang = $i18n.locale; });
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<header lang="ko">
  <a class="brand" href="/">Saylo <span lang="en">Svelte 5 demo</span></a>
  <label class="locale-control">화면 언어
    <select id="locale" value={pendingLocale ?? $i18n.locale} onchange={event => { void selectLocale(event.currentTarget.value); }}>
      {#each $i18n.availableLocales as locale (locale)}
        <option value={locale} lang={locale}>{locale === 'ko' ? '한국어' : locale === 'en' ? 'English' : locale}</option>
      {/each}
    </select>
  </label>
</header>
<section class="intro" lang={presentation.locale}>
  <p class="eyebrow" lang="en">SVELTE LIVE CATALOG PREVIEW</p>
  <h1>{text.heading}</h1>
  <p>{text.description}</p>
  {#if pendingLocale}<p role="status" lang="ko">{pendingLocale} 문구를 불러오는 중입니다.</p>{/if}
  <p id="transition-error" role="alert" lang="ko">{transitionError}</p>
  <p id="render-error" class="hint" role="alert" lang="ko">{presentation.error}</p>
</section>
<section class="panel preview" lang={presentation.locale}>
  <div class="panel-header"><h2>{text.formTitle}</h2><span id="revision" class="badge" lang="en">revision {$i18n.stateRevision}</span></div>
  <form id="order-form" onsubmit={event => { event.preventDefault(); open = true; }}>
    <label>{text.name}<input id="name" autocomplete="off" placeholder={text.namePlaceholder} bind:value={name} /></label>
    <label>{text.note}<textarea id="note" rows="4" placeholder={text.notePlaceholder} bind:value={note}></textarea></label>
    <label>{text.count}<input id="count" type="number" min="0" max="100" bind:value={count} /></label>
    <p id="summary" class="summary" aria-live="polite">{text.summary}</p>
    <button id="open-dialog" type="submit">{text.openDialog}</button>
  </form>
  <p class="hint" lang="ko">입력하고 확인 창을 연 뒤 <code>examples/svelte/locales/ko/demo.json</code>을 수정하고 저장하세요.</p>
  <p class="hint" lang="ko">불러온 namespace: <span id="loaded-namespaces">{$i18n.loadedNamespaces.join(', ')}</span></p>
</section>
<dialog id="confirmation" lang={presentation.locale} aria-labelledby="dialog-title" bind:this={dialog} onclose={() => { open = false; }}>
  <form method="dialog">
    <h2 id="dialog-title">{text.dialogTitle}</h2>
    <label>{text.dialogNote}<input id="confirmation-note" autocomplete="off" bind:value={confirmation} /></label>
    <button id="close-dialog">{text.closeDialog}</button>
    <p id="dialog-render-error" class="hint" role="alert" lang="ko">{presentation.error}</p>
    <p id="dialog-status" class="hint" role="status" lang="ko">{connection}{details && `\n${details}`}</p>
  </form>
</dialog>
