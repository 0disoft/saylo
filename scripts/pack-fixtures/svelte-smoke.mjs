import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSvelteStore } from '@0disoft/saylo-svelte';
import * as bindings from '@0disoft/saylo-svelte';

const source = `<script>
  import { createSvelteStore } from '@0disoft/saylo-svelte';
  const { instance } = $props();
  const i18n = createSvelteStore(instance);
</script><h1>{$i18n.t('demo:title')}</h1>`;
const { js } = compile(source, { generate: 'server', filename: 'Packed.svelte' });
await writeFile('packed-svelte.mjs', js.code);
const { default: View } = await import('./packed-svelte.mjs');
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.resolve('@0disoft/saylo-svelte')), 'utf8'));
if (manifest.exports?.['./RichText.svelte']) {
  const componentUrl = new URL(import.meta.resolve('@0disoft/saylo-svelte/RichText.svelte'));
  const component = compile(await readFile(componentUrl, 'utf8'), { generate: 'server', filename: componentUrl.pathname });
  assert.deepEqual(component.warnings, []);
  await writeFile('packed-rich-component.mjs', component.js.code.replaceAll('./RichText.svelte', './packed-rich-component.mjs')
    .replaceAll('./rich-text.js', new URL('./rich-text.js', componentUrl).href));
  const richSource = `<script>
    import RichText from './packed-rich-component.mjs';
    let { parts } = $props();
  </script>
  {#snippet strong(children)}<strong>{@render children()}</strong>{/snippet}
  {#snippet link(children)}<a href='/orders'>{@render children()}</a>{/snippet}
  <p><RichText {parts} renderers={{strong, link}} /></p>`;
  const rich = compile(richSource, { generate: 'server', filename: 'PackedRich.svelte' });
  assert.deepEqual(rich.warnings, []);
  await writeFile('packed-rich.mjs', rich.js.code);
  const { default: RichView } = await import('./packed-rich.mjs');
  const catalog = parseCatalog('{"title":"<link>Hi <strong>{name}</strong></link><script>safe</script>"}', { locale: 'en', namespace: 'demo' });
  const store = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
  try {
    assert.equal(render(RichView, { props: { parts: store.tParts('demo:title', { name: '<img>' }) } }).body.replace(/<!--[\s\S]*?-->/g, ''),
      '<p><a href="/orders">Hi <strong>&lt;img></strong></a>safe</p>');
  } finally { store.dispose(); }
  console.log('[pack] Svelte rich component tarball: public entry, nested snippets and escaped SSR passed.');
}
const catalog = parseCatalog('{"title":"Packed Svelte"}', { locale: 'en', namespace: 'demo' });
const instance = createStore({ baseLocale: 'en', locale: 'en', catalogs: [catalog] });
try {
  assert.match(render(View, { props: { instance } }).body, /<h1>Packed Svelte<\/h1>/);
  let value;
  const off = createSvelteStore(instance).subscribe(snapshot => { value = snapshot; });
  assert.equal(value.t('demo:title'), 'Packed Svelte');
  off();
  if (bindings.selectSvelteStore) {
    const selectedSource = `<script>
      import { createSvelteStore, selectSvelteStore } from '@0disoft/saylo-svelte';
      const { instance } = $props();
      const title = selectSvelteStore(createSvelteStore(instance), snapshot => snapshot.t('demo:title'));
    </script><h1>{$title}</h1>`;
    const { js } = compile(selectedSource, { generate: 'server', filename: 'PackedSelected.svelte' });
    await writeFile('packed-svelte-selected.mjs', js.code);
    const { default: SelectedView } = await import('./packed-svelte-selected.mjs');
    assert.match(render(SelectedView, { props: { instance } }).body, /<h1>Packed Svelte<\/h1>/);
    console.log('[pack] Svelte selector tarball: compiled SSR selection passed.');
  }
  console.log('[pack] Svelte tarball: compiled SSR component, synchronous subscription and README execution passed.');
} finally { instance.dispose(); }
