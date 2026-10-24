/** Match complete keys against literal template pieces separated by arbitrary strings. */
export function compileTemplateKey(pieces: readonly string[]): (key: string) => boolean {
  const prefix = pieces[0] ?? '', suffix = pieces.at(-1) ?? '';
  const middle = pieces.slice(1, -1);
  return key => {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) return false;
    let offset = prefix.length;
    const end = key.length - suffix.length;
    if (offset > end) return false;
    // The earliest occurrence leaves the most room for all remaining pieces.
    // Never revisit earlier choices, and never consume the reserved suffix.
    for (const piece of middle) {
      const next = key.indexOf(piece, offset);
      if (next < 0 || next + piece.length > end) return false;
      offset = next + piece.length;
    }
    return true;
  };
}
