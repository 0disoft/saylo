# 빈 폴더에서 SvelteKit으로 Saylo 시작하기

Saylo 저장소를 clone하지 않고 npm registry만으로 SvelteKit 3 + Svelte 5 앱에 Saylo를 붙인다. 빈 폴더에 파일 19개를 만들고 설치하면 로케일 JSON을 고치는 즉시 문구가 바뀐다. 파일 편집과 빈 카탈로그 복구 중 폼과 확인 창의 입력·포커스를 유지한다. 이 문서는 게시본 alpha의 공개 API만 쓴다. 로컬 미게시 API(`onSyncState`, 문의용 진단 보고서)는 쓰지 않는다.

## 전제

- Node.js 24.x와 npm이 필요하다. 게시 패키지의 `engines.node`는 `24.x`다.
- Saylo 패키지는 npm public registry에 있다. Saylo 저장소는 private이지만 clone, GitHub 로그인, `file:`·`workspace:` 링크가 필요 없다.
- `latest`는 placeholder라 설치할 때 `@alpha`를 붙인다. 대조한 게시본은 `0.1.0-alpha.4`다.
- 도구는 메이저 범위만 적는다. SvelteKit 3, Svelte 5, `@sveltejs/vite-plugin-svelte` 7, `@sveltejs/adapter-node` 6, TypeScript 6, `svelte-check` 4, `@types/node` 24, Vite 8이다.
- `svelte-check` 4가 받는 TypeScript는 5와 6뿐이라 지금은 6에서 멈춘다.

## 파일 19개

### package.json

```json
{
  "name": "saylo-sveltekit-starter",
  "private": true,
  "type": "module",
  "engines": {
    "node": "24.x"
  },
  "imports": {
    "#lib/*": "./src/lib/*"
  },
  "scripts": {
    "typegen": "saylo-typegen --locales-dir locales --base-locale ko --out-file src/lib/generated.d.ts",
    "check": "npm run typegen && svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "dev": "vite --host 127.0.0.1 --port 5197 --strictPort",
    "build": "npm run check && vite build",
    "preview": "vite preview --host 127.0.0.1 --port 5198 --strictPort",
    "verify:ssr": "node verify-ssr.mjs"
  },
  "dependencies": {
    "@0disoft/saylo-core": "alpha",
    "@0disoft/saylo-svelte": "alpha",
    "svelte": "5"
  },
  "devDependencies": {
    "@0disoft/saylo-typegen": "alpha",
    "@0disoft/saylo-vite": "alpha",
    "@sveltejs/adapter-node": "6",
    "@sveltejs/kit": "3",
    "@sveltejs/vite-plugin-svelte": "7",
    "@types/node": "24",
    "svelte-check": "4",
    "typescript": "6",
    "vite": "8"
  }
}
```

### vite.config.mjs

```js
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import saylo from '@0disoft/saylo-vite';

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() }), saylo({
    localesDir: 'locales', baseLocale: 'ko', initialNamespaces: ['demo'], timeZone: 'UTC',
    typegen: { outFile: 'src/lib/generated.d.ts' },
  })],
});
```

### tsconfig.json

```json
{
  "extends": "$app/tsconfig",
  "compilerOptions": {
    "strict": true,
    "allowJs": true,
    "checkJs": true,
    "types": ["$app/types", "node", "vite/client", "@0disoft/saylo-vite/virtual"]
  },
  "include": ["src", "vite.config.mjs"],
  "exclude": ["node_modules", "build"]
}
```

### src/app.d.ts

```ts
declare global {
  namespace App {
    interface Locals { locale: string }
  }
}
export {};
```

### src/app.html

```html
<!doctype html>
<html lang="%saylo.lang%">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body><div style="display: contents">%sveltekit.body%</div></body>
</html>
```

### src/hooks.server.ts

```ts
import type { Handle } from '@sveltejs/kit/hooks';
import { catalogSource } from 'virtual:saylo/server';

/** Query locale belongs to this request. Unknown/malformed tags use the base locale. */
export const handle: Handle = async ({ event, resolve }) => {
  const manifest = catalogSource.readManifest();
  let locale = manifest.baseLocale;
  try {
    const candidate = Intl.getCanonicalLocales(event.url.searchParams.get('locale') ?? locale)[0];
    if (candidate && manifest.availableLocales.includes(candidate)) locale = candidate;
  } catch { /* Invalid query locale uses the base locale. */ }
  event.locals.locale = locale;
  return resolve(event, { transformPageChunk: ({ html }) => html.replace('%saylo.lang%', locale) });
};
```

