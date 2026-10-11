<script lang="ts">
  import { onMount } from 'svelte';
  import { connectDev, createSupportRecorder } from '@0disoft/saylo-vite/client';
  import type { DevSyncState, LiveDiagnostic } from '@0disoft/saylo-vite/client';
  import { catalogSource } from 'virtual:saylo/lazy';
  import { setSayloContext, store } from './i18n';
  import Preview from './Preview.svelte';
  import { formatDevSyncState } from '../shared/dev-status';
  import SupportPanel from './SupportPanel.svelte';

  setSayloContext(store);
  const support = createSupportRecorder(__SAYLO_SUPPORT_ENV__);
  let diagnostic = $state.raw<LiveDiagnostic>({ message: '', diagnostics: [] });
  let handshakeMessage = $state('');
  let syncState = $state.raw<DevSyncState>();
  const connection = $derived(import.meta.hot ? formatDevSyncState(syncState) : '빌드된 카탈로그를 사용합니다.');
  const details = $derived([diagnostic.diagnostics.length
    ? diagnostic.diagnostics.map(value => `${value.sourceName}: ${value.message}`).join('\n') : diagnostic.message,
    handshakeMessage].filter(Boolean).join('\n'));
  onMount(() => connectDev(store, { catalogSource,
    onDiagnostic: value => { support.onDiagnostic(value); if (value.operation === 'handshake') handshakeMessage = value.message; else diagnostic = value; },
    onSyncState: value => { support.onSyncState(value); syncState = value; if (value.status === 'connected') handshakeMessage = ''; }
  }));
</script>

<main>
  <Preview {connection} {details} onRenderDiagnostic={message => support.onDiagnostic({ message, diagnostics: [], operation: 'observer' })} />
  <p id="status" class="hint" role="status">{connection}</p>
  <pre id="error" role="alert">{details}</pre>
  <SupportPanel recorder={support} {syncState} />
</main>
