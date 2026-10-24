# Saylo npm example (Vite + vanilla JS)

A standalone example that installs the published npm packages as-is and uses them on Vite 8 without a framework. It gets `@0disoft/saylo-core` and `@0disoft/saylo-vite` from the npm registry, and editing only the locale JSON in the development server updates the on-screen text immediately. It does not recompile the Saylo packages.

## Requirements

- Node.js 24.x and npm

## Dependencies

| Kind | Package |
| --- | --- |
| dependencies | `@0disoft/saylo-core@alpha` |
| devDependencies | `@0disoft/saylo-vite@alpha`, `vite@8` |

This example is an independent `private` package that does not belong to the root workspace. It does not use `workspaces` and installs the actual packages published on the npm registry without `file:`, `workspace:`, or alias links. A root build is therefore not required.

`package.json` uses the `alpha` tag. The current lockfile pins core, Vite, and Vite's transitive dependency typegen to `0.1.0-alpha.4`. `npm ci --workspaces=false` reproduces this lockfile. After the tag moves, run `npm update @0disoft/saylo-core @0disoft/saylo-vite --workspaces=false` to install new published builds.

## Run

```sh
cd examples/npm
npm install --workspaces=false
npm run dev      # http://127.0.0.1:5188 (strictPort)
npm run build    # production 빌드
npm run preview  # 빌드 결과 미리보기 (127.0.0.1:5189)
```

`npm run dev` starts on the fixed port 127.0.0.1:5188.

## Screen structure

The Vite plugin is attached with `saylo({ localesDir: 'locales', baseLocale: 'ko', initialLocale: 'en', timeZone: 'UTC' })`, and the app creates the store from eager values in `virtual:saylo`.

The development connection passes the app module's `import.meta.hot` to `connectDev(store, { hot: import.meta.hot, onUpdate, onDiagnostic })` to ensure the current app module's Vite hot context. The runtime uses the installed npm packages, so you only need to edit JSON, not rebuild Saylo.

The screen elements are the `#locale` selector, the `#name` input defaulting to `Saylo`, the `#note` textarea, the `#open-dialog` button, the `#confirmation` dialog with its `#dialog-note` and `#close-dialog` button, and `#status` with `role="status"`. Translated text is attached to `data-i18n` on `span` and `button` elements inside `h1`, `h2`, `p`, and `label` with fully qualified keys such as `demo:heading`.

## Locale keys

`locales/ko/demo.json` and `locales/en/demo.json` use the same eight keys.

| Key | Use |
| --- | --- |
| `heading` | Page title `h1` |
| `greeting` | Greeting with a name argument (`{name}`) |
| `nameLabel` | Name input label |
| `noteLabel` | Note input label |
| `openDialog` | Button that opens the confirmation dialog |
| `dialogTitle` | Dialog title (`{name}`) |
| `dialogNoteLabel` | Dialog note label |
| `closeDialog` | Close button |

Only `greeting` and `dialogTitle` use the `{name}` argument. The app fills every `data-i18n` node with `snapshot.t(key, { name: nameInput.value || 'Saylo' })`, so the extra `name` is ignored for keys without arguments, and keys using `{name}` always receive a value.

## Verify live edits

1. Start `npm run dev` and enter a name in `#name`.
2. Change `heading` in `locales/en/demo.json` to `"Live update from npm"` and save. The page initially loads in `en`, so the `h1` text changes immediately and the `#name` input value stays as it is.
3. Open the dialog with `#open-dialog`, enter a value in `#dialog-note`, and save the same JSON again. The text inside the open dialog updates, and the input value and dialog open state are preserved.
4. Add `locales/ja/demo.json` with the same keys as `en`. `ja` appears in the `#locale` selector, and selecting it changes the text to the values you added.

A normal edit that does not delete keys or add required arguments preserves the base schema, so form and dialog state are preserved as described above. Edits that break the schema, such as deleting a key or adding a required argument, are outside this preservation scope.

## Validation scope

### Example error guidance and back-forward cache lifetime (2026-10-11, checkout)

The published Saylo packages did not change. The two items below are changes in this example's checkout; the library API and package versions are unchanged. The first item is a real-browser observation, and only the second is covered by the automated `npm run verify:demo:npm` regression.

- Error guidance retention (`1336aa5`): In a real browser, broke `locales/en/demo.json`, saved a non-overlapping valid `locales/ko/demo.json`, and then restored `en`. Before the fix, saving the unrelated file overwrote the guidance with `Connected`; after the fix, the diagnostic remained until the file was fixed and returned to `Connected` on recovery. Guidance in the open dialog with `role="status"`, the dialog `aria-labelledby`, last-good text, input, and focus all PASS. Evidence is in [npm example error recovery validation](../../review/npm-demo-error-recovery-2026-10-11.json). This error-guidance observation is a real-browser record, not an automated regression test.
- Back-forward cache lifetime: When reproducing `PageTransitionEvent(persisted: true)` → `pageshow` → `#locale` change in the production bundle and jsdom, the existing `pagehide` cleanup produced a state where the selection was `ko` but the screen remained `en`, and it reproduced with exit 1. The fix cleans up only when `event.persisted` is false in `pagehide`.

