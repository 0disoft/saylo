import { createSSRApp, h, onMounted, ref, watch } from 'vue';
import { createSayloVue } from '@0disoft/saylo-vue';

// Only the context key is shared. Every request/client supplies its own instance.
const { provideI18n, useI18n } = createSayloVue();
const Form = {
  setup() {
    const state = useI18n();
    const name = ref(''), note = ref(''), count = ref(2), error = ref('');
    const nameField = ref(), noteField = ref();
    onMounted(() => {
      // Adopt edits made before JavaScript arrives. The input DOM owns its value.
      name.value = nameField.value.value;
      note.value = noteField.value.value;
      document.documentElement.lang = state.value.locale;
    });
    watch(() => state.value.locale, locale => { document.documentElement.lang = locale; });
    return () => {
      const { t, locale, availableLocales, setLocale } = state.value;
      return h('main', null, [
        h('p', { lang: 'en' }, 'Saylo · Vue SSR + hydration'),
        h('label', { lang: 'en' }, ['Locale', h('select', { id: 'locale', value: locale,
          onChange: async event => {
            error.value = '';
            try { await setLocale(event.target.value); } catch (reason) { error.value = String(reason); }
          } }, availableLocales.map(value => h('option', { value, selected: value === locale }, value)))]),
        h('h1', null, t('demo:heading')),
        h('label', null, [t('demo:name'), h('input', { id: 'name', ref: nameField,
          autocomplete: 'off', placeholder: t('demo:namePlaceholder'), onInput: event => { name.value = event.target.value; } })]),
        h('label', null, [t('demo:note'), h('textarea', { id: 'note', ref: noteField,
          rows: 3, onInput: event => { note.value = event.target.value; } })]),
        h('p', { id: 'form-values' }, `${name.value} / ${note.value}`),
        h('button', { id: 'count', onClick: () => { count.value++; } }, t('demo:summary', { count: count.value })),
        h('p', { id: 'error', role: 'alert' }, error.value),
      ]);
    };
  },
};

export function createApp(instance) {
  return createSSRApp({ setup() { provideI18n(instance); return () => h(Form); } });
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
