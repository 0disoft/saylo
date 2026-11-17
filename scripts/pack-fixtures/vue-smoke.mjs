import assert from 'node:assert/strict';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloVue, renderRichText } from '@0disoft/saylo-vue';

const bindings = createSayloVue();
const catalog = (title, locale) => parseCatalog(JSON.stringify({ title }), { locale, namespace: 'demo' });
const run = async locale => {
  const store = createStore({ baseLocale: 'ko', locale, catalogs: [catalog('한국어', 'ko'), catalog('English', 'en')] });
  let subscribed = 0;
  const instance = { ...store, subscribe() { subscribed++; throw new Error('SSR must not subscribe'); } };
  const Child = { setup() {
    const title = bindings.useI18nSelector(snapshot => snapshot.t('demo:title'));
    return () => h('p', title.value);
  } };
  try {
    const result = await renderToString(createSSRApp(Child).use(bindings.createPlugin(instance)));
    assert.equal(subscribed, 0);
    return result;
  } finally { store.dispose(); }
};
assert.deepEqual(await Promise.all([run('ko'), run('en')]), ['<p>한국어</p>', '<p>English</p>']);
const rich = createStore({ baseLocale: 'en', locale: 'en', catalogs: [
  parseCatalog(JSON.stringify({ message: '<link>Hello <strong>{name}</strong></link> <script>safe</script>' }),
    { locale: 'en', namespace: 'rich' }),
] });
try {
  const html = await renderToString(createSSRApp({ render: () => h('p', renderRichText(rich.tParts('rich:message', { name: '<img>' }), {
    link: children => h('a', { href: '#order' }, children), strong: children => h('strong', children),
  })) }));
  assert.equal(html.replace(/<!--[\s\S]*?-->/g, ''), '<p><a href="#order">Hello <strong>&lt;img&gt;</strong></a> safe</p>');
} finally { rich.dispose(); }
console.log('Independent Vue tarball concurrent SSR and escaped rich text passed');
