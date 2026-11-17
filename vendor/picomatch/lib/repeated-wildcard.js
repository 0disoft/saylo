'use strict';

// Ignore literal stars in quotes, character classes and escape sequences.
module.exports = branch => {
  let escaped = false;
  let quoted = false;
  let bracket = false;
  for (const ch of branch) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"' && !bracket) { quoted = !quoted; continue; }
    if (quoted) continue;
    if (ch === '[') bracket = true;
    else if (ch === ']') bracket = false;
    else if (!bracket && ch === '*') return true;
  }
  return false;
};