### src/lib/i18n.ts

```ts
import { createI18n } from '@0disoft/saylo-core';
import type { BootSnapshot, CatalogSource } from '@0disoft/saylo-core';
import { createSayloSvelte } from '@0disoft/saylo-svelte';
import type { AppSchema } from './generated';

// Only the typed context key is shared. Every layout creates its own instance.
export const { setSayloContext, getI18n } = createSayloSvelte<AppSchema>();

export function createBootInstance(boot: BootSnapshot) {
  let source: CatalogSource = {
    readManifest: () => boot.manifest,
    loadCatalog: async (locale, namespace) => boot.catalogOutcomes.find(outcome =>
      outcome.key.locale === locale && outcome.key.namespace === namespace)
      ?? { status: 'failed', code: 'SSR_SCOPE', message: 'Catalog is outside the prepared SSR scope.' },
  };
  const proxy: CatalogSource = {
    readManifest: () => source.readManifest(),
    loadCatalog: (locale, namespace, signal) => source.loadCatalog(locale, namespace, signal),
  };
  const instance = createI18n<AppSchema>({ catalogSource: proxy, initialSnapshot: boot });
  return { instance, attachSource: (next: CatalogSource) => { source = next; } };
}
```

### src/lib/client-connection.ts

```ts
import { connectDev, createDevCatalogSource } from '@0disoft/saylo-vite/client';
import type { LiveDiagnostic } from '@0disoft/saylo-vite/client';
import type { BootSnapshot, CatalogSource, I18n } from '@0disoft/saylo-core';
import type { AppSchema } from './generated';

export function connectBootClient(options: {
  boot: BootSnapshot;
  instance: I18n<AppSchema>;
  attachSource: (source: CatalogSource) => void;
  hot?: NonNullable<ImportMeta['hot']>;
  onDiagnostic?: (value: LiveDiagnostic) => void;
}) {
  let active = true;
  let disconnect: (() => void) | undefined;
  // Each dev layout owns a source seeded from its fresh request boot, even after re-entry.
  const owned = options.hot ? createDevCatalogSource(options.boot.manifest, options.boot.catalogOutcomes, { hot: options.hot }) : undefined;
  const source = owned ? Promise.resolve(owned) : import('virtual:saylo/lazy').then(module => module.catalogSource);
  const ready = source.then(async catalogSource => {
    if (!active) return false;
    options.attachSource(catalogSource);
    disconnect = connectDev(options.instance, { catalogSource,
      ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}) });
    await options.instance.refresh();
    return active;
  });
  const stop = () => {
    if (!active) return;
    active = false;
    try { disconnect?.(); } finally { owned?.dispose(); }
  };
  return { ready, stop };
}
```

### src/lib/demo-messages.ts

```ts
import { getContext, setContext } from 'svelte';
import type { StoreSnapshot } from '@0disoft/saylo-core';
import type { AppSchema } from './generated';

function read(snapshot: StoreSnapshot<AppSchema>) {
  const { t } = snapshot;
  // Project the complete shared view before any component renders a label.
  return {
    home: t('demo:home'), about: t('demo:about'), heading: t('demo:heading'), description: t('demo:description'),
    aboutHeading: t('demo:aboutHeading'), aboutBody: t('demo:aboutBody'), formTitle: t('demo:formTitle'),
    name: t('demo:name'), note: t('demo:note'), openDialog: t('demo:openDialog'),
    dialogTitle: t('demo:dialogTitle'), dialogNote: t('demo:dialogNote'), closeDialog: t('demo:closeDialog'),
  };
}

export type DemoMessages = ReturnType<typeof read>;

export function projectDemoMessages(snapshot: StoreSnapshot<AppSchema>, previous: StoreSnapshot<AppSchema> | undefined) {
  try { return { messages: read(snapshot), accepted: snapshot, error: '' }; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let messages: DemoMessages = {
      home: '미리보기', about: '연결 설명', heading: '번역을 준비하세요.',
      description: '기준 로케일의 demo.json에 필요한 키와 인자를 채우고 저장하세요.',
      aboutHeading: '번역을 준비하세요.', aboutBody: '번역 파일을 수정하고 저장하면 이 화면도 복구됩니다.',
      formTitle: '입력 미리보기', name: '이름', note: '메모', openDialog: '확인 창 열기',
      dialogTitle: '입력 확인', dialogNote: '확인 메모', closeDialog: '닫기',
    };
    if (previous) { try { messages = read(previous); } catch { /* Keep the explicit setup view. */ } }
    return { messages, accepted: undefined,
      error: `${message}\n로케일 파일의 키·인자를 확인하고 다시 저장하세요. 입력은 유지됩니다.` };
  }
}

// The key is shared; the getter and last-good snapshot belong to one layout/request.
const key = Symbol('Saylo demo presentation');
type DemoView = { readonly current: ReturnType<typeof projectDemoMessages> };
export const setDemoView = (view: DemoView) => setContext(key, view);
export const getDemoView = () => getContext<DemoView>(key);
```

