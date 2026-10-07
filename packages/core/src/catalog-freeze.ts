import { freeze } from './diagnostics.js';
import type { ParsedCatalog } from './types.js';

/** Restore deep immutability after transport, sharing the core's traversal cache. */
export function freezeCatalogs(catalogs: readonly ParsedCatalog[]): readonly ParsedCatalog[] {
  return freeze(catalogs);
}
