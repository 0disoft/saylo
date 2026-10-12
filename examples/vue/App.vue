<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, shallowRef, watch, watchEffect } from 'vue';
import type { ParsedCatalog, StoreSnapshot } from '@0disoft/saylo-core';
import { connectDev, createSupportRecorder } from '@0disoft/saylo-vite/client';
import type { DevSyncState, LiveDiagnostic } from '@0disoft/saylo-vite/client';
import { catalogSource, initialCatalogs } from 'virtual:saylo/lazy';
import { useI18n, store } from './i18n';
import type { AppSchema } from './generated';
import { projectDemoMessages } from './demo-messages';
import { formatDevSyncState } from '../shared/dev-status';

const i18n = useI18n();
const name = ref(''), note = ref(''), count = ref<number | string>(2), confirmation = ref('');
const dialog = ref<HTMLDialogElement>();
const support = createSupportRecorder(__SAYLO_SUPPORT_ENV__);
const report = ref(''), supportStatus = ref('');
const syncState = shallowRef<DevSyncState>();
const catalogs = shallowRef<readonly ParsedCatalog[]>(initialCatalogs.flatMap(o => o.status === 'present' ? [o.catalog] : []));
const diagnostic = shallowRef<LiveDiagnostic>({ message: '', diagnostics: [] });
const handshakeMessage = ref('');
let disconnect: (() => void) | undefined;
let active = true;
onScopeDispose(() => { active = false; generation++; disconnect?.(); });
onMounted(() => {
  disconnect = connectDev(store, { catalogSource,
    onUpdate: value => { catalogs.value = value; },
    onDiagnostic: value => {
      support.onDiagnostic(value);
      if (value.operation === 'handshake') handshakeMessage.value = value.message;
      else diagnostic.value = value;
    },
    onSyncState: value => {
      support.onSyncState(value); syncState.value = value;
      if (value.status === 'connected') handshakeMessage.value = '';
    },
  });
});
const connection = computed(() => import.meta.hot ? formatDevSyncState(syncState.value) : '빌드된 카탈로그를 사용합니다.');
const details = computed(() => diagnostic.value.diagnostics.length
  ? diagnostic.value.diagnostics.map(d => `${d.sourceName}${d.id ? ` [${d.id}]` : ''}: ${d.message}`).join('\n')
  : diagnostic.value.message);
const lastRendered = shallowRef<StoreSnapshot<AppSchema>>();
const presentation = computed(() => projectDemoMessages(i18n.value, lastRendered.value, Number(count.value)));
const text = computed(() => presentation.value.messages);
watch(presentation, value => {
  if (value.accepted && value.accepted !== lastRendered.value) lastRendered.value = value.accepted;
}, { immediate: true, flush: 'post' });
watch(() => presentation.value.error, error => {
  if (error) support.onDiagnostic({ message: error, diagnostics: [], operation: 'observer' });
}, { immediate: true });
watchEffect(() => { document.documentElement.lang = i18n.value.locale; });
const pendingLocale = ref<string>(), transitionError = ref('');
let generation = 0;
async function selectLocale(event: Event) {
  const locale = (event.target as HTMLSelectElement).value;
  const request = ++generation;
  pendingLocale.value = locale; transitionError.value = '';
  try { await i18n.value.setLocale(locale); }
  catch (error) { if (active && request === generation) transitionError.value = error instanceof Error ? error.message : String(error); }
  finally { if (active && request === generation) pendingLocale.value = undefined; }
}
function source(locale: string) {
  const catalog = catalogs.value.find(c => c.locale === locale && c.namespace === 'demo');
  return catalog ? JSON.stringify(Object.fromEntries(Object.entries(catalog.messages).map(([key, message]) => [key, message.source])), null, 2)
    : '아직 로드하지 않았습니다.';
}
function generateReport() {
  report.value = JSON.stringify(support.getReport(), null, 2);
  supportStatus.value = '진단 자료를 만들었습니다. 검토한 뒤 필요한 곳에 직접 복사하세요.';
}
function clearReport() {
  support.clear(); if (syncState.value) support.onSyncState(syncState.value);
  report.value = ''; supportStatus.value = '이전 오류 기록과 생성한 자료를 지웠습니다.';
}
</script>

