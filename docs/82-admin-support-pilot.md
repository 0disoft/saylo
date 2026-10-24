# 82. Saylo pilot for the admin support page

This is the admin customer-support page pilot record verified against product source `d4eb6e8` after documentation cleanup `ab220c2`. It is not certification of all Saylo features or a publication result.

## Production typegen lock issue

`OUTPUT_LOCKED` reproduced when Vite production typegen overlapped the nested client build inside SSR `writeBundle`. The regression in `production.test.mjs` failed before the fix and all 14 tests passed afterward. The fix stops the generator after typegen updates finish in production `buildStart` to release the lock, and creates it again during watch rebuilds. Relevant paths are [`packages/vite/src/index.ts`](../packages/vite/src/index.ts), [`packages/typegen/src/generator.ts`](../packages/typegen/src/generator.ts), and `packages/vite/test/production.test.mjs`.

## Admin support page scope

The admin `/support` page has 30 keys each for Korean and English, translating the title, filters, table, details, reasons, replies, and count labels. Remaining page text, including errors, recovery, and operation status, is still Korean; this is not a claim that the entire page is translated.

The web app creates a request-local `createStore` and follows SSR `?locale=en` or `?locale=ko`. The client connects `connectDev` in `onMount` and disposes it in `onDestroy`. Relevant implementation lives under `zdp-platforms/admin-ops/zdp-admin-console/apps/web`; translation files are `apps/web/locales/ko/support.json` and `en/support.json`.

## Validation results

`scripts/check-web-saylo-pilot.mjs` exited 0 with synthetic admin data. The JSON result reported true for `liveEdit`, `parseRecovery`, `localeAddRemove`, `filterSelectionDraftIdentity`, `focusCaret`, and `englishHydration`; concurrent SSR covered both ko and en; and `pageErrors` was 0. No real API writes were performed.

After reinstalling the latest Vite tarball from `d4eb6e8` with npm, the existing typegen-on configuration completed a real admin SvelteKit Cloudflare build with exit 0 (21.36 s), confirming the lock fix in the real app. The final portable CLI config build also exited 0 (21.82 s). The final `check` reported 0 errors and 0 warnings; 103 assertions across 20 support-page, command-snapshot, and detail-client tests and the boundary checks passed.

After installing registry alpha.4 with `bun install --force --frozen-lockfile --ignore-scripts`, core and Vite `dist` differed from the local tarballs. In that state, the final CLI config Cloudflare build exited 0 with a 5.81 s client build and 24.82 s server build. The registry browser recheck also exited 0, with all the same pilot JSON fields true and `pageErrors` 0. This is an install and execution result, not a live npm metadata query.

On Windows, a browser fixture occasionally left a test-only typegen stale lock after `taskkill /F`, so the fixture callback now exposes `serverPid`. The pilot script's `finally` cleans `owner.json` and an empty lock directory only when `owner.pid` matches that run's PID, hostname, and exact target and the PID is confirmed absent. The same `finally` restores existing files and deletes the added `ja` file. Automatic deletion of unknown stale locks is not guaranteed.

## Local tarball boundary

Four local tarballs containing the latest `dist` were installed with `npm --no-save --package-lock=false`, and each package's `dist` SHA-256 matched. An initial Bun `--no-save` install of the same versions reused existing registry packages and mismatched, so local tarballs were verified directly through npm installs. This local tarball check is separate from the revalidation after installing registry alpha.4.

The admin app's default dependency remains registry alpha.4. The current final config runs the typegen CLI before Vite and connects Vite typegen only when `command === 'serve'`, avoiding the nested client build. The final build and browser recheck with registry alpha.4 are complete; validation is based on installed packages and execution results.