layout이 필요한 문구를 모두 계산해 페이지와 입력 화면에 공유한다. 마지막 정상 snapshot과 context 값은 layout마다 따로 보관한다. 새 SSR 요청에는 이전 요청의 번역을 재사용하지 않는다.

### src/lib/Workbench.svelte

```svelte
<script lang="ts">
  import { getI18n } from './i18n';
  import type { DemoMessages } from './demo-messages';
  let { connection = '', details = '', messages, renderError = '' }: {
    connection?: string; details?: string; messages: DemoMessages; renderError?: string;
  } = $props();
  const i18n = getI18n();
  let name = $state('');
  let note = $state('');
  let confirmation = $state('');
  let open = $state(false);
  let dialog = $state<HTMLDialogElement>();
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });
</script>

<section class="panel preview">
  <div class="panel-header"><h2>{messages.formTitle}</h2><span id="revision" class="badge">revision {$i18n.stateRevision}</span></div>
  <form onsubmit={event => { event.preventDefault(); open = true; }}>
    <label>{messages.name}<input id="name" autocomplete="off" bind:value={name} /></label>
    <label>{messages.note}<textarea id="note" rows="3" bind:value={note}></textarea></label>
    <button id="open-dialog" type="submit">{messages.openDialog}</button>
  </form>
</section>
<dialog id="confirmation" aria-labelledby="dialog-title" bind:this={dialog} onclose={() => { open = false; }}>
  <form method="dialog">
    <h2 id="dialog-title">{messages.dialogTitle}</h2>
    <label>{messages.dialogNote}<input id="confirmation-note" autocomplete="off" bind:value={confirmation} /></label>
    <button id="close-dialog">{messages.closeDialog}</button>
    <a id="dialog-about" href="/about?locale={$i18n.locale}">{messages.about}</a>
    <p id="dialog-render-error" class="hint" role="alert">{renderError}</p>
    <p id="dialog-status" class="hint" role="status">{connection}{details && `\n${details}`}</p>
  </form>
</dialog>
```

### src/lib/style.css

