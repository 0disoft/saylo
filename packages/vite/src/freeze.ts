import type { ParsedCatalog } from '@0disoft/saylo-core';
import { freezeCatalogs as freezeCoreCatalogs } from '@0disoft/saylo-core/runtime';

/** Restore immutability of trusted plugin-produced AST data after JSON transport. */
export function freezeCatalogs(catalogs: readonly ParsedCatalog[]): readonly ParsedCatalog[] {
  return freezeCoreCatalogs(catalogs);
}
