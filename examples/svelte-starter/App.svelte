<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import type { StoreSnapshot } from '@0disoft/saylo-core';
  import RichText from '@0disoft/saylo-svelte/RichText.svelte';
  import { connectDev } from '@0disoft/saylo-vite/client';
  import { catalogSource } from 'virtual:saylo/lazy';
  import type { AppSchema } from './generated';
  import { setSayloContext, store } from './i18n';
  import { projectMessages } from './demo-messages';
  import SelectedLocale from './SelectedLocale.svelte';

  const i18n = setSayloContext(store);
  let name = $state('Saylo'), note = $state(''), confirmation = $state('');
  let diagnostic = $state(''), transitionError = $state('');
  let pendingLocale = $state<string>();
  let dialog = $state<HTMLDialogElement>();
  let open = $state(false);
  const lastGood: { current: StoreSnapshot<AppSchema> | undefined } = { current: undefined };
  const view = $derived(projectMessages($i18n, lastGood.current, name || 'Saylo'));
  const text = $derived(view.messages);
  let active = true, generation = 0;
  $effect(() => { if (view.accepted) lastGood.current = view.accepted; });
  $effect(() => { document.documentElement.lang = $i18n.locale; });
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
  onMount(() => connectDev(store, { catalogSource, onDiagnostic: value => { diagnostic = value.message; } }));
  onDestroy(() => { active = false; generation++; });
  async function selectLocale(locale: string) {
    const request = ++generation;
    pendingLocale = locale; transitionError = '';
    try { await $i18n.setLocale(locale); }
    catch (error) { if (active && request === generation) transitionError = String(error); }
    finally { if (active && request === generation) pendingLocale = undefined; }
  }
</script>

{#snippet strong(children: Snippet)}<strong>{@render children()}</strong>{/snippet}
{#snippet link(children: Snippet)}<a href="#order-form">{@render children()}</a>{/snippet}

<main>
  <label lang="en">Locale <select id="locale" value={pendingLocale ?? $i18n.locale} onchange={event => { void selectLocale(event.currentTarget.value); }}>
    {#each $i18n.availableLocales as locale (locale)}<option value={locale}>{locale}</option>{/each}
  </select></label>
  <p lang="en">Selected locale: <SelectedLocale /></p>
  <section id="order-form" lang={view.locale}>
    <h1 id="heading">{text.heading}</h1><p id="greeting">{text.greeting}</p>
    <p id="rich-preview"><RichText parts={text.rich} renderers={{ strong, link }} /></p>
    <label>{text.nameLabel}<input id="name" autocomplete="off" bind:value={name} /></label>
    <label>{text.noteLabel}<textarea id="note" rows="3" bind:value={note}></textarea></label>
    <button id="open-dialog" onclick={() => { open = true; }}>{text.openDialog}</button>
  </section>
  <p id="transition-error" role="alert" lang="ko">{transitionError}</p>
  <p id="error" role="alert" lang="ko">{diagnostic}</p>
  <p id="render-error" role="alert" lang="ko">{view.error}</p>
</main>
<dialog id="confirmation" bind:this={dialog} lang={view.locale} aria-labelledby="dialog-title" onclose={() => { open = false; }}>
  <form method="dialog">
    <h2 id="dialog-title">{text.dialogTitle}</h2>
    <label>{text.dialogNoteLabel}<input id="confirmation-note" autocomplete="off" bind:value={confirmation} /></label>
    <button id="close-dialog">{text.closeDialog}</button>
    <p role="alert" lang="ko">{diagnostic || view.error}</p>
  </form>
</dialog>
