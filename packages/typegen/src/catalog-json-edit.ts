interface Entry { readonly id: string; readonly keyOffset: number; readonly valueOffset: number; readonly end: number }

/** Edit an already validated flat string catalog. The caller must validate the result too. */
export function editCatalogJson(source: string, patch: Readonly<Record<string, string>>): string {
  const tokens = /"(?:[^"\\]|\\[\s\S])*"/g;
  const entries: Entry[] = [];
  let key: RegExpExecArray | null;
  while ((key = tokens.exec(source)) !== null) {
    const value = tokens.exec(source)!;
    entries.push({ id: JSON.parse(key[0]) as string, keyOffset: key.index,
      valueOffset: value.index, end: tokens.lastIndex });
  }
  const known = new Set(entries.map(entry => entry.id));
  const added = Object.entries(patch).filter(([id]) => !known.has(id));
  const chunks: string[] = [];
  let cursor = 0;
  for (const entry of entries) {
    if (!Object.hasOwn(patch, entry.id)) continue;
    // Unchanged values retain their original escapes, even when supplied explicitly.
    if (JSON.parse(source.slice(entry.valueOffset, entry.end)) === patch[entry.id]) continue;
    chunks.push(source.slice(cursor, entry.valueOffset), JSON.stringify(patch[entry.id]));
    cursor = entry.end;
  }
  if (added.length) {
    const first = entries[0], last = entries.at(-1);
    const open = source.indexOf('{');
    const beforeFirst = source.slice(open + 1, first?.keyOffset ?? source.lastIndexOf('}'));
    const newline = beforeFirst.match(/\r\n|\n|\r/)?.[0];
    const indent = first ? beforeFirst.match(/(?:\r\n|\n|\r)([ \t]*)$/)?.[1] ?? ''
      : (beforeFirst.match(/(?:\r\n|\n|\r)([ \t]*)$/)?.[1] ?? '') + '  ';
    // Reuse the first key's colon spacing and (for inline JSON) the first comma spacing.
    const colon = first ? source.slice(first.keyOffset, first.valueOffset).match(/"([ \t\r\n]*:[ \t\r\n]*)$/)![1]!
      : newline || beforeFirst.length ? ': ' : ':';
    const between = entries[1] ? source.slice(first!.end, entries[1].keyOffset) : undefined;
    const separator = newline ? `,${newline}${indent}`
      : between && /^,[ \t]*$/.test(between) ? between : colon.includes(' ') ? ', ' : ',';
    const insertion = last?.end ?? open + 1;
    const prefix = last ? separator : newline ? newline + indent : beforeFirst;
    chunks.push(source.slice(cursor, insertion), prefix,
      added.map(([id, value]) => JSON.stringify(id) + colon + JSON.stringify(value)).join(separator));
    cursor = insertion;
  }
  chunks.push(source.slice(cursor));
  return chunks.join('');
}
