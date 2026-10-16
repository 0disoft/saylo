import { createSSRApp, h, onMounted, ref, watch } from 'vue';
import { createSayloVue, renderRichText } from '@0disoft/saylo-vue';

// Only the context key is shared. Every request/client supplies its own instance.
const { createPlugin, useI18n } = createSayloVue();
const richRenderers = {
  strong: children => h('strong', children),
  link: children => h('a', { href: '#order-form' }, children),
};
function readMessages(snapshot, count, name) {
  const { t } = snapshot;
  return {
    heading: t('demo:heading'), name: t('demo:name'), namePlaceholder: t('demo:namePlaceholder'),
    note: t('demo:note'), summary: t('demo:summary', { count }),
    rich: snapshot.tParts('demo:rich', { name: name || 'Saylo' }),
  };
}
const Form = {
  setup() {
    const state = useI18n();
    const name = ref(''), note = ref(''), count = ref(2), error = ref('');
    const nameField = ref(), noteField = ref();
    let lastRendered;
    onMounted(() => {
      // Adopt edits made before JavaScript arrives. The input DOM owns its value.
      name.value = nameField.value.value;
      note.value = noteField.value.value;
      document.documentElement.lang = state.value.locale;
    });
    watch(() => state.value.locale, locale => { document.documentElement.lang = locale; });
    return () => {
      const { locale, availableLocales, setLocale } = state.value;
      let text, renderedLocale, renderError = '';
      try {
        // Publish the entire view only after rich marker validation also succeeds.
        text = readMessages(state.value, count.value, name.value);
        lastRendered = state.value;
      } catch (reason) {
        // An invalid first server render still fails instead of inventing translations.
        if (!lastRendered) throw reason;
        text = readMessages(lastRendered, count.value, name.value);
        renderError = `${reason instanceof Error ? reason.message : String(reason)}\n번역 마커를 수정하고 다시 저장하세요.`;
      }
      renderedLocale = lastRendered.locale;
      return h('main', { lang: renderedLocale, id: 'order-form' }, [
        h('p', { lang: 'en' }, 'Saylo · Vue SSR + hydration'),
        h('label', { lang: 'en' }, ['Locale', h('select', { id: 'locale', value: locale,
          onChange: async event => {
            error.value = '';
            try { await setLocale(event.target.value); } catch (reason) { error.value = String(reason); }
          } }, availableLocales.map(value => h('option', { value, selected: value === locale }, value)))]),
        h('h1', null, text.heading),
        h('label', null, [text.name, h('input', { id: 'name', ref: nameField,
          autocomplete: 'off', placeholder: text.namePlaceholder, onInput: event => { name.value = event.target.value; } })]),
        h('label', null, [text.note, h('textarea', { id: 'note', ref: noteField,
          rows: 3, onInput: event => { note.value = event.target.value; } })]),
        h('p', { id: 'form-values' }, `${name.value} / ${note.value}`),
        h('button', { id: 'count', onClick: () => { count.value++; } }, text.summary),
        h('p', { id: 'rich-preview' }, renderRichText(text.rich, richRenderers)),
        h('p', { id: 'render-error', role: 'alert', lang: 'ko' }, renderError),
        h('p', { id: 'error', role: 'alert' }, error.value),
      ]);
    };
  },
};

export function createApp(instance) {
  return createSSRApp(Form).use(createPlugin(instance));
}

// Counters make this example's ownership observable without inspecting Vue internals.
export function observeInstance(instance) {
  const active = { subscriptions: 0, disposalListeners: 0 };
  const track = (key, subscribe) => listener => {
    active[key]++;
    let off;
    try { off = subscribe(listener); } catch (error) { active[key]--; throw error; }
    let stopped = false;
    return () => { if (!stopped) { stopped = true; active[key]--; off(); } };
  };
  return { instance: { ...instance,
    subscribe: track('subscriptions', instance.subscribe), onDispose: track('disposalListeners', instance.onDispose) },
    stats: () => ({ ...active }) };
}
