import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { compile } from 'svelte/compiler';

export async function compileFixtures(generate) {
  const output = new URL(`./.compiled/${generate}/`, import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('bindings.mjs', output), await readFile(new URL('./fixtures/bindings.mjs', import.meta.url)));
  const richComponent = new URL('../dist/RichText.svelte', import.meta.url);
  const rich = compile(await readFile(richComponent, 'utf8'), { filename: richComponent.pathname, generate });
  if (rich.warnings.length) throw new Error(rich.warnings.map(warning => warning.message).join('\n'));
  await writeFile(new URL('RichText.mjs', output), rich.js.code.replaceAll('./RichText.svelte', './RichText.mjs')
    .replaceAll('./rich-text.js', new URL('../dist/rich-text.js', import.meta.url).href));
  for (const name of ['Child', 'SelectedChild', 'Nested', 'Parent', 'RichView', 'RichCounter']) {
    const input = new URL(`./fixtures/${name}.svelte`, import.meta.url);
    const { js, warnings } = compile(await readFile(input, 'utf8'), { filename: input.pathname, generate });
    if (warnings.length) throw new Error(warnings.map(warning => warning.message).join('\n'));
    await writeFile(new URL(`${name}.mjs`, output), js.code.replaceAll(/(['"])(\.\/\w+)\.svelte\1/g, '$1$2.mjs$1')
      .replaceAll('@0disoft/saylo-svelte/RichText.svelte', './RichText.mjs'));
  }
  return output;
}
