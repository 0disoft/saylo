import type { ParsedCatalog } from '@saylo/core';

/** Restore immutability of trusted plugin-produced AST data after JSON transport. */
export function freezeCatalogs(catalogs: readonly ParsedCatalog[]): readonly ParsedCatalog[] {
  function freeze(value: unknown) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  }
  freeze(catalogs);
  return catalogs;
}