```css
:root { font-family: system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #213532; background: #f4f6f3; font-synthesis: none; }
* { box-sizing: border-box; }
body { margin: 0; }
main { max-width: 1120px; margin: auto; padding: 28px 32px 56px; }
header, .panel-header, .actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.brand { color: #1c4941; font-size: 26px; font-weight: 750; text-decoration: none; }
.brand span { font-size: 13px; font-weight: 400; color: #657773; margin-left: 12px; }
.locale-control { display: flex; align-items: center; gap: 12px; font-size: 13px; }
.intro { padding: 48px 0 32px; }
.eyebrow { font-size: 11px; letter-spacing: .16em; font-weight: 700; color: #4b776c; }
h1 { font-size: clamp(27px, 3vw, 40px); letter-spacing: -.045em; margin: 10px 0 14px; }
.intro > p:last-child { color: #657773; max-width: 700px; line-height: 1.7; }
h2 { font-size: 18px; margin: 0; }
.layout { display: grid; grid-template-columns: 1fr 1.2fr; gap: 24px; align-items: start; }
.panel { background: #fff; border-radius: 16px; padding: 26px; box-shadow: 0 4px 24px #21353206; }
.panel-header { margin-bottom: 24px; }
.badge { color: #526a61; background: #edf3ec; font-size: 11px; padding: 6px 10px; border-radius: 20px; white-space: nowrap; }
label { display: grid; gap: 9px; font-size: 13px; font-weight: 550; }
form > label, .editor > label { margin-bottom: 22px; }
input, textarea, select { font: inherit; background: #fcfdfb; color: #213532; border: 1px solid #dce4db; border-radius: 8px; padding: 11px 12px; width: 100%; }
textarea { resize: vertical; line-height: 1.6; }
input:focus, textarea:focus, select:focus { outline: 2px solid #8bbbad; outline-offset: 2px; }
select { width: auto; background: #fff; }
input::placeholder, textarea::placeholder { color: #89968e; }
#count { max-width: 100px; }
.summary { min-height: 44px; padding: 12px 14px; border-radius: 8px; background: #f0f5ee; font-size: 14px; }
button { cursor: pointer; font: inherit; font-size: 13px; font-weight: 650; background: #255b4e; color: #fff; border: 0; border-radius: 8px; padding: 12px 18px; }
button:hover { background: #1b483d; }
button:focus-visible { outline: 3px solid #8bbbad; outline-offset: 3px; }
.secondary { color: #476659; background: #edf3ec; }
.secondary:hover { background: #e0ebde; }
.hint, .footnote { color: #738177; font-size: 12px; line-height: 1.75; }
.editor > .hint { margin-bottom: 20px; }
.code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; tab-size: 2; }
.actions { justify-content: flex-start; }
kbd { font-family: inherit; background: #f0f3ee; border-radius: 4px; padding: 2px 5px; }
#error:empty { display: none; }
#error { white-space: pre-wrap; overflow-wrap: anywhere; color: #9b3c32; background: #fff5f1; font: 12px/1.7 system-ui; padding: 12px; border-radius: 8px; }
dialog { border: 0; border-radius: 16px; padding: 30px; color: #213532; width: min(450px, calc(100% - 32px)); }
dialog::backdrop { background: #18393055; }
dialog h2 { margin-bottom: 24px; }
dialog .hint { margin-bottom: 0; }
@media (max-width: 760px) { main { padding: 20px 18px 36px; } .layout { grid-template-columns: 1fr; } .panel { padding: 22px; } .intro { padding-top: 32px; } .brand span { display: none; } .locale-control { gap: 8px; } }
.demo-nav { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }
.demo-nav a[aria-current="page"] { font-weight: 700; }
dialog a { display: block; margin-top: 1rem; }
```

### src/routes/(saylo)/+layout.server.ts

```ts
import { serializeBootSnapshot } from '@0disoft/saylo-core';
import { createRequestI18n } from 'virtual:saylo/server';
import type { LayoutServerLoad } from './$types';
import type { AppSchema } from '#lib/generated.d.ts';

export const load: LayoutServerLoad = async ({ locals, url, setHeaders }) => {
  // SvelteKit must rerun this layout load when the URL locale changes during navigation.
  url.searchParams.get('locale');
  setHeaders({ 'cache-control': 'no-store' });
  const instance = await createRequestI18n<AppSchema>({ locale: locals.locale });
  try { return { sayloBoot: serializeBootSnapshot(instance.getBootSnapshot()) }; }
  finally { instance.dispose(); }
};
```

### src/routes/(saylo)/+layout.svelte

