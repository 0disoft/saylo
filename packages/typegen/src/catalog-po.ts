import { parseTranslationWorkfile } from './catalog-workfile.js';
import type { TranslationWorkfile } from './catalog-workfile.js';

function quote(text: string): string {
  if (/[\uD800-\uDFFF]/u.test(text)) throw new TypeError('PO text must contain well-formed Unicode.');
  let result = '"';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    result += char === '"' || char === '\\' ? '\\' + char : code < 32 || code === 127
      ? '\\' + code.toString(8).padStart(3, '0') : char;
  }
  return result + '"';
}
function unquote(text: string): string {
  if (!text.startsWith('"') || !text.endsWith('"')) throw new TypeError('Invalid PO quoted string.');
  if (/[\uD800-\uDFFF]/u.test(text)) throw new TypeError('PO text must contain well-formed Unicode.');
  // C octal escapes represent bytes. Keep bytes until all continuation lines
  // are joined, since a UTF-8 character can span multiple quoted fragments.
  text = Buffer.from(text, 'utf8').toString('latin1');
  let result = '';
  const escaped: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', a: '\x07', '"': '"', '\\': '\\', '?': '?' };
  for (let i = 1; i < text.length - 1; i++) {
    const char = text[i]!;
    if (char === '"') throw new TypeError('Unescaped PO quote.');
    if (char !== '\\') { result += char; continue; }
    const next = text[++i];
    if (next === undefined || i >= text.length - 1) throw new TypeError('Truncated PO escape.');
    if (Object.hasOwn(escaped, next)) result += escaped[next];
    else if (/[0-7]/.test(next)) {
      let octal = next;
      while (octal.length < 3 && i + 1 < text.length - 1 && /[0-7]/.test(text[i + 1]!)) octal += text[++i];
      const value = parseInt(octal, 8);
      if (value > 255) throw new TypeError('PO octal escape exceeds one byte.');
      result += String.fromCharCode(value);
    } else throw new TypeError(`Unsupported PO escape: ${next}`);
  }
  return result;
}

/** One ICU message per gettext entry; checkpoints live in msgctxt, never in editable comments. */
export function serializeTranslationPo(work: TranslationWorkfile): string {
  parseTranslationWorkfile(JSON.stringify(work), work.baseLocale);
  const header = `Content-Type: text/plain; charset=UTF-8\nX-Saylo-Format: ${work.format}\nX-Saylo-Base-Locale: ${work.baseLocale}\n`;
  const output = ['msgid ""', 'msgstr ' + quote(header), ''];
  for (const entry of work.entries) {
    const { source, translation, ...checkpoint } = entry;
    const metadata = entry.context?.metadata;
    if (metadata?.description) for (const line of metadata.description.split(/\r?\n/)) output.push('#. ' + line);
    if (metadata?.maxLength) output.push(`#. Advisory maximum rendered length: ${metadata.maxLength}`);
    output.push('msgctxt ' + quote(JSON.stringify({ checkpoint, pending: translation === null })),
      'msgid ' + quote(source), 'msgstr ' + quote(translation ?? ''), '');
  }
  return output.join('\n');
}

export function parseTranslationPo(source: string, baseLocale: string): TranslationWorkfile {
  type Entry = { context?: string; source?: string; translation?: string; fuzzy: boolean };
  const entries: Entry[] = [];
  let entry: Entry = { fuzzy: false }, field: 'context' | 'source' | 'translation' | undefined;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const flush = () => {
    if (entry.source !== undefined || entry.translation !== undefined || entry.context !== undefined) {
      if (entry.source === undefined || entry.translation === undefined) throw new TypeError('Incomplete PO entry.');
      for (const key of ['context', 'source', 'translation'] as const) {
        if (entry[key] !== undefined) entry[key] = decoder.decode(Buffer.from(entry[key]!, 'latin1'));
      }
      entries.push(entry);
    } else return;
    entry = { fuzzy: false }; field = undefined;
  };
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('#~')) throw new TypeError('Obsolete PO entries must be removed before import.');
    if (line.startsWith('#')) {
      if (entry.translation !== undefined) flush();
      if (line.startsWith('#,') && line.slice(2).split(',').some(flag => flag.trim() === 'fuzzy')) entry.fuzzy = true;
      continue;
    }
    if (line.startsWith('"')) {
      if (!field) throw new TypeError('PO continuation without a field.');
      entry[field] = entry[field]! + unquote(line); continue;
    }
    const match = /^(msgctxt|msgid|msgstr)\s+(".*")$/.exec(line);
    if (!match) throw new TypeError('Unsupported PO syntax. Native gettext plural forms are not ICU messages.');
    const next = match[1] === 'msgctxt' ? 'context' : match[1] === 'msgid' ? 'source' : 'translation';
    if ((next === 'context' || next === 'source') && entry.translation !== undefined) flush();
    if (entry[next] !== undefined) throw new TypeError('Duplicate PO field.');
    field = next; entry[next] = unquote(match[2]!);
  }
  flush();
  const header = entries.shift();
  if (!header || header.context !== undefined || header.source !== '' || header.fuzzy) throw new TypeError('Missing or invalid Saylo PO header.');
  const headers = new Map<string, string>();
  for (const line of header.translation!.split('\n').filter(Boolean)) {
    const separator = line.indexOf(':');
    if (separator < 1) throw new TypeError('Invalid PO header line.');
    const key = line.slice(0, separator).toLowerCase();
    if (headers.has(key)) throw new TypeError('Duplicate PO header.');
    headers.set(key, line.slice(separator + 1).trim());
  }
  if (headers.get('x-saylo-base-locale') !== baseLocale) throw new TypeError('PO base locale mismatch.');
  if (!/^text\/plain\s*;\s*charset\s*=\s*"?utf-8"?\s*$/i.test(headers.get('content-type') ?? ''))
    throw new TypeError('Saylo PO files must declare UTF-8 encoding.');
  const work = { format: headers.get('x-saylo-format'), baseLocale, entries: entries.map(row => {
    if (row.context === undefined) throw new TypeError('Missing Saylo checkpoint in PO msgctxt.');
    const context: unknown = JSON.parse(row.context);
    if (!context || typeof context !== 'object' || Array.isArray(context) || Object.keys(context).length !== 2 ||
        !('checkpoint' in context) || !('pending' in context) || typeof context.pending !== 'boolean' ||
        context.checkpoint === null || typeof context.checkpoint !== 'object' || Array.isArray(context.checkpoint))
      throw new TypeError('Invalid Saylo PO checkpoint.');
    if (Object.hasOwn(context.checkpoint, 'source') || Object.hasOwn(context.checkpoint, 'translation'))
      throw new TypeError('PO checkpoint must not replace editable message fields.');
    return { ...context.checkpoint, source: row.source,
      translation: row.fuzzy || (context.pending && row.translation === '') ? null : row.translation };
  }) };
  return parseTranslationWorkfile(JSON.stringify(work), baseLocale);
}
