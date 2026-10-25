# Add Saylo to an existing Vite app

`saylo init` is available in the source checkout and requires a future npm release. The published alpha.6 does not contain this command. It connects the catalog pipeline in an existing Vite app without replacing routes or application components.

Build the checkout with `npm run build`. Then run its CLI from your app directory:

```sh
node "<saylo-checkout>/packages/typegen/dist/catalog-cli.js" init --base-locale ko --json
node "<saylo-checkout>/packages/typegen/dist/catalog-cli.js" init --base-locale ko --apply --json
```

The first command is a read-only preview, including each file's complete before/after content. `--dry-run` is optional. The second applies the previewed integration to the current files; it does not reuse an earlier saved plan. Review `changes` and `writtenFiles` in the JSON result.

The app must have `package.json`, a `src/` directory, Vite in its dependencies, and exactly one ESM `vite.config.ts`, `.mts`, `.js`, or `.mjs`. Supported configs export a literal object, either directly or through Vite's imported `defineConfig`. Literal `plugins` arrays, comments, aliases, and other settings are retained. Function configs, config spreads, computed keys, and existing Saylo integrations require manual integration. Config source is parsed and is never executed by init.

The command creates:

- `saylo.config.json` and `locales/<base-locale>/saylo.json`, with one ICU greeting.
- `saylo.vite.mjs`, imported into the app's existing Vite plugin list.
- `src/saylo/generated.d.ts` and `env.d.ts`, with the initial schema and Vite virtual-module types.
- `src/saylo/i18n.ts`, exporting an instance factory with development translation updates and cleanup.

No install scripts, package-manager commands, or application code run. `nextSteps` lists install commands for the package manager declared in `package.json` or detected from a single lockfile family. Ambiguous detection falls back to npm. Dependencies use `@alpha`; `latest` remains a registration placeholder. No dependency versions or lockfiles are rewritten.

## Connect the UI

Create `createAppI18n()` inside the owner of your app tree. Read `store.getSnapshot()`, subscribe with `store.subscribe(render)`, and call the returned `dispose()` when the owner unmounts. The factory owns the store and its development connection. Module replacement also disposes its active browser instances.

```ts
import { createAppI18n } from './saylo/i18n';

export function mountGreeting(element: HTMLElement) {
  const app = createAppI18n();
  const render = () => {
    element.textContent = app.store.getSnapshot().t('saylo:greeting', { name: 'Saylo' });
  };
  const unsubscribe = app.store.subscribe(render);
  render();
  return () => { unsubscribe(); app.dispose(); };
}
```

For SSR, create and dispose an instance per request. Do not export a shared server store. The initial factory uses eager catalogs; it does not configure framework providers, request locale negotiation, hydration boot data, lazy loading, URL prefixes, or SEO. Use the [React guide](getting-started-react.md), [Svelte guide](getting-started-svelte.md), or [SvelteKit SSR guide](getting-started-sveltekit.md) for framework wiring.

Run your app's existing dev/build commands after installing the dependencies shown in `nextSteps`. Vite regenerates the type declarations as catalogs change.

## Conflicts and interrupted writes

Existing integration files are accepted only when identical to the generated content. Other content is preserved and stops the command before writes. An unchanged rerun writes nothing; after editing generated files, use the existing integration rather than reinitializing it.

Initializers use a project lock. Files changed after planning stop application; new file names are published exclusively, and existing Vite config replacement is atomic per file. The operation is not a multi-file transaction: disk failures or cancellation can leave completed files behind. Errors include `writtenFiles`; inspect them before retrying. Temporary files and the lock are cleaned up on ordinary failure and handled signals. After a forced process exit, verify that the initializer has stopped before removing `.saylo-init.lock`.
