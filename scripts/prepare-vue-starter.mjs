import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareLocalStarter } from './prepare-local-starter.mjs';

/** Preserve the Vue entry point while sharing export validation, copying and packing. */
export function prepareVueStarter(destination) {
  return prepareLocalStarter('vue', destination);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { 'out-dir': { type: 'string' } } });
  assert.ok(values['out-dir'], 'Pass --out-dir <empty-directory-outside-Saylo>.');
  const manifest = await prepareVueStarter(values['out-dir']);
  console.log(JSON.stringify({ destination: path.resolve(values['out-dir']), ...manifest }, null, 2));
}
