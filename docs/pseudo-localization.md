# Live pseudo-localization

Status: available in the source checkout, not in the published npm alpha.9
packages. Vue remains private. The feature is off by default and adds no new
dependencies or translation files.

## Try the screen controls

From the repository root, run `npm run dev:react` and open the local URL printed
by Vite. In the header, choose **의사 번역**:

- **원문** restores authored text.
- **악센트·길이 확장** selects `accent`: accented Latin letters, padding and brackets.
- **길이 늘리기** selects `long`: original letters with longer padding and brackets.

Enter a name and count, open the confirmation dialog and type a draft. Switching
preview modes updates the existing view. The React demo includes rich `<strong>`
and link renderers, so it also shows that interpolated names, links and input
state stay intact. The vanilla demo (`npm run dev`) has the same preview controls.

## Runtime API

```ts
const store = createStore({
  baseLocale: 'en',
  locale: 'en',
  catalogs,
});

store.setPseudoLocale('accent');
store.setPseudoLocale('long');
store.setPseudoLocale(); // Restore authored text.

const mode = store.getSnapshot().pseudoLocale; // 'accent' | 'long' | undefined
```

`createStore` and `createI18n` expose `setPseudoLocale(mode?)`. The setter publishes
a new immutable snapshot synchronously and advances `stateRevision`. Repeating
the same mode is a no-op. Old snapshots retain their original rendering mode.

This setter changes the currently committed view without loading catalogs,
changing the real locale, completing an in-flight locale/refresh request, or
changing its desired scope. When pending catalogs arrive, they render using the
latest preview mode. Catalog updates and language changes retain the mode.

For an initial preview, pass `pseudoLocale: 'accent'` or `'long'` to
`createTranslator`, `createStore`, `createI18n`, or `createServerI18n`.
`createTranslator` is immutable; create a new translator to choose another mode.
This is a runtime option, not a field in `saylo.config.json`.

## Framework controls

React's `useI18n()`, Svelte's `$i18n`, and Vue's `state.value` expose the optional
`setPseudoLocale` method when their underlying instance provides it:

```ts
// React hook snapshot, or the equivalent Svelte/Vue snapshot.
snapshot.setPseudoLocale?.('accent');
snapshot.setPseudoLocale?.();
```

Existing custom adapter instances without this method continue to work.
For Vite-only development controls, mount the controls under `import.meta.env.DEV`.
The core does not infer a development environment or automatically enable preview
in production. Application owners choose where the controls are available.

## What stays intact

Only authored ICU AST literal nodes are transformed, before message formatting:

- Argument names, types and interpolated values remain unchanged. User input is
  not accentuated, padded, rescanned for markup, or treated as a rich tag.
- Select/plural branch names, exact branches, offsets, ordinal rules and `#`
  operands retain their original semantics.
- Number/date/time skeletons and native Intl output use the real source locale
  and configured time zone.
- Rich tag names, nesting and renderer callbacks remain unchanged. Plain `t()`
  also retains simple `<link>`/`</link>` markers as literal text.
- Catalog sources, base schemas, typegen contracts, available locale lists and
  on-disk JSON remain unchanged. Missing-key/error callback text is not transformed.

Text segments containing letters receive brackets. `accent` adds approximately
35% padding by literal code-point length; `long` adds approximately 100%, plus
brackets in either case. This measures authored text segments, not the complete
formatted message, and is not a promise about pixel width. Whitespace boundaries
and punctuation-only segments are preserved. Non-Latin text still gets padding.

The two modes share the existing bounded formatter caches, with a separate key
for each mode. Switching back cannot reuse a formatter from another mode.

## SSR and hydration

The optional mode is recorded in boot metadata and survives ordinary and compact
serialization. Catalog data stays original. A client created from that boot
inherits the mode, so it initially renders the same text as the server. An
explicit conflicting client mode is rejected with `INVALID_BOOT`.

React's hydration adapter buffers preview changes behind its existing hydration
barrier. `getServerSnapshot()` remains pinned even after live preview changes;
`getBootSnapshot()` describes the current committed view.

## Limits

This preview helps reveal text expansion and unchanged hardcoded UI copy. It does
not translate meaning, detect every hardcoded string, emulate another language's
plural rules, change `document.lang`, or provide RTL/bidirectional testing.
Longer copy can change layout and scroll position even when node identity and
input state are preserved. Inspect the layouts that matter to your application.

Verification covers ICU/rich invariants, eager and lazy snapshots, pending
requests, reentrant subscribers, SSR boot round trips, and React/Svelte/Vue DOM
state. The built vanilla and React demo controls are checked in jsdom; this is
not a real-browser or assistive-technology audit.