`npm run verify:demo:npm` checks two cache-lifetime regression cases. It requires the root `npm ci` (for jsdom) and `examples/npm`'s `npm ci --workspaces=false`; the standalone build requires the dependencies in `examples/npm`. `scripts/test/npm-demo-lifecycle.test.mjs` runs two model DOM checks. The checks are (1) whether `ko` text and the `#name` input keep working after returning through cached history, and (2) whether repeated non-persisted disposal is safe. Currently PASS 2 tests.

Whether real browsers adopt BFCache, draft persistence across reload, and live-connection behavior under BFCache were not checked.

### alpha.4 install, build, and live edits (2026-10-11)

Run on Windows, Node 24.18.0, Vite 8.3.3. The core, Vite, and typegen used by this example are `0.1.0-alpha.4`.

- `npm update @0disoft/saylo-core @0disoft/saylo-vite --workspaces=false --ignore-scripts --no-audit --no-fund` exited 0. The `alpha` tag in `package.json` stayed the same, and third-party lockfile entries and keys outside the three Saylo packages were exactly the same before and after.
- `npm ci --workspaces=false --ignore-scripts --no-audit --no-fund` with the same options exited 0. The three packages were installed as real registry tarballs, not symlinks, and realpath is inside the example's `node_modules`. Installed integrity matched the [approved manifest](../../releases/0.1.0-alpha.4.json).
- `npm run build` exited 0. 45 modules, output JavaScript 28.23 kB (gzip 10.09 kB). It used only published builds, without a root workspace build.
- In the IAB real browser (`http://127.0.0.1:5188`), opened the dialog and put `Alpha4` in `#name`, `keep note alpha4` in `#note`, and `PreserveAlpha4` in `#dialog-note`. After the first save, waited 5 ms and saved different content a second time. The screen text finally reflected `Rapid2 final save`, and the dialog title `Rapid2 final, Alpha4`; all three input values and the dialog open state and focus were preserved.
- After adding `locales/ja/demo.json`, the `#locale` list became `en`, `ja`, `ko`, and the open dialog's input value, open state, and focus were preserved. After closing with `#close-dialog`, selecting `ja`, and reopening, `h1` showed `Alpha4 Japanese catalog` and the dialog title `Japanese catalog, Alpha4`, and all three input values were preserved. There were no console warnings or errors.
- Observations where `#dialog-note` appeared to change as if by input interference before the first visible check and during restoration were not counted in the state-preservation verdict. The `ja` deletion followed by `ko` fallback seen during restoration is also recorded only as an observation. The temporarily modified `en` JSON was restored to its original bytes, the `ja` file was deleted, the browser tab was closed, and the development server was stopped.

Evidence is in [npm example alpha.4 validation record](../../review/npm-example-alpha4-2026-10-11.json). `npm run preview` was not run, and no new performance numbers were measured.

### alpha.2 install and build (2026-10-09)

Run on Windows, Node 24.18.0, npm 12.0.2, Vite 8.3.3.

- `npm update @0disoft/saylo-core @0disoft/saylo-vite --workspaces=false --ignore-scripts --no-audit --no-fund` updated only the three Saylo packages to alpha.2. The `alpha` tag in `package.json` and third-party lockfile entries were preserved.
- `npm ci --workspaces=false --ignore-scripts --no-audit --no-fund` passed with the updated lockfile. The installed versions of core, Vite, and typegen were all `0.1.0-alpha.2`, and the registry tarball URLs and integrity matched the [approved manifest](../../releases/0.1.0-alpha.2.json). All three packages were not symlinks, and realpath was inside the example's `node_modules`.
- `npm run build` passed: 44 modules, output JavaScript 28.11 kB (gzip 10.05 kB). It used only published builds, without a root workspace build.
- The development server, browser, and preview were not run this time. The live-edit record below is past validation performed on alpha.1. See the [release record](../../releases/0.1.0-alpha.2.md) for separate alpha.2 external consumer and SvelteKit browser validation.

### alpha.1 live edits (2026-10-06)

Results from Windows, Node 24.18.0, Vite 8.3.3 on 2026-10-06.

- Install: `npm install --workspaces=false --ignore-scripts --no-audit --no-fund` succeeded. `@0disoft/saylo-core`, `saylo-vite`, and `saylo-typegen` all came from the registry at `0.1.0-alpha.1`, and they were not symlinks; realpath was inside `examples/npm/node_modules`.
- Build: `npm run build` succeeded.
- Browser: In the IAB real browser, editing `heading` in `locales/en/demo.json` updated the screen immediately and preserved the `#name` and note input values. Editing `dialogTitle` with the dialog open changed the text and preserved the dialog open state and the `#dialog-note` input value. Adding `locales/ja/demo.json` made `ja` appear in the `#locale` selector, and switching preserved the input values. There were no console warnings or errors.
- The `ja` catalog in this validation used Japanese for `heading` and `dialogTitle` and copied the `en` values for the other keys.
- The temporarily modified `en` file and the added `ja` file were restored and deleted.

`npm run preview` was not run.
