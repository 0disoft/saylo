<script lang="ts">
  import { getI18n } from './i18n';
  const i18n = getI18n();
  let name = $state('');
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

<section class="panel preview">
  <div class="panel-header"><h2>{$i18n.t('demo:formTitle')}</h2><span id="revision" class="badge">revision {$i18n.stateRevision}</span></div>
  <form onsubmit={event => { event.preventDefault(); open = true; }}>
    <label>{$i18n.t('demo:name')}<input id="name" autocomplete="off" bind:value={name} /></label>
    <label>{$i18n.t('demo:note')}<textarea id="note" rows="3" bind:value={note}></textarea></label>
    <button id="open-dialog" type="submit">{$i18n.t('demo:openDialog')}</button>
  </form>
</section>
<dialog id="confirmation" bind:this={dialog} onclose={() => { open = false; }}>
  <form method="dialog">
    <h2>{$i18n.t('demo:dialogTitle')}</h2>
    <label>{$i18n.t('demo:dialogNote')}<input id="confirmation-note" autocomplete="off" bind:value={confirmation} /></label>
    <button id="close-dialog">{$i18n.t('demo:closeDialog')}</button>
    <a id="dialog-about" href="/about?locale={$i18n.locale}">{$i18n.t('demo:about')}</a>
  </form>
</dialog>