```svelte
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { decodeBootSnapshot } from '@0disoft/saylo-core';
  import type { StoreSnapshot } from '@0disoft/saylo-core';
  import type { AppSchema } from '#lib/generated.d.ts';
  import type { LiveDiagnostic } from '@0disoft/saylo-vite/client';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { LayoutProps } from './$types';
  import { createBootInstance, setSayloContext } from '#lib/i18n.ts';
  import { connectBootClient } from '#lib/client-connection.ts';
  import Workbench from '#lib/Workbench.svelte';
  import { projectDemoMessages, setDemoView } from '#lib/demo-messages.ts';
  import '#lib/style.css';

  let { data, children }: LayoutProps = $props();
  const boot = untrack(() => decodeBootSnapshot(data.sayloBoot));
  const { instance, attachSource } = createBootInstance(boot);
  const i18n = setSayloContext(instance);
  const lastRendered: { current: StoreSnapshot<AppSchema> | undefined } = { current: undefined };
  const presentation = $derived(projectDemoMessages($i18n, lastRendered.current));
  const text = $derived(presentation.messages);
  setDemoView({ get current() { return presentation; } });
  $effect(() => { if (presentation.accepted) lastRendered.current = presentation.accepted; });
  let ready = $state(false);
  let diagnostic = $state<LiveDiagnostic>({ message: '', diagnostics: [] });
  const details = $derived(diagnostic.diagnostics.length
    ? diagnostic.diagnostics.map(value => `${value.sourceName}: ${value.message}`).join('\n') : diagnostic.message);
  let pendingLocale = $state<string>();
  let transitionError = $state('');
  let navigationGeneration = 0;
  let routeGeneration = 0;

  async function selectLocale(locale: string) {
    const generation = ++navigationGeneration;
    pendingLocale = locale;
    transitionError = '';
    const url = new URL(page.url.href);
    url.searchParams.set('locale', locale);
    try { await goto(url, { reset: false, refreshAll: true }); }
    catch (error) {
      if (generation === navigationGeneration) {
        pendingLocale = undefined;
        transitionError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  onMount(() => {
    let active = true;
    const connection = connectBootClient({ boot, instance, attachSource, hot: import.meta.hot,
      onDiagnostic: value => { diagnostic = value; } });
    void connection.ready.then(connected => {
      if (active && connected) ready = true;
    }).catch(error => {
      if (active) diagnostic = { message: error instanceof Error ? error.message : String(error), diagnostics: [] };
    });
    return () => { active = false; connection.stop(); };
  });
  onDestroy(() => instance.dispose());
  $effect(() => { document.documentElement.lang = $i18n.locale; });
  $effect(() => {
    if (!ready) return;
    const locale = decodeBootSnapshot(data.sayloBoot).locale;
    const generation = ++routeGeneration;
    pendingLocale = locale === instance.getSnapshot().locale ? undefined : locale;
    transitionError = '';
    void instance.setLocale(locale).then(() => {
      if (generation === routeGeneration) pendingLocale = undefined;
    }).catch(error => {
      if (generation === routeGeneration) {
        pendingLocale = undefined;
        transitionError = error instanceof Error ? error.message : String(error);
      }
    });
  });
</script>

<svelte:head><title>Saylo · SvelteKit SSR demo</title></svelte:head>
<main data-ready={ready} id="saylo-layout">
  <header>
    <a class="brand" href="/?locale={$i18n.locale}">Saylo <span>SvelteKit 3 · SSR</span></a>
    <label class="locale-control">화면 언어
      <select id="locale" value={pendingLocale ?? $i18n.locale} onchange={event => { void selectLocale(event.currentTarget.value); }}>
        {#each $i18n.availableLocales as locale (locale)}
          <option value={locale}>{locale === 'ko' ? '한국어' : locale === 'en' ? 'English' : locale}</option>
        {/each}
      </select>
    </label>
  </header>
  <nav class="demo-nav" aria-label="예제 페이지">
    <a id="home-link" href="/?locale={$i18n.locale}" aria-current={page.url.pathname === '/' ? 'page' : undefined}>{text.home}</a>
    <a id="about-link" href="/about?locale={$i18n.locale}" aria-current={page.url.pathname === '/about' ? 'page' : undefined}>{text.about}</a>
    <a id="leave-link" href="/plain?locale={$i18n.locale}">번역 화면 나가기</a>
  </nav>
  <p id="transition-error" role="alert">{transitionError}</p>
  <p id="render-error" class="hint" role="alert">{presentation.error}</p>
  {@render children()}
  <Workbench messages={text} renderError={presentation.error} {details} />
  <p id="status" class="hint" role="status">{diagnostic.message ? '번역 연결을 확인해 주세요.'
    : ready ? import.meta.hot ? '번역 파일을 저장하면 화면에 반영됩니다.' : '빌드된 번역을 사용합니다.'
    : '서버에서 준비한 번역을 표시합니다.'}</p>
  <pre id="error" role="alert">{diagnostic.diagnostics.length
    ? diagnostic.diagnostics.map(value => `${value.sourceName}: ${value.message}`).join('\n') : diagnostic.message}</pre>
</main>
```

