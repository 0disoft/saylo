import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
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
