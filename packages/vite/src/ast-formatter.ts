import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Resolver {
  resolve(source: string, importer: string, options: { skipSelf: true }): Promise<{ id: string; external?: boolean | 'absolute' | 'relative' } | null>;
}

const VIRTUAL = '\0saylo:intl-ast';
const formatter = path.join(path.dirname(fileURLToPath(import.meta.resolve('@0disoft/saylo-core'))), 'formatters.js');
const messageFormat = createRequire(formatter).resolve('intl-messageformat');

/** A separate FormatJS module for Saylo AST inputs; other consumers keep the normal parser. */
export function createAstFormatter() {
  let sourceFile: string | undefined;
  return {
    resolve(source: string, importer: string | undefined, context: Resolver) {
      if (importer === VIRTUAL && sourceFile) return context.resolve(source, sourceFile, { skipSelf: true });
      if ((source !== 'intl-messageformat' && path.normalize(source) !== path.normalize(messageFormat)) ||
          !importer || path.normalize(importer.split('?')[0]!) !== path.normalize(formatter)) return;
      return context.resolve(source, importer, { skipSelf: true }).then(resolved => {
        if (resolved?.external) return resolved;
        if (!resolved || resolved.id.startsWith('\0'))
          throw new Error('Saylo AST runtime requires a readable intl-messageformat module. Set astRuntime: false for a custom formatter alias.');
        sourceFile = resolved.id;
        return VIRTUAL;
      });
    },
    load(id: string) {
      if (id !== VIRTUAL || !sourceFile) return;
      return readFile(sourceFile, 'utf8').then(code => {
        const next = code.replace(/(['"])@formatjs\/icu-messageformat-parser\1/g, "'@formatjs/icu-messageformat-parser/no-parser.js'");
        if (next === code) throw new Error('Unsupported intl-messageformat AST boundary. Set astRuntime: false to use the normal formatter.');
        return next;
      });
    },
  };
}
