import { TYPE } from '@formatjs/icu-messageformat-parser/no-parser.js';
import type { LocationDetails, MessageFormatElement } from '@formatjs/icu-messageformat-parser';

// Strict end of input: `$` alone would also accept a trailing newline.
const identifier = /^[A-Za-z_][A-Za-z0-9_]*(?![\s\S])/;

/** Narrow top-level fast path for Saylo's ignoreTag + captureLocation options.
 * Anything outside literal text and ASCII {name} arguments delegates to FormatJS.
 */
export function parseSimpleMessage(source: string): MessageFormatElement[] | undefined {
  if (source.includes("'")) return undefined;
  const elements: MessageFormatElement[] = [];
  let offset = 0, line = 1, column = 1;
  let literalOffset = 0;
  let literalStart: LocationDetails = { offset, line, column };
  const position = (): LocationDetails => ({ offset, line, column });
  function literal() {
    if (offset !== literalOffset) elements.push({ type: TYPE.literal,
      value: source.slice(literalOffset, offset), location: { start: literalStart, end: position() } });
  }
  while (offset < source.length) {
    const code = source.charCodeAt(offset);
    if (code === 125) return undefined;
    if (code === 123) {
      const end = source.indexOf('}', offset + 1);
      if (end === -1) return undefined;
      const name = source.slice(offset + 1, end);
      if (!identifier.test(name)) return undefined;
      literal();
      const start = position();
      column += end + 1 - offset; // Recognized argument spans are entirely ASCII.
      offset = end + 1;
      elements.push({ type: TYPE.argument, value: name, location: { start, end: position() } });
      literalOffset = offset;
      literalStart = position();
    } else if (code === 10) {
      offset++; line++; column = 1;
    } else {
      // FormatJS offsets count UTF-16 units; AST columns count Unicode code points.
      column++;
      const next = source.charCodeAt(offset + 1);
      offset += code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
    }
  }
  literal();
  return elements;
}
