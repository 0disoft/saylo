import { TYPE } from '@formatjs/icu-messageformat-parser/no-parser.js';
import type { Location, LocationDetails, MessageFormatElement } from '@formatjs/icu-messageformat-parser';
import { freeze } from './diagnostics.js';

// Strict end of input: `$` alone would also accept a trailing newline.
const identifier = /^[A-Za-z_][A-Za-z0-9_]*(?![\s\S])/;

interface SimplePositionPool {
  position(offset: number, line: number, column: number): LocationDetails;
  location(start: LocationDetails, end: LocationDetails): Location;
}

/** One catalog parse owns this pool; only immutable relative positions escape. */
export function createSimplePositionPool(): SimplePositionPool {
  const positions = new Map<number | string, LocationDetails>();
  const locations = new Map<LocationDetails, Map<LocationDetails, Location>>();
  return { position(offset, line, column) {
    // Common single-line positions need no tuple string. Other positions must
    // retain all three coordinates, including Unicode columns and line breaks.
    const key = line === 1 && column === offset + 1 ? offset : `${offset}:${line}:${column}`;
    let position = positions.get(key);
    if (!position) {
      position = freeze({ offset, line, column });
      positions.set(key, position);
    }
    return position;
  }, location(start, end) {
    let ends = locations.get(start);
    if (!ends) { ends = new Map(); locations.set(start, ends); }
    let location = ends.get(end);
    if (!location) {
      location = freeze({ start, end });
      ends.set(end, location);
    }
    return location;
  } };
}

/** Narrow top-level fast path for Saylo's ignoreTag + captureLocation options.
 * Anything outside literal text and ASCII {name} arguments delegates to FormatJS.
 */
export function parseSimpleMessage(source: string,
  pool?: SimplePositionPool,
): MessageFormatElement[] | undefined {
  if (source.includes("'")) return undefined;
  const elements: MessageFormatElement[] = [];
  let offset = 0, line = 1, column = 1;
  let literalOffset = 0;
  const position = (): LocationDetails => pool?.position(offset, line, column) ?? { offset, line, column };
  const location = (start: LocationDetails, end: LocationDetails): Location => pool?.location(start, end) ?? { start, end };
  let literalStart = position();
  function literal() {
    if (offset !== literalOffset) elements.push({ type: TYPE.literal,
      value: source.slice(literalOffset, offset), location: location(literalStart, position()) });
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
      elements.push({ type: TYPE.argument, value: name, location: location(start, position()) });
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
