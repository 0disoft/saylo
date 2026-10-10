import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const formatter = fileURLToPath(new URL('ast-format.mjs', import.meta.url));
const virtual = '\0thin-layer:intl-ast';

// Experiment-only build adapter. Rewrite only this AST formatter's import;
// ordinary string-based IntlMessageFormat consumers retain their parser.
export function thinLayerAstRuntime() {
  let sourceFile;
  return {
    name: 'thin-layer-ast-runtime',
    apply: 'build',
    transform(code, id) {
      if (path.normalize(id.split('?')[0]) !== path.normalize(formatter)) return;
      const next = code.replace(/(['"])intl-messageformat\1/g, JSON.stringify(virtual));
      if (next === code) throw new Error('Unsupported thin-layer formatter import boundary.');
      return { code: next, map: null };
    },
    async resolveId(id, importer) {
      if (importer === virtual && sourceFile) return this.resolve(id, sourceFile, { skipSelf: true });
      if (id !== virtual) return;
      const resolved = await this.resolve('intl-messageformat', formatter, { skipSelf: true });
      if (!resolved || resolved.external || resolved.id.startsWith('\0'))
        throw new Error('Thin-layer AST runtime needs a readable bundled IntlMessageFormat entry.');
      sourceFile = resolved.id;
      return virtual;
    },
    async load(id) {
      if (id !== virtual || !sourceFile) return;
      const code = await readFile(sourceFile, 'utf8');
      const next = code.replace(/(['"])@formatjs\/icu-messageformat-parser\1/g,
        "'@formatjs/icu-messageformat-parser/no-parser.js'");
      if (next === code) throw new Error('Unsupported IntlMessageFormat AST boundary.');
      return next;
    },
  };
}
