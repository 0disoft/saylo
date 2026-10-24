# Demo accessibility checks

## Run

```sh
npm run verify:demo:a11y
npm run verify:demo:a11y -- --framework npm
npm run verify:demo:a11y -- --zoom 2
npm run verify:demo:a11y -- --zoom 4
npm run verify:demo:a11y -- --long-text --zoom 4
```

If run without `--framework`, the command checks six targets in order: vanilla, react, svelte, vue, npm, and sveltekit. Use `--framework <name>` to select one. Chromium or Chrome is required, and `CHROME_BIN` can point to another executable. Run it on Node 24; `examples/npm` and `examples/sveltekit` require dependencies to be installed first. The default check covers six examples in four states each, for 24 runs. The five-example, 20-run results in the historical records below reflect the scope at that time.

`scripts/verify-demo-accessibility.mjs` starts a Vite dev server, and `scripts/demo-accessibility-browser.mjs` scans inside the page. It opens the actual render and checks four states per framework—ko/en × dialog closed/open—so the default scope is 24 runs. It injects axe-core 4 into the page and runs a `runOnly` scan with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, and `best-practice` tags ([axe-core API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)). For examples with a support data panel, it opens the panel, generates data, and then scans.

It does not modify user locale files. For SvelteKit it uses an app copy and a temporary browser profile, then removes them when finished.

`--long-text --zoom 4` writes long unbroken translations for the title, form label, modal title, and open button into a temporary catalog, then checks the actual translated render, horizontal overflow, input preservation, and access to closing the modal at 400% page zoom. It uses 128 Korean characters and 352 English characters and does not modify the original catalog or generated types. Results go to `.release/accessibility-long-text-zoom-4-report.json`. The close button text keeps its original translation.

`--zoom 1|2|4` sets the default page zoom in a temporary Chromium profile to 100%, 200%, or 400%. With a 1280×1024 window and device scale factor 1, it checks DPR, CSS viewport width, and the visualViewport scale together to confirm that page zoom was applied. It also checks horizontal overflow of the page and modal, input preservation after a locale change, initial focus in the modal input, access to the close button after vertical scrolling, and focus restoration after closing. Test code in the page performs input and button operations. Existing user browser profiles are not changed. The basis for the settings is in [Chromium zoom settings](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc) and [scale conversion](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/common/page/page_zoom.cc).

## Results and limits

Results are written to `.release/accessibility-report.json` with each framework's violations, incomplete results, passedRules, and browser state. Any rule violation exits 1. `incomplete` is not a pass, so a person reviews it separately.

Zoom mode writes results and screen dimensions to `.release/accessibility-zoom-<factor>-report.json`. An unapplied zoom, horizontal overflow, or failed interaction check also exits 1, and `runComplete` is true only when every target check passes.

If contrast in the zoomed modal is incomplete, `contrastReview` records the original scroll position, text line boundaries, hit-tests at nine points per line, and computed contrast against a solid background. It rechecks only contrast in a separate view scrolled over the modal and then returns to the original position. The original incomplete result is preserved. If a solid background cannot be determined, computed contrast is null, and computed values or sample points alone do not establish whether the whole screen is obscured.

This is based on the development render and headless Chromium. Screen reader pronunciation, operation with a physical keyboard only, OS text scaling, other browsers, and production builds are separate validation scopes. This is an optional command and is not automatically connected to `npm run check` or a CI job.

## Current status

In the baseline `.release/accessibility-before.json` (5 frameworks × 4 states), the only failures were two cases for the `examples/npm` modal open state, ko and en, where `#close-dialog.secondary` had a color-contrast ratio of 4.46:1 (`#2f7a63` on `#e8f1ec`, 13px). The secondary foreground was changed to `#24614e`. The other examples had 0 violations and 0 incomplete results.

After the fix on 2026-10-12, the final 20 states had 0 violations and 0 incomplete results. The close button color contrast checked in the browser is 6.30:1. The npm example's production build and three lifetime regression cases also passed. See [demo-accessibility-acceptance-2026-10-12.json](../review/demo-accessibility-acceptance-2026-10-12.json) for the run scope and before/after results.

The page zoom follow-up on 2026-10-12 had 0 violations across 60 states: 100%, 200%, and 400% × five examples × Korean/English × modal closed/open. CSS viewport width was 1262 → 631 → 315 px, DPR was 1 → 2 → 4, and visualViewport scale was 1 in all cases. Horizontal overflow and input/modal interaction checks also passed. However, contrast results for the npm Korean modal at 100% and 200% and the five English modals at 400% remained incomplete because titles or labels overlapped or were partly obscured. These 7 states are not treated as having passed contrast checks; obscuration and overlap are reviewed separately. Results are recorded in [page zoom validation record](../review/demo-page-zoom-acceptance-2026-10-12.json).

The same 7 states were checked in a follow-up. In the five English modals at 400%, a previous close interaction had left a scroll position that put titles and labels outside the view; in the view scrolled upward, text samples were visible and the contrast recheck passed. In the two npm Korean titles, there was no obscuration at the sample points and computed contrast against the white modal background was 13.69:1, but axe still reported incomplete. These results did not lead to changes in production CSS or modal behavior. The original results and separate-view results are distinguished in [contrast follow-up validation](../review/demo-contrast-review-acceptance-2026-10-12.json). Pixel-level obscuration and checks with actual assistive technology are separate scopes.
