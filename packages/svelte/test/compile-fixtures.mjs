import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { compile } from 'svelte/compiler';

export async function compileFixtures(generate) {
  const output = new URL(`./.compiled/${generate}/`, import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL('bindings.mjs', output), await readFile(new URL('./fixtures/bindings.mjs', import.meta.url)));
  for (const name of ['Child', 'SelectedChild', 'Nested', 'Parent']) {
    const input = new URL(`./fixtures/${name}.svelte`, import.meta.url);
    const { js, warnings } = compile(await readFile(input, 'utf8'), { filename: input.pathname, generate });
    if (warnings.length) throw new Error(warnings.map(warning => warning.message).join('\n'));
    await writeFile(new URL(`${name}.mjs`, output), js.code.replaceAll(/(['"])(\.\/\w+)\.svelte\1/g, '$1$2.mjs$1'));
  }
  return output;
}