### src/routes/(saylo)/+page.svelte

```svelte
<script lang="ts">
  import { getDemoView } from '#lib/demo-messages.ts';
  const view = getDemoView();
  const text = $derived(view.current.messages);
</script>

<section class="intro">
  <p class="eyebrow">SVELTEKIT LIVE CATALOG PREVIEW</p>
  <h1>{text.heading}</h1>
  <p>{text.description}</p>
  <p class="hint">입력과 확인 창은 공통 layout에 두어 페이지를 이동해도 유지합니다.</p>
</section>
```

### src/routes/(saylo)/about/+page.svelte

```svelte
<script lang="ts">
  import { getDemoView } from '#lib/demo-messages.ts';
  const view = getDemoView();
  const text = $derived(view.current.messages);
</script>

<section class="intro">
  <p class="eyebrow">SHARED LAYOUT</p>
  <h1>{text.aboutHeading}</h1>
  <p>{text.aboutBody}</p>
</section>
```

### src/routes/plain/+page.svelte

```svelte
<script lang="ts">
  import { page } from '$app/state';
  let locale = $derived(page.url.searchParams.get('locale') ?? 'ko');
</script>

<svelte:head><title>Saylo · layout 종료</title></svelte:head>
<main id="plain-page" lang="ko">
  <h1>번역 화면을 나왔습니다.</h1>
  <p>이 페이지는 Saylo context를 사용하지 않습니다. 이전 번역 layout의 연결과 instance는 해제됩니다.</p>
  <a id="return-link" href="/?locale={encodeURIComponent(locale)}">번역 화면으로 돌아가기</a>
</main>
```

### locales/ko/demo.json

```json
{
  "heading": "번역을 바꿔도, 입력은 그대로",
  "description": "폼에 입력하고 확인 창을 열어 둔 채 번역 파일을 수정하고 저장해 보세요.",
  "formTitle": "주문 미리보기",
  "name": "이름",
  "namePlaceholder": "받으실 분의 이름",
  "note": "요청 사항",
  "notePlaceholder": "문 앞에 놓아 주세요",
  "count": "상품 수",
  "summary": "{count, plural, other {상품 #개}}",
  "openDialog": "확인 창 열기",
  "dialogTitle": "입력한 내용을 확인해 주세요",
  "dialogNote": "확인 메모",
  "closeDialog": "닫기",
  "home": "미리보기",
  "about": "연결 설명",
  "aboutHeading": "페이지를 이동해도, 입력은 그대로",
  "aboutBody": "같은 layout에서 번역 instance를 공유하며 페이지 내용만 바꿉니다."
}
```

### locales/en/demo.json

```json
{
  "heading": "New words. Same input.",
  "description": "Save the translation file while keeping your form and confirmation open.",
  "formTitle": "Order preview",
  "name": "Name",
  "namePlaceholder": "Recipient's name",
  "note": "Delivery note",
  "notePlaceholder": "Please leave it by the door",
  "count": "Items",
  "summary": "{count, plural, one {# item} other {# items}}",
  "openDialog": "Open confirmation",
  "dialogTitle": "Review your input",
  "dialogNote": "Confirmation note",
  "closeDialog": "Close",
  "home": "Preview",
  "about": "How it works",
  "aboutHeading": "New page. Same input.",
  "aboutBody": "Pages share one translation instance through their common layout."
}
```

### verify-ssr.mjs

