# Saylo React starter

A React 19 + Vite 8 starter for Saylo. The Saylo repository exports this folder to an empty folder outside the repository, and the consuming app installs and runs it using only the local tarballs in `vendor/`, without the repository workspace. Node 24.x is required.

## Export

Run from the Saylo repository root.

```sh
npm run prepare:starter:react -- --out-dir <empty folder outside the repository>
```

The target must be an empty folder outside the repository. If it contains files, the export refuses instead of overwriting. The export builds the repository first, copies this folder, and creates four tarballs and `vendor/manifest.json` in `vendor/`.

## Install and run

Run inside the exported folder.

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run dev      # typegen 뒤 개발 서버 127.0.0.1:5197 (strictPort)
npm run build    # typegen -> tsc --noEmit -> vite build
npm run preview  # 빌드 결과 127.0.0.1:5198 (strictPort)
```

## vendor/ and versions

`saylo-core.tgz`, `saylo-react.tgz`, `saylo-vite.tgz`, and `saylo-typegen.tgz` are local workspace packages packed with `npm pack`, and `package.json` references them with `file:`.

- `source` in `vendor/manifest.json` is `local-unpublished`, and each package's `version` and `integrity` are recorded.
- The version string matches the published `0.1.0-alpha.4`, but the bytes differ from the published build. These are local build artifacts and are not published.

## Screen structure

- `i18n.ts` creates the store and `useI18n` and `useI18nSelector`. `App.tsx` reads messages with `useI18n()`, and `SelectedLocale` is a `memo` component that subscribes only through `useI18nSelector(snapshot => snapshot.locale)`.
- `#rich-preview` renders `renderRichText(text.rich, renderers)`. `strong` is a `<strong>` element, and `link` is an `<a>` with `href="#order-form"`.
- `projectMessages` in `demo-messages.ts` changes the screen only after computing everything, including rich text. If a rich marker is mismatched, it shows a diagnostic in `#render-error` and re-interpolates the last good message with the current name.
- The initial screen locale is `en`, the base locale is `ko`, and `npm run typegen` creates `generated.d.ts`. The name argument is `name || 'Saylo'`.
- `main.tsx` owns the root and store. If `pagehide` has `persisted`, it keeps them for BFCache restoration; on a real shutdown it calls `root.unmount()` and then `store.dispose()`. Vite HMR dispose runs the same cleanup.

## Repository validation

At the root, `npm run verify:starter:react:local` runs export outside the repository, link-free installation, type template checks, build, and dev and production browser verification in one pass. It creates a temporary folder, checks it, and deletes it when finished.

For published-build installation, see docs/getting-started-react.md in the Saylo repository.
