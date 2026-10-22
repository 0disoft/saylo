import { CatalogError } from './diagnostics.js';
import { InvalidRichTextError, projectRichText } from './rich-text.js';
import type { CatalogDiagnostic, ParsedMessage } from './types.js';

/** Copy opt-in policy; caller-owned arrays must never be frozen or retained. */
export function readRichTextPolicy(value: unknown): Readonly<Record<string, readonly string[]>> | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('richText must map message IDs to allowed tag arrays.');
  const policy: Record<string, readonly string[]> = Object.create(null);
  for (const [id, tags] of Object.entries(value)) {
    if (!id || id.includes(':') || !Array.isArray(tags) || tags.some(tag => typeof tag !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(tag)) ||
        new Set(tags).size !== tags.length) throw new TypeError(`Invalid rich text policy for ${JSON.stringify(id)}.`);
    policy[id] = Object.freeze([...tags].sort());
  }
  return Object.freeze(policy);
}

/** Validate every ICU branch before the catalog can become visible to renderers. */
export function validateRichMessage(message: Pick<ParsedMessage, 'ast' | 'arguments'>, tags: readonly string[],
  context: Omit<CatalogDiagnostic, 'code' | 'message'>): void {
  try {
    const allowed = readRichTextPolicy({ message: tags })!.message!;
    const projected = projectRichText(message.ast, `${context.namespace}:${context.id}`, message.arguments);
    const names = new Set(allowed);
    for (const name of projected.tags.values()) if (!names.has(name))
      throw new InvalidRichTextError(`${context.namespace}:${context.id}`, `Tag <${name}> is outside the allowed rich text contract.`);
  } catch (cause) {
    throw new CatalogError([{ ...context, code: 'INVALID_RICH_TEXT', message: cause instanceof Error ? cause.message : String(cause) }]);
  }
}