```js
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { decodeBootSnapshot } from '@0disoft/saylo-core';

// Keep the HTTP probe separate from SvelteKit's development SSR fetch wrapper.
const requestFetch = globalThis.fetch.bind(globalThis);
let server;
try {
  let origin = process.argv[2];
  if (!origin) {
    const root = fileURLToPath(new URL('.', import.meta.url));
    process.chdir(root);
    server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
    await server.listen();
    const address = server.httpServer.address();
    origin = `http://127.0.0.1:${address.port}`;
  }
  origin = new URL(origin).origin;
  const request = async (query, expected) => {
    const response = await requestFetch(`${origin}/?locale=${encodeURIComponent(query)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const html = await response.text();
    assert.ok(html.includes(`<html lang="${expected}">`));
    assert.ok(html.includes(expected === 'en' ? 'New words. Same input.' : '번역을 바꿔도, 입력은 그대로'));
    const dataResponse = await requestFetch(`${origin}/__data.json?locale=${encodeURIComponent(query)}`);
    assert.equal(dataResponse.status, 200);
    const data = await dataResponse.json();
    const layout = data.nodes.find(node => node?.type === 'data' && node.data?.[0]?.sayloBoot !== undefined);
    assert.ok(layout, 'Layout boot data missing');
    const boot = decodeBootSnapshot(layout.data[layout.data[0].sayloBoot]);
    assert.equal(boot.locale, expected);
    assert.equal(boot.timeZone, 'UTC');
    assert.deepEqual(boot.loadedNamespaces, ['demo']);
  };
  const concurrent = await Promise.allSettled([request('ko', 'ko'), request('en', 'en'), request('en', 'en'), request('ko', 'ko')]);
  for (const result of concurrent) if (result.status === 'rejected') throw result.reason;
  await request('EN', 'en');
  await request('en_US', 'ko');
  await request('fr', 'ko');
  console.log('[sveltekit] Concurrent ko/en SSR, matching boot data, canonical locale and base fallback passed.');
  if (server) {
    const { createRequestI18n } = await server.ssrLoadModule('virtual:saylo/server');
    const prepared = await createRequestI18n({ locale: 'en' });
    let boot;
    try { boot = prepared.getBootSnapshot(); } finally { prepared.dispose(); }
    const { createBootInstance } = await server.ssrLoadModule('/src/lib/i18n.ts');
    const { connectBootClient } = await server.ssrLoadModule('/src/lib/client-connection.ts');
    const listeners = new Map();
    const hot = {
      on(event, callback) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
      off(event, callback) { listeners.get(event)?.delete(callback); },
      send() {}, dispose() {}, prune() {},
    };
    const count = () => [...listeners.values()].reduce((sum, values) => sum + values.size, 0);
    const current = createBootInstance(boot);
    let connection;
    try {
      connection = connectBootClient({ boot, ...current, hot });
      assert.equal(await connection.ready, true);
      assert.ok(count() > 0, 'Live source did not register listeners');
      connection.stop(); connection.stop();
      assert.equal(count(), 0, 'Owned listeners survived layout cleanup');
    } finally { connection?.stop(); current.instance.dispose(); }
    const late = createBootInstance(boot);
    let attached = 0;
    try {
      connection = connectBootClient({ boot, instance: late.instance, hot,
        attachSource(source) { attached++; late.attachSource(source); } });
      connection.stop();
      assert.equal(await connection.ready, false);
      assert.equal(attached, 0, 'Late source reconnected after cleanup');
      assert.equal(count(), 0);
    } finally { connection?.stop(); late.instance.dispose(); }
    console.log('[sveltekit] Owned listener cleanup, idempotent stop and late connection cancellation passed.');
  }
} finally { await server?.close(); }
```

## 설치와 실행

```sh
npm install --ignore-scripts
npm run check
npm run dev
npm run verify:ssr
npm run build
npm run preview
```

`--ignore-scripts`는 의존성만 받고 설치 스크립트는 돌리지 않는다. `npm run check`는 typegen, `svelte-kit sync`, `svelte-check` 순으로 돌아 생성 타입을 만들고 검사한다. 개발 서버는 `127.0.0.1:5197`, preview는 `127.0.0.1:5198`이고 둘 다 strictPort다.

`npm run verify:ssr`은 인자 없이 돌면 Vite 개발 서버를 직접 띄워 SSR HTML, `cache-control: no-store`, boot 데이터 일치를 확인한다. origin을 인자로 주면 이미 떠 있는 서버만 검사한다.

## SSR과 요청 로케일

layout load는 요청마다 `createRequestI18n({ locale: locals.locale })`로 instance를 만들고 `serializeBootSnapshot`으로 직렬화해 내려준 뒤 `finally`에서 바로 `dispose()`한다. 그래서 SSR instance가 요청 사이에 남지 않는다.

클라이언트는 layout에서 `decodeBootSnapshot`으로 그 boot를 풀어 쓴다. 초기값이 SSR과 같은 값이라 하이드레이션 때 문구가 흔들리지 않는다.

요청 로케일은 hooks에서 `Intl.getCanonicalLocales`로 정규화한다. `EN`은 `en`이 되고, 잘못된 태그 `en_US`와 카탈로그가 없는 `fr`은 기준 로케일 `ko`를 사용한다.

화면의 로케일 선택은 `goto(url, { reset: false, refreshAll: true })`로 쿼리와 서버 데이터를 갱신한다. 삭제했던 언어를 다시 추가했을 때 URL이 같아도 요청별 boot를 다시 읽는다. 주소의 `locale`이 따라오고 폼은 공유 layout에서 관리한다. 라우트 이동의 포커스 처리는 SvelteKit 라우터가 맡는다.

## 연결과 layout 수명

layout은 `onMount`에서 연결을 붙인다. 모듈이 공유하는 것은 context key뿐이고 instance는 layout마다 새로 만든다.

개발에서는 boot에서 시드한 소스를 layout이 직접 소유하고, 게시 빌드에서는 `virtual:saylo/lazy`의 정적 소스를 붙인다. 붙인 뒤 `refresh()`까지 마쳐야 준비가 끝난다.

홈과 about은 같은 layout 아래라 페이지를 옮겨도 폼과 열어 둔 모달이 유지된다. `/plain`은 그룹 밖이라 그쪽으로 가면 연결과 instance가 해제되고, 돌아오면 새 instance가 서고 폼은 빈 상태에서 시작한다.

## 라이브 수정 확인

`locales/en/demo.json`의 `heading`을 `Updated words. Same input.`으로 저장하면 그 자리에서 제목만 바뀌고 입력과 열어 둔 모달은 그대로다. 한국어 문구는 그대로 둔다.

`locales/ja/demo.json`은 `en`과 같은 키로 만들고 `heading`만 `Saylo 日本語`로 둔다. 로케일 목록에 `ja`가 나타나고 고르면 그 문구가 뜬다.

`heading`을 `{name`처럼 ICU가 깨진 값으로 저장하면 그 파일은 게시되지 않고 마지막 정상 문구가 유지되며 진단이 뜬다. 값을 되돌리면 진단이 사라지고 원래 문구가 돌아온다.

기준 파일 `locales/ko/demo.json`에서 `heading` 키를 지우거나 내용을 `{}`로 바꿔도 입력과 모달은 남는다. 마지막 정상 번역을 표시하고 `#render-error`와 모달에 파일 수정 안내가 나온다. 파일을 복원하면 안내가 해제된다.

ko/en 카탈로그를 처음부터 `{}`로 두고 개발 서버에 접속하면 SSR과 hydration 모두 번역 준비 안내와 입력 화면을 표시한다. 필요한 키를 채워 저장하면 입력을 유지한 채 번역 화면으로 복구된다. 파일 편집이 아니라 파일 자체가 없어 기준 카탈로그를 만들 수 없으면 플러그인의 서버 시작 진단을 먼저 해결한다.

## 생산 빌드

`npm run build`는 `npm run check` 뒤에 Vite 생산 빌드를 돌리고 `@sveltejs/adapter-node` 6으로 `build/`를 남긴다. 그 서버를 직접 띄우려면 다음처럼 실행한다.

```sh
HOST=127.0.0.1 PORT=5198 ORIGIN=http://127.0.0.1:5198 node build/index.js
```

```powershell
$env:HOST='127.0.0.1'; $env:PORT='5198'; $env:ORIGIN='http://127.0.0.1:5198'; node build/index.js
```

`ORIGIN`은 CSRF 검사 기준이라 실제 접속 주소와 맞춘다. preview와 이 서버는 둘 다 5198을 쓰므로 동시에 띄우지 않는다.

## 보장 범위

- 기준 키 삭제·빈 카탈로그의 렌더 실패는 수정 안내와 마지막 정상 번역으로 처리한다. 새 키·인자를 쓰려면 앱 호출부와 생성 타입도 갱신한다.
- 빈 카탈로그의 복구 검사는 개발 서버 기준이다. 생산 빌드에는 정상 카탈로그와 맞는 생성 타입을 준비한다.
- SSR에서 instance를 전역으로 공유하는 구성은 보장하지 않는다. 기준은 요청별 instance다.
- 파일 편집 중 입력·모달·포커스는 유지한다. `/plain`으로 나갔다 돌아오면 새 layout과 빈 폼으로 시작한다.

