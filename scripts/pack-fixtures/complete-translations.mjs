import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { CatalogError } from '@0disoft/saylo-core';
import saylo from '@0disoft/saylo-vite';

// Runs only in the pack smoke's disposable external consumer app.
const root = process.cwd();
const localesDir = 'complete-locales';
for (const locale of ['ko', 'en']) await mkdir(path.join(root, localesDir, locale), { recursive: true });
await writeFile(path.join(root, localesDir, 'ko/demo.json'), '{"hello":"ko {name}","empty":""}');
await writeFile(path.join(root, localesDir, 'ko/help.json'), '{"title":"Help"}');
await writeFile(path.join(root, localesDir, 'en/demo.json'), '{"empty":""}');
await writeFile(path.join(root, 'complete-entry.js'), 'export const marker = "complete";');
const out = path.join(root, 'complete-generated.d.ts');
const config = requireCompleteTranslations => ({ configFile: false, root, logLevel: 'silent',
  plugins: [saylo({ localesDir, baseLocale: 'ko', initialNamespaces: ['demo'], requireCompleteTranslations,
    typegen: { outFile: 'complete-generated.d.ts' } })],
  build: { write: false, rolldownOptions: { input: path.join(root, 'complete-entry.js') } },
});
await build(config(false));
await writeFile(out, '// keep existing types');
await assert.rejects(build(config(true)), error => {
  assert.ok(error instanceof CatalogError);
  assert.deepEqual(error.diagnostics.map(d => [d.code, d.locale, d.namespace, d.sourceName, d.id]), [
    ['MISSING_MESSAGE', 'en', 'demo', 'en/demo.json', 'hello'],
    ['MISSING_NAMESPACE', 'en', 'help', 'en/help.json', undefined],
  ]);
  return true;
});
assert.equal(await readFile(out, 'utf8'), '// keep existing types');
await writeFile(path.join(root, localesDir, 'en/demo.json'), '{"hello":"Hello","empty":""}');
await writeFile(path.join(root, localesDir, 'en/help.json'), '{"title":""}');
await build(config(true));
assert.ok((await readFile(out, 'utf8')).includes('demo:hello'));
console.log('[pack] Complete translation option: default fallback, missing key/namespace diagnostics, retained types and repaired build passed.');
