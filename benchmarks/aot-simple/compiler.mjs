import { encodeCatalog } from '@0disoft/saylo-core';

/** Experiment only: store source once and share location templates and render functions. */
export function compileSimpleMessages(catalog) {
  const wire = JSON.parse(JSON.stringify(encodeCatalog(catalog)));
  const templates = [], indices = new Map();
  let compiled = 0, fallback = 0;
  for (const row of wire.messages) {
    const message = catalog.messages[row[0]];
    if (message.richTextTags !== undefined || message.ast.some(node =>
      (node.type !== 0 && node.type !== 1) || !node.location ||
      (node.type === 0 && node.value !== message.source.slice(node.location.start.offset, node.location.end.offset)))) {
      fallback++; continue;
    }
    // Literal values can be recovered from source; arguments and locations are shared by shape.
    const nodes = row[5].map(node => [node[0], node[0] === 0 ? null : node[1], ...node.slice(2)]);
    const signature = JSON.stringify(nodes);
    let index = indices.get(signature);
    if (index === undefined) {
      index = templates.length; indices.set(signature, index);
      const terms = message.ast.map(node => node.type === 0
        ? `source.slice(${node.location.start.offset}, ${node.location.end.offset})`
        : `String(values[${JSON.stringify(node.value)}])`);
      templates.push(`{ nodes: ${signature}, render: (source, values) => ${['""', ...terms].join(' + ')} }`);
    }
    row[5] = index;
    compiled++;
  }
  return { compiled, fallback, templates: templates.length, source: `import { decodeCatalog } from './catalog-codec.js';
const templates = [${templates.join(',\n')}];
const wire = JSON.parse(${JSON.stringify(JSON.stringify(wire))});
export const compiledMessages = new Map();
for (const row of wire.messages) {
  if (typeof row[5] !== 'number') continue;
  const template = templates[row[5]];
  row[5] = template.nodes.map(node => [node[0], node[0] === 0 ? row[1].slice(node[2], node[5]) : node[1], ...node.slice(2)]);
  compiledMessages.set(row[1], template.render);
}
export const catalog = decodeCatalog(wire);
` };
}

export function injectSimpleFormatter(source) {
  const boundary = 'const text = (namespace, id, message, formatLocale, values, pseudoLocale) => {';
  if (source.split(boundary).length !== 2) throw new Error('Missing or ambiguous text formatter boundary; rebuild core.');
  return `import { compiledMessages } from './aot-programs.js';\n` + source.replace(boundary, `${boundary}
        if (!pseudoLocale && message.richTextTags === undefined) {
            const render = compiledMessages.get(message.source);
            if (render) return render(message.source, values);
        }`);
}
