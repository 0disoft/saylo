/** Experiment only: compile parsed literal/argument ASTs; keep ICU and rich text on FormatJS. */
export function compileSimpleMessages(catalog) {
  const programs = new Map();
  let compiled = 0, fallback = 0;
  for (const message of Object.values(catalog.messages)) {
    if (message.richTextTags !== undefined || message.ast.some(node => node.type !== 0 && node.type !== 1)) {
      fallback++; continue;
    }
    const terms = message.ast.map(node => node.type === 0 ? JSON.stringify(node.value)
      : `String(values[${JSON.stringify(node.value)}])`);
    programs.set(message.source, `(values) => ${['""', ...terms].join(' + ')}`);
    compiled++;
  }
  return { compiled, fallback, source: `export const compiledMessages = new Map([\n${[...programs]
    .map(([source, render]) => `[${JSON.stringify(source)}, ${render}]`).join(',\n')}\n]);\n` };
}

export function injectSimpleFormatter(source) {
  const boundary = 'const text = (namespace, id, message, formatLocale, values, pseudoLocale) => {';
  if (source.split(boundary).length !== 2) throw new Error('Missing or ambiguous text formatter boundary; rebuild core.');
  return `import { compiledMessages } from './aot-programs.js';\n` + source.replace(boundary, `${boundary}
        if (!pseudoLocale && message.richTextTags === undefined) {
            const render = compiledMessages.get(message.source);
            if (render) return render(values);
        }`);
}
