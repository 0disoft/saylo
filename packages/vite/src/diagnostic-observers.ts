import type { LiveDiagnostic } from './types.js';

/** Even a thrown value with a broken getter/coercion must not break diagnostics. */
export function diagnosticMessage(error: unknown): string {
  try { return String(error instanceof Error ? error.message : error); }
  catch { return 'Diagnostic error message is unavailable.'; }
}

/** Diagnostic views are passive. Never recursively report their own failures. */
export function deliverDiagnostic(listener: ((diagnostic: LiveDiagnostic) => void) | undefined, diagnostic: LiveDiagnostic): void {
  try { listener?.(diagnostic); }
  catch { /* A synchronous diagnostic observer failure must not interrupt transport or another view. */ }
}