<template>
  <main>
    <header lang="ko">
      <a class="brand" href="/">Saylo <span lang="en">Vue 3 demo</span></a>
      <label class="locale-control">화면 언어
        <select id="locale" :value="pendingLocale ?? i18n.locale" aria-label="화면 언어" @change="selectLocale">
          <option v-for="locale in i18n.availableLocales" :key="locale" :value="locale" :lang="locale">
            {{ locale === 'ko' ? '한국어' : locale === 'en' ? 'English' : locale }}
          </option>
        </select>
      </label>
    </header>
    <section class="intro" :lang="presentation.locale">
      <p class="eyebrow" lang="en">VUE LIVE CATALOG PREVIEW</p>
      <h1>{{ text.heading }}</h1><p>{{ text.description }}</p>
      <p v-if="pendingLocale" role="status" lang="ko">{{ pendingLocale }} 문구를 불러오는 중입니다.</p>
      <p id="transition-error" role="alert" lang="ko">{{ transitionError }}</p>
      <p id="render-error" class="hint" role="alert" lang="ko">{{ presentation.error }}</p>
    </section>
    <div class="layout">
      <section class="panel preview" :lang="presentation.locale">
        <div class="panel-header"><h2>{{ text.formTitle }}</h2><span id="revision" class="badge" lang="en">revision {{ i18n.stateRevision }}</span></div>
        <form id="order-form" @submit.prevent="dialog?.showModal()">
          <label>{{ text.name }}<input id="name" v-model="name" autocomplete="off" :placeholder="text.namePlaceholder"></label>
          <label>{{ text.note }}<textarea id="note" v-model="note" rows="4" :placeholder="text.notePlaceholder"></textarea></label>
          <label>{{ text.count }}<input id="count" v-model="count" type="number" min="0" max="100"></label>
          <p id="summary" class="summary" aria-live="polite">{{ text.summary }}</p>
          <button id="open-dialog" type="submit">{{ text.openDialog }}</button>
        </form>
        <p class="hint" lang="ko">입력하고 확인 창을 연 뒤 examples/vue/locales/ko/demo.json을 수정하고 저장하세요.</p>
        <p class="hint" lang="ko">불러온 namespace: <span id="loaded-namespaces">{{ i18n.loadedNamespaces.join(', ') }}</span></p>
      </section>
      <section class="panel editor" lang="ko">
        <div class="panel-header"><h2>불러온 파일 문구</h2><span class="badge">JSON</span></div>
        <p class="hint">examples/vue/locales의 번역 파일을 수정하고 저장하세요. 오류가 있으면 마지막 정상 화면을 유지합니다.</p>
        <label>기준 문구 · 한국어<textarea id="ko-editor" class="code" rows="12" aria-label="한국어 카탈로그" spellcheck="false" readonly :value="source('ko')"></textarea></label>
        <label>번역 문구 · English<textarea id="en-editor" class="code" rows="12" aria-label="English catalog" lang="en" spellcheck="false" readonly :value="source('en')"></textarea></label>
        <p id="status" class="hint" role="status">{{ connection }}</p>
        <pre id="error" role="alert">{{ [details, handshakeMessage].filter(Boolean).join('\n') }}</pre>
      </section>
    </div>
    <details id="support-panel" lang="ko">
      <summary>문의용 진단 자료</summary>
      <p class="hint">번역 원문·파일 경로·입력값을 제외한 오류 코드와 연결 상태입니다. 내용을 확인한 뒤 직접 복사하세요.</p>
      <button id="support-export" type="button" @click="generateReport">진단 자료 만들기</button>
      <button id="support-clear" type="button" @click="clearReport">오류 기록 지우기</button>
      <label>검토하고 복사할 JSON<textarea id="support-report" class="code" rows="8" spellcheck="false" readonly :value="report"></textarea></label>
      <p id="support-status" role="status">{{ supportStatus }}</p>
    </details>
  </main>
  <dialog id="confirmation" ref="dialog" :lang="presentation.locale" aria-labelledby="dialog-title">
    <form method="dialog">
      <h2 id="dialog-title">{{ text.dialogTitle }}</h2>
      <label>{{ text.dialogNote }}<input id="confirmation-note" v-model="confirmation" autofocus autocomplete="off"></label>
      <button id="close-dialog">{{ text.closeDialog }}</button>
      <p id="dialog-status" class="hint" role="status" lang="ko">{{ connection }}{{ details && `\n${details}` }}{{ handshakeMessage && `\n${handshakeMessage}` }}</p>
      <p id="dialog-render-error" class="hint" role="alert" lang="ko">{{ presentation.error }}</p>
    </form>
  </dialog>
</template>
