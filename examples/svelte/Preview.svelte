<script lang="ts">
  import { getI18n } from './i18n';
  let { connection = '', details = '' }: { connection?: string; details?: string } = $props();
  const i18n = getI18n();
  let name = $state('');
  let note = $state('');
  let count = $state(2);
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

<header>
  <a class="brand" href="/">Saylo <span>Svelte 5 demo</span></a>
  <label class="locale-control">화면 언어
    <select id="locale" value={pendingLocale ?? $i18n.locale} onchange={event => { void selectLocale(event.currentTarget.value); }}>
      {#each $i18n.availableLocales as locale (locale)}
        <option value={locale}>{locale === 'ko' ? '한국어' : locale === 'en' ? 'English' : locale}</option>
      {/each}
    </select>
  </label>
</header>
<section class="intro">
  <p class="eyebrow">SVELTE LIVE CATALOG PREVIEW</p>
  <h1>{$i18n.t('demo:heading')}</h1>
  <p>{$i18n.t('demo:description')}</p>
  {#if pendingLocale}<p role="status">{pendingLocale} 문구를 불러오는 중입니다.</p>{/if}
  <p id="transition-error" role="alert">{transitionError}</p>
</section>
<section class="panel preview">
  <div class="panel-header"><h2>{$i18n.t('demo:formTitle')}</h2><span id="revision" class="badge">revision {$i18n.stateRevision}</span></div>
  <form id="order-form" onsubmit={event => { event.preventDefault(); open = true; }}>
    <label>{$i18n.t('demo:name')}<input id="name" autocomplete="off" placeholder={$i18n.t('demo:namePlaceholder')} bind:value={name} /></label>
    <label>{$i18n.t('demo:note')}<textarea id="note" rows="4" placeholder={$i18n.t('demo:notePlaceholder')} bind:value={note}></textarea></label>
    <label>{$i18n.t('demo:count')}<input id="count" type="number" min="0" max="100" bind:value={count} /></label>
    <p id="summary" class="summary" aria-live="polite">{$i18n.t('demo:summary', { count: Number(count) })}</p>
    <button id="open-dialog" type="submit">{$i18n.t('demo:openDialog')}</button>
  </form>
  <p class="hint">입력하고 확인 창을 연 뒤 <code>examples/svelte/locales/ko/demo.json</code>을 수정하고 저장하세요.</p>
  <p class="hint">불러온 namespace: <span id="loaded-namespaces">{$i18n.loadedNamespaces.join(', ')}</span></p>
</section>
<dialog id="confirmation" aria-labelledby="dialog-title" bind:this={dialog} onclose={() => { open = false; }}>
  <form method="dialog">
    <h2 id="dialog-title">{$i18n.t('demo:dialogTitle')}</h2>
    <label>{$i18n.t('demo:dialogNote')}<input id="confirmation-note" autocomplete="off" bind:value={confirmation} /></label>
    <button id="close-dialog">{$i18n.t('demo:closeDialog')}</button>
    <p id="dialog-status" class="hint" role="status">{connection}{details && `\n${details}`}</p>
  </form>
</dialog>
