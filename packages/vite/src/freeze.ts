import type { ParsedCatalog } from '@0disoft/saylo-core';
// Match the dev client's other core imports so Vite prebundling shares its
// module-local deep-freeze cache with the application's core instance.
import { freezeCatalogs as freezeCoreCatalogs } from '@0disoft/saylo-core';

/** Restore immutability of trusted plugin-produced AST data after JSON transport. */
export function freezeCatalogs(catalogs: readonly ParsedCatalog[]): readonly ParsedCatalog[] {
  return freezeCoreCatalogs(catalogs);
}
