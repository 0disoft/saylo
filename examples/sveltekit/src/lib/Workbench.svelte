<script lang="ts">
  import { getI18n } from './i18n';
  import type { DemoMessages } from './demo-messages';
  import type { Snippet } from 'svelte';
  import RichText from '@0disoft/saylo-svelte/RichText.svelte';
  let { connection = '', details = '', messages, renderError = '', name = $bindable('') }: {
    connection?: string; details?: string; messages: DemoMessages; renderError?: string; name?: string;
  } = $props();
  const i18n = getI18n();
  let note = $state('');
  let confirmation = $state('');
  let open = $state(false);
  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

{#snippet strong(children: Snippet)}<strong>{@render children()}</strong>{/snippet}
{#snippet link(children: Snippet)}<a href="#order-form">{@render children()}</a>{/snippet}

<section class="panel preview">
  <div class="panel-header"><h2>{messages.formTitle}</h2><span id="revision" class="badge" lang="en">revision {$i18n.stateRevision}</span></div>
  <form id="order-form" onsubmit={event => { event.preventDefault(); open = true; }}>
    <label>{messages.name}<input id="name" autocomplete="off" bind:value={name} /></label>
    <label>{messages.note}<textarea id="note" rows="3" bind:value={note}></textarea></label>
    <p id="rich-preview"><RichText parts={messages.rich} renderers={{ strong, link }} /></p>
    <button id="open-dialog" type="submit">{messages.openDialog}</button>
  </form>
</section>
<dialog id="confirmation" aria-labelledby="dialog-title" bind:this={dialog} onclose={() => { open = false; }}>
  <form method="dialog">
    <h2 id="dialog-title">{messages.dialogTitle}</h2>
    <label>{messages.dialogNote}<input id="confirmation-note" autocomplete="off" bind:value={confirmation} /></label>
    <button id="close-dialog">{messages.closeDialog}</button>
    <a id="dialog-about" href="/about?locale={$i18n.locale}" data-sveltekit-reset="false">{messages.about}</a>
    <p id="dialog-render-error" class="hint" role="alert" lang="ko">{renderError}</p>
    <p id="dialog-status" class="hint" role="status" lang="ko">{connection}{details && `\n${details}`}</p>
  </form>
</dialog>
