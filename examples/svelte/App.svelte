<script lang="ts">
  import { onMount } from 'svelte';
  import { connectDev } from '@0disoft/saylo-vite/client';
  import type { LiveDiagnostic } from '@0disoft/saylo-vite/client';
  import { catalogSource } from 'virtual:saylo/lazy';
  import { setSayloContext, store } from './i18n';
  import Preview from './Preview.svelte';

  setSayloContext(store);
  let diagnostic = $state<LiveDiagnostic>({ message: '', diagnostics: [] });
  onMount(() => connectDev(store, { hot: import.meta.hot, catalogSource,
    onDiagnostic: value => { diagnostic = value; } }));
</script>

<main>
  <Preview />
  <p id="status" class="hint" role="status">{diagnostic.message
    ? '번역 파일을 확인해 주세요. 마지막 정상 번역을 표시합니다.'
    : import.meta.hot ? '번역 파일을 저장하면 화면에 자동 반영됩니다.' : '빌드된 카탈로그를 사용합니다.'}</p>
  <pre id="error" role="alert">{diagnostic.diagnostics.length
    ? diagnostic.diagnostics.map(value => `${value.sourceName}: ${value.message}`).join('\n') : diagnostic.message}</pre>
</main>
