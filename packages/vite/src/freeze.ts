import type { ParsedCatalog } from '@0disoft/saylo-core';
// Match the dev client's other core imports so Vite prebundling shares its
// module-local deep-freeze cache with the application's core instance.
import { freezeCatalogs as freezeCoreCatalogs } from '@0disoft/saylo-core';

/** Freeze trusted transport data in place, or snapshot caller-owned data when copy is set. */
export function freezeCatalogs(catalogs: readonly ParsedCatalog[], options: { readonly copy?: boolean } = {}): readonly ParsedCatalog[] {
  return freezeCoreCatalogs(catalogs, options);
}
