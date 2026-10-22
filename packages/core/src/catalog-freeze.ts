import { freeze, immutableSnapshot } from './diagnostics.js';
import type { ParsedCatalog } from './types.js';

/** Freeze input in place by default. With copy, snapshot mutable data and share already immutable subtrees. */
export function freezeCatalogs(catalogs: readonly ParsedCatalog[], options: { readonly copy?: boolean } = {}): readonly ParsedCatalog[] {
  return options.copy ? immutableSnapshot(catalogs) : freeze(catalogs);
}
