import type { LiveDiagnostic } from './types.js';

/** Diagnostic views are passive. Never recursively report their own failures. */
export function deliverDiagnostic(listener: ((diagnostic: LiveDiagnostic) => void) | undefined, diagnostic: LiveDiagnostic): void {
  try { listener?.(diagnostic); }
  catch { /* A synchronous diagnostic observer failure must not interrupt transport or another view. */ }
}
