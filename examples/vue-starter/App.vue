<script setup lang="ts">
import { computed, defineComponent, h, onMounted, onScopeDispose, ref, shallowRef, watch, watchEffect } from 'vue';
import { renderRichText } from '@0disoft/saylo-vue';
import type { RichTextRenderers } from '@0disoft/saylo-vue';
import type { StoreSnapshot } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource } from 'virtual:saylo/lazy';
import type { AppSchema } from './generated';
import { useI18n, useI18nSelector, store } from './i18n';
import { projectMessages } from './demo-messages';

const i18n = useI18n();
const name = ref('Saylo'), note = ref(''), confirmation = ref('');
const dialog = ref<HTMLDialogElement>();
const diagnostic = ref(''), transitionError = ref('');
const pendingLocale = ref<string>();
const lastGood = shallowRef<StoreSnapshot<AppSchema>>();
const view = computed(() => projectMessages(i18n.value, lastGood.value, name.value || 'Saylo'));
const richRenderers: RichTextRenderers = {
  strong: children => h('strong', children),
  link: children => h('a', { href: '#order-form' }, children),
};
const RichPreview = () => renderRichText(view.value.messages.rich, richRenderers);
const SelectedLocale = defineComponent({ setup() {
  const locale = useI18nSelector(snapshot => snapshot.locale);
  return () => h('span', { id: 'selected-locale' }, locale.value);
} });
watch(view, value => {
  if (value.accepted && value.accepted !== lastGood.value) lastGood.value = value.accepted;
}, { immediate: true, flush: 'post' });
watchEffect(() => { document.documentElement.lang = i18n.value.locale; });
let disconnect: (() => void) | undefined;
let active = true, generation = 0;
onMounted(() => { disconnect = connectDev(store, { catalogSource, onDiagnostic: value => { diagnostic.value = value.message; } }); });
onScopeDispose(() => { active = false; generation++; disconnect?.(); });
async function selectLocale(event: Event) {
  const locale = (event.target as HTMLSelectElement).value;
  const request = ++generation;
  pendingLocale.value = locale; transitionError.value = '';
  try { await i18n.value.setLocale(locale); }
  catch (error) { if (active && request === generation) transitionError.value = String(error); }
  finally { if (active && request === generation) pendingLocale.value = undefined; }
}
</script>

<template>
  <main>
    <label lang="en">Locale
      <select id="locale" :value="pendingLocale ?? i18n.locale" @change="selectLocale">
        <option v-for="locale in i18n.availableLocales" :key="locale" :value="locale">{{ locale }}</option>
      </select>
    </label>
    <p lang="en">Selected locale: <SelectedLocale /></p>
    <section id="order-form" :lang="view.locale">
      <h1 id="heading">{{ view.messages.heading }}</h1>
      <p id="greeting">{{ view.messages.greeting }}</p>
      <p id="rich-preview"><RichPreview /></p>
      <label>{{ view.messages.nameLabel }}<input id="name" v-model="name" autocomplete="off"></label>
      <label>{{ view.messages.noteLabel }}<textarea id="note" v-model="note" rows="3"></textarea></label>
      <button id="open-dialog" @click="dialog?.showModal()">{{ view.messages.openDialog }}</button>
    </section>
    <p id="transition-error" role="alert" lang="ko">{{ transitionError }}</p>
    <p id="error" role="alert" lang="ko">{{ diagnostic }}</p>
    <p id="render-error" role="alert" lang="ko">{{ view.error }}</p>
  </main>
  <dialog id="confirmation" ref="dialog" :lang="view.locale" aria-labelledby="dialog-title">
    <form method="dialog">
      <h2 id="dialog-title">{{ view.messages.dialogTitle }}</h2>
      <label>{{ view.messages.dialogNoteLabel }}<input id="confirmation-note" v-model="confirmation" autofocus autocomplete="off"></label>
      <button id="close-dialog">{{ view.messages.closeDialog }}</button>
      <p role="alert" lang="ko">{{ diagnostic || view.error }}</p>
    </form>
  </dialog>
</template>

<style>
body { font-family: system-ui, sans-serif; margin: 0; padding: 1.5rem; }
main { max-width: 40rem; margin: auto; }
label { display: block; margin: 1rem 0; }
input, textarea, select, button { font: inherit; }
input, textarea { display: block; max-width: 100%; }
dialog { max-width: min(90vw, 32rem); }
</style>
