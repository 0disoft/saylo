import { readFile } from 'node:fs/promises';

export interface TranslationNotes {
  readonly description?: string;
  /** Advisory rendered-text limit; placeholders may expand beyond source length. */
  readonly maxLength?: number;
  readonly screenshots?: readonly string[];
  readonly glossary?: Readonly<Record<string, string>>;
}
export interface TranslationMetadata {
  readonly format: 'saylo-translation-metadata/v1';
  readonly messages: Readonly<Record<string, TranslationNotes>>;
}
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
export function isTranslationNotes(v: unknown): v is TranslationNotes {
  if (!record(v) || Object.keys(v).some(key => !['description', 'maxLength', 'screenshots', 'glossary'].includes(key))) return false;
  if (v.description !== undefined && typeof v.description !== 'string') return false;
  if (v.maxLength !== undefined && (!Number.isSafeInteger(v.maxLength) || (v.maxLength as number) < 1)) return false;
  if (v.screenshots !== undefined && (!Array.isArray(v.screenshots) || !v.screenshots.every(url => {
    try { return typeof url === 'string' && ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; }
  }))) return false;
  return v.glossary === undefined || (record(v.glossary) && Object.entries(v.glossary).every(([term, text]) => !!term && typeof text === 'string'));
}
export function parseTranslationMetadata(source: string): TranslationMetadata {
  const v: unknown = JSON.parse(source.replace(/^\uFEFF/, ''));
  if (!record(v) || v.format !== 'saylo-translation-metadata/v1' || Object.keys(v).length !== 2 || !record(v.messages) ||
      !Object.entries(v.messages).every(([key, notes]) => /^[^:\x00-\x1f]+:[^:\x00-\x1f]+$/.test(key) && isTranslationNotes(notes)))
    throw new TypeError('Invalid translation metadata. Expected messages keyed by namespace:id.');
  return v as unknown as TranslationMetadata;
}
export async function readTranslationMetadata(file: string): Promise<TranslationMetadata> {
  try { return parseTranslationMetadata(await readFile(file, 'utf8')); }
  catch (cause) { throw new Error(`Unable to read translation metadata: ${file}`, { cause }); }
}
