import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createBaseSchema, parseCatalog } from '@0disoft/saylo-core';
import { assertSafePath } from './catalog-io.js';
import { resolveProjectConfig } from './config.js';
import { connectVite } from './init-vite.js';
import { renderTypes } from './render.js';
import { svelteKitFiles } from './init-sveltekit.js';
import { reactFiles } from './init-react.js';

export interface InitOptions { readonly framework?: 'vite' | 'sveltekit' | 'react' }

export interface InitChange { readonly file: string; readonly before: string | null; readonly after: string }
export interface InitPlan {
  readonly root: string;
  readonly changes: readonly InitChange[];
  readonly guards: readonly { readonly file: string; readonly source: string | null }[];
  readonly nextSteps: readonly string[];
}

export function readInitFile(root: string, file: string): string | null {
  const target = path.join(root, file);
  assertSafePath(root, target);
  try {
    if (!lstatSync(target).isFile()) throw new Error(`Expected a regular file: ${file}`);
    return readFileSync(target, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

/** Plan a bounded Vite integration, preserving all application and route code. */
export function planInit(directory: string, baseLocale = 'en', options: InitOptions = {}): InitPlan {
  const framework = options.framework ?? 'vite';
  if (!['vite', 'sveltekit', 'react'].includes(framework)) throw new TypeError('init framework must be vite, react or sveltekit.');
  const root = realpathSync(directory);
  const base = resolveProjectConfig({ localesDir: 'locales', baseLocale }, root).baseLocale;
  const packageSource = readInitFile(root, 'package.json');
  if (packageSource === null) throw new Error('init requires an existing Vite app with package.json.');
  const manifest = JSON.parse(packageSource) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; packageManager?: string };
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  if (!dependencies.vite) throw new Error('init requires Vite in dependencies or devDependencies.');
  if (framework === 'react' && (!dependencies.react || !dependencies['react-dom']))
    throw new Error('The react preset requires an existing React 19 client app with react and react-dom.');
  if (framework === 'sveltekit' && (!dependencies['@sveltejs/kit'] || !dependencies.svelte))
    throw new Error('The sveltekit preset requires an existing SvelteKit app with Svelte 5.');
  if (framework === 'sveltekit' && dependencies['@sveltejs/adapter-static'])
    throw new Error('The sveltekit SSR preset requires a server adapter, not adapter-static.');
  if (framework === 'sveltekit') {
    assertSafePath(root, path.join(root, 'src/routes'));
    if (!lstatSync(path.join(root, 'src/routes')).isDirectory()) throw new Error('The sveltekit preset requires standard src/routes.');
  }
  const configs = ['ts', 'mts', 'js', 'mjs', 'cts', 'cjs'].map(extension => `vite.config.${extension}`)
    .filter(file => readInitFile(root, file) !== null);
  if (configs.length !== 1 || /\.(?:cjs|cts)$/.test(configs[0]!)) throw new Error('init requires exactly one ESM vite.config.ts/mts/js/mjs.');
  const viteFile = configs[0]!;
  const viteSource = readInitFile(root, viteFile)!;
  assertSafePath(root, path.join(root, 'src'));
  if (!lstatSync(path.join(root, 'src')).isDirectory()) throw new Error('init requires the app source directory src/.');
  const changes: InitChange[] = [];
  const guards: InitPlan['guards'][number][] = [
    { file: 'package.json', source: packageSource }, { file: viteFile, source: viteSource },
  ];
  const add = (file: string, after: string) => {
    const before = readInitFile(root, file);
    guards.push({ file, source: before });
    if (before === after) return;
    if (before !== null) throw new Error(`init will not overwrite ${file}. Keep the existing integration or choose an empty integration path.`);
    changes.push({ file, before, after });
  };
  const catalog = JSON.stringify({ greeting: framework !== 'vite' && base.split('-')[0] === 'ko'
    ? '안녕하세요 {name}' : 'Hello {name}' }, null, 2) + '\n';
  const parsed = parseCatalog(catalog, { locale: base, namespace: 'saylo' });
  add('saylo.config.json', JSON.stringify({ format: 'saylo-project/v1', localesDir: 'locales', baseLocale: base,
    timeZone: 'UTC', typegen: { outFile: 'src/saylo/generated.d.ts' } }, null, 2) + '\n');
  add(`locales/${base}/saylo.json`, catalog);
  if (framework !== 'vite') {
    const alternate = base === 'en' ? 'ko' : 'en';
    add(`locales/${alternate}/saylo.json`, JSON.stringify({ greeting: alternate === 'ko' ? '안녕하세요 {name}' : 'Hello {name}' }, null, 2) + '\n');
  }
  add('saylo.vite.mjs', `import { fileURLToPath } from 'node:url';
import saylo, { loadProjectConfig } from '@0disoft/saylo-vite';

export default saylo(loadProjectConfig(fileURLToPath(new URL('./saylo.config.json', import.meta.url))));
`);
  if (framework === 'react') {
    for (const [file, source] of Object.entries(reactFiles(viteFile))) add(file, source);
  }
  add('src/saylo/generated.d.ts', renderTypes([createBaseSchema(parsed)]));
  add('src/saylo/env.d.ts', `/// <reference types="vite/client" />
/// <reference types="@0disoft/saylo-vite/virtual" />
`);
  if (framework === 'sveltekit') {
    for (const [file, source] of Object.entries(svelteKitFiles())) add(file, source);
  } else add('src/saylo/i18n.ts', `import { createStore } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';
import type { AppSchema } from './generated';

const active = new Set<() => void>();
if (import.meta.hot) import.meta.hot.dispose(() => { for (const dispose of active) dispose(); });

// Create one instance per app tree or SSR request, then dispose when its owner ends.
export function createAppI18n(locale = initialLocale) {
  const store = createStore<AppSchema>({ catalogs: initialCatalogs, baseLocale, locale, timeZone });
  const disconnect = !import.meta.env.SSR && import.meta.hot ? connectDev(store, { hot: import.meta.hot }) : undefined;
  const dispose = () => { disconnect?.(); store.dispose(); active.delete(dispose); };
  if (!import.meta.env.SSR && import.meta.hot) active.add(dispose);
  return { store, dispose };
}
`);
  const patched = connectVite(viteSource);
  if (patched !== viteSource) changes.push({ file: viteFile, before: viteSource, after: patched });
  const managers = ['bun', 'pnpm', 'yarn', 'npm'] as const;
  const locks = ['bun.lock', 'bun.lockb', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];
  const packageManager = manifest.packageManager?.split('@')[0];
  const detected = locks.flatMap((file, index) => readInitFile(root, file) === null ? [] : [index < 2 ? 'bun' : index === 2 ? 'pnpm' : index === 3 ? 'yarn' : 'npm']);
  const manager = managers.includes(packageManager as typeof managers[number]) ? packageManager! : [...new Set(detected)].length === 1 ? detected[0]! : 'npm';
  const install = manager === 'npm' ? 'npm install' : `${manager} add`;
  return { root, changes, guards, nextSteps: [
    `${install} @0disoft/saylo-core@alpha${framework === 'sveltekit' ? ' @0disoft/saylo-svelte@alpha' : framework === 'react' ? ' @0disoft/saylo-react@alpha' : ''}`,
    `${install} -D @0disoft/saylo-vite@alpha @0disoft/saylo-typegen@alpha`,
    ...(framework === 'sveltekit' ? [
      'Open /saylo after starting the dev server. The isolated route includes request-local SSR, hydration, language selection and an HTTP-only locale cookie.',
      'Edit locales/<locale>/saylo.json while the demo input and dialog are open. Existing routes and hooks are unchanged.',
    ] : framework === 'react' ? ['Open /saylo.html on the dev server; the isolated React demo has a provider, language selector and browser persistence.',
      'Build the isolated demo with vite build --config saylo.demo.config.mjs; output is dist-saylo-demo/.',
      'For your application, use SayloProvider/useI18n from src/saylo/react.tsx and createAppI18n from src/saylo/i18n.ts; the app owner disposes its instance.'] : ['Create createAppI18n() from src/saylo/i18n.ts in your app owner; subscribe to store changes and call dispose() when unmounting. For SSR, create and dispose one instance per request.',
      "Try store.getSnapshot().t('saylo:greeting', { name: 'Saylo' })."]),
    'Run your existing dev/build commands. No route, provider, URL, or SEO code was rewritten.',
  ] };
}
