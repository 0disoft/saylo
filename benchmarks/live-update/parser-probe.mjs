import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';

export const parserMetrics = ['jsonMs', 'strictJsonMs', 'tokenScanMs', 'positionIndexMs', 'messageCopyMs', 'messageLoopMs', 'freezeMs'];
export const messageFreezeMetrics = ['messagePositionMs', 'messageAstFreezeMs', 'messageRecordFreezeMs'];
export const parserDetailMetrics = ['astMs', 'argumentsMs', 'argumentFreezeMs', 'messageFreezeMs', ...messageFreezeMetrics, 'reusedMessageFreezeMs'];
let current;
export function measureParserStage(metric, work) {
  const sample = current;
  if (!sample) return work();
  const start = performance.now();
  try { return work(); }
  finally { sample[metric] += performance.now() - start; sample.calls[metric]++; }
}
// Construct inputs before starting the clock; recursion creates no timers.
export function measureParserFreeze(metric, freeze, value) {
  const sample = current;
  if (!sample) return freeze(value);
  const start = performance.now();
  try { return freeze(value); }
  finally { sample[metric] += performance.now() - start; sample.calls[metric]++; }
}
export function parserClock() { return performance.now(); }
export function recordParserStage(metric, start) {
  if (current) { current[metric] += performance.now() - start; current.calls[metric]++; }
}
export function beginParserSample(detailed = false) {
  const metrics = detailed ? [...parserMetrics, ...parserDetailMetrics] : parserMetrics;
  current = { ...Object.fromEntries(metrics.map(metric => [metric, 0])), calls: Object.fromEntries(metrics.map(metric => [metric, 0])) };
}
export function finishParserSample() { const sample = current; current = undefined; return sample; }

export function registerParserProbe({ detailed = false } = {}) {
  const catalog = new URL('../../packages/core/dist/catalog.js', import.meta.url).href;
  const json = new URL('../../packages/core/dist/json.js', import.meta.url).href;
  const schema = new URL('../../packages/core/dist/schema.js', import.meta.url).href;
  const transformed = new Set();
  const hooks = registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== catalog && url !== json && (!detailed || url !== schema)) return loaded;
    let source = String(loaded.source).replaceAll('\r\n', '\n');
    const changes = url === catalog ? [
      ['const edited = samePolicy ? readCatalogEdit(source, context, previous) : undefined;', 'const __jsonStart = parserClock();\nconst edited = samePolicy ? readCatalogEdit(source, context, previous) : undefined;'],
      ['const entries = edited ? [edited.entry] : readCatalogJson(source, context, previous);', "const entries = edited ? [edited.entry] : readCatalogJson(source, context, previous);\nrecordParserStage('jsonMs', __jsonStart);"],
      ['const positionAt = catalogPositionLocator(source, edited && previous.messages[edited.entry.id].position);', "const positionAt = measureParserStage('positionIndexMs', () => catalogPositionLocator(source, edited && previous.messages[edited.entry.id].position));"],
      ['const messages = Object.create(null);', 'const __copyStart = parserClock();\nconst messages = Object.create(null);'],
      ['const locale = new Intl.Locale(context.locale);', "recordParserStage('messageCopyMs', __copyStart);\nconst locale = new Intl.Locale(context.locale);"],
      ['for (const entry of entries) {', 'const __loopStart = parserClock();\nfor (const entry of entries) {'],
      ['if (diagnostics.length)', "recordParserStage('messageLoopMs', __loopStart);\nif (diagnostics.length)"],
      ['const catalog = freeze({ ...context, messages: freezeOwnedMessageMap(messages) });', "const catalog = measureParserStage('freezeMs', () => freeze({ ...context, messages: freezeOwnedMessageMap(messages) }));"],
    ] : url === json ? [
      ['object = JSON.parse(source);', "object = measureParserStage('strictJsonMs', () => JSON.parse(source));"],
      ['const entries = [];', 'const __tokensStart = parserClock();\nconst entries = [];'],
      ['if (diagnostics.length)', "recordParserStage('tokenScanMs', __tokensStart);\nif (diagnostics.length)"],
    ] : [
      ['schema = freeze(record);', "schema = measureParserFreeze('argumentFreezeMs', freeze, record);"],
      ['const frozenSchema = freeze(schema);', "const frozenSchema = measureParserFreeze('argumentFreezeMs', freeze, schema);"],
    ];
    if (detailed && url === catalog) changes.push(
      ['const ast = parseSimpleMessage(entry.value, simplePosition) ?? parse(entry.value, { ignoreTag: true, captureLocation: true, requiresOtherClause: true, locale });',
        "const __astStart = parserClock();\nconst ast = parseSimpleMessage(entry.value, simplePosition) ?? parse(entry.value, { ignoreTag: true, captureLocation: true, requiresOtherClause: true, locale });\nrecordParserStage('astMs', __astStart);"],
      ['const argumentsSchema = inferArguments(ast,', 'const __argumentsStart = parserClock();\nconst argumentsSchema = inferArguments(ast,'],
      ['const position = positionAt(entry.valueOffset);\n            if (tags !== undefined)',
        "recordParserStage('argumentsMs', __argumentsStart);\nconst __messageFreezeStart = parserClock();\nconst position = measureParserStage('messagePositionMs', () => positionAt(entry.valueOffset));\n            if (tags !== undefined)"],
      ['messages[entry.id] = freeze({ source: entry.value, position, ast: freezeMessageAst(ast), arguments: argumentsSchema,',
        "messages[entry.id] = measureParserFreeze('messageRecordFreezeMs', freeze, { source: entry.value, position, ast: measureParserFreeze('messageAstFreezeMs', freezeMessageAst, ast), arguments: argumentsSchema,"],
      ['...(tags === undefined ? {} : { richTextTags: tags }) });',
        "...(tags === undefined ? {} : { richTextTags: tags }) });\nrecordParserStage('messageFreezeMs', __messageFreezeStart);"],
      ['? before : freeze({ ...before, position });', "? before : measureParserFreeze('reusedMessageFreezeMs', freeze, { ...before, position });"],
    );
    for (const [before, after] of changes) {
      if (source.split(before).length !== 2) throw new Error(`Missing or ambiguous parser probe boundary: ${before}`);
      source = source.replace(before, after);
    }
    transformed.add(url);
    return { ...loaded, source: `import { measureParserStage, measureParserFreeze, parserClock, recordParserStage } from '${import.meta.url}';\n${source}` };
  } });
  return { assertTransformed() { if (transformed.size !== (detailed ? 3 : 2)) throw new Error('Incomplete parser transforms.'); },
    dispose() { hooks.deregister(); current = undefined; } };
}
