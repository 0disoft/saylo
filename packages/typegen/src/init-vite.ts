import { parse } from '@babel/parser';

/** Patch only a static config object; never execute an application's config. */
export function connectVite(source: string): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'], attachComment: false });
  const imports = ast.program.body.filter(node => node.type === 'ImportDeclaration');
  const existing = imports.find(node => node.source.value === './saylo.vite.mjs');
  const defaults = ast.program.body.filter(node => node.type === 'ExportDefaultDeclaration');
  let config = defaults.length === 1 ? defaults[0]!.declaration : undefined;
  const defineConfig = new Set(imports.filter(node => node.source.value === 'vite').flatMap(node =>
    node.specifiers.flatMap(item => item.type === 'ImportSpecifier' && item.imported.type === 'Identifier'
      && item.imported.name === 'defineConfig' ? [item.local.name] : [])));
  if (config?.type === 'CallExpression' && config.callee.type === 'Identifier' && defineConfig.has(config.callee.name)
      && config.arguments.length === 1) config = config.arguments[0] as typeof config;
  if (config?.type === 'TSSatisfiesExpression') config = config.expression as typeof config;
  if (config?.type !== 'ObjectExpression' || config.properties.some(item => item.type === 'SpreadElement'))
    throw new Error('init supports export default { ... } or defineConfig({ ... }) without config spreads. Connect Saylo manually for dynamic configs.');
  const plugins = config.properties.filter(item => item.type !== 'SpreadElement' &&
    (item.computed || (item.key.type === 'Identifier' ? item.key.name : item.key.type === 'StringLiteral' ? item.key.value : '') === 'plugins'));
  if (plugins.length > 1 || (plugins[0] && (plugins[0].type !== 'ObjectProperty' || plugins[0].computed || plugins[0].value.type !== 'ArrayExpression')))
    throw new Error('init requires a single literal plugins array without computed config keys. Connect Saylo manually.');
  const array = plugins[0]?.type === 'ObjectProperty' && plugins[0].value.type === 'ArrayExpression' ? plugins[0].value : undefined;
  if (existing) {
    const local = existing.specifiers.find(item => item.type === 'ImportDefaultSpecifier')?.local.name;
    if (local && array?.elements.some(item => item?.type === 'Identifier' && item.name === local)) return source;
    throw new Error('Existing saylo.vite.mjs import is not connected to plugins. Resolve the config manually.');
  }
  if (imports.some(node => node.source.value === '@0disoft/saylo-vite'))
    throw new Error('Vite already imports Saylo. Keep the existing integration instead of running init.');
  let binding = '__sayloPlugin';
  while (source.includes(binding)) binding += '_';
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const insertion = array ? array.start! + 1 : config.start! + 1;
  const addition = array ? `${binding}, ` : `${newline}  plugins: [${binding}],`;
  const patched = source.slice(0, insertion) + addition + source.slice(insertion);
  const importEnd = ast.program.interpreter?.end ?? 0;
  const result = patched.slice(0, importEnd) + `${newline}import ${binding} from './saylo.vite.mjs';${newline}` + patched.slice(importEnd);
  parse(result, { sourceType: 'module', plugins: ['typescript'] });
  return result;
}
