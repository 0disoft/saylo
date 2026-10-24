# 01. Product and Scope

This document defines the problem Saylo aims to solve, the boundaries of that scope, and the extent to which DOM state is preserved.

## Problem

Code generation (codegen) based i18n bakes messages into build artifacts. As a result, every edit to a single line of copy or addition of a locale requires another message compilation, and the wait interrupts the development flow. Until compilation finishes, the changed copy does not appear on screen.

Another pain point is state reset. When whole-module invalidation or a full reload applies new copy, open input forms, modals, scroll positions, and draft input values are lost. Refining translations involves repeated saves, so this loss accumulates frequently.

## Goals

- Copy edits, locale additions, and namespace additions appear immediately in the development server.
- Applying updates does not destroy existing DOM state (input values, focus, open modals, or scroll position).
- Both JavaScript and TypeScript projects are supported.
- The core is framework-neutral and is extended through framework adapters.
- Development and production share the same parsing, validation, formatting, and fallback rules.

## Development update path

File watch → parse/validate modified files → locale+namespace catalog transaction → send snapshot/patch through a Vite custom event → update the client store → re-render framework subscribers.

This path does not wait for JavaScript output generation, whole-app module invalidation, a full reload, or typegen completion. It eliminates code generation waits and full reloads. Time spent on parsing and validation remains.

## Scope of DOM state preservation

- Copy value edits and locale additions preserve existing DOM state.
- Schema-compatible edits (key edits that only change values) preserve existing DOM state.
- Schema-breaking edits (deleting a key or adding a required argument) apply the new schema immediately and emit diagnostics and typegen together. Existing call sites may throw `InvalidArgumentError`, and DOM state across that edit is not guaranteed. Follow the detailed rules in [04-live-update-and-types.md](04-live-update-and-types.md).
- Full reloads initiated by the Vite client when the Vite dev server restarts or the websocket reconnects are outside this guarantee. See [05-build-and-ssr.md](05-build-and-ssr.md) for details.
- Even when Saylo does not recreate the DOM, changed copy length can alter layout and scroll position. State-preservation acceptance checks run under the same layout conditions.

## Non-goals

| Non-goal | Reason |
| --- | --- |
| Applying updates through a full reload | It destroys DOM state. |
| Remounting entire screen components | It loses input, focus, and scroll state. |
| Interpolating rich text components in the MVP (initial decision) | Initially, the value syntax and type contract would have become complex, so the decision was to support plain text first. The first rich text core API slice adds a read-only parts projection (`tParts`) on top of plain text. Interpolation by passing components as arguments and automatic HTML rendering remain non-goals. Follow [78-rich-text-parts.md](78-rich-text-parts.md). |
| Replacing compilers or bundlers | Saylo handles only the i18n layer. |

## Subscription scope

React's `useI18nSelector`, and Svelte's `selectSvelteStore` and `getI18nSelector`, are in the published `0.1.0-alpha.4` build. Vue's `useI18nSelector` and `useVueSelector` are local private workspace implementations. Selectors choose the values they need from a snapshot and compare them with `Object.is`, so downstream updates are skipped when the selected values are unchanged.

## Selective builds

Production builds keep only the keys used by the screen, using either a manual `string[]` list in `includeKeys` or source analysis through `{ from, dynamicKeys? }`. The analysis reads JS, TS, JSX, TSX, Vue, and Svelte sources statically without executing them. Development uses the full catalog, and typegen declarations retain the full base schema.

## Target users

- JavaScript/TypeScript developers who edit copy often and want to reduce waits during development.
- Teams building form- and dashboard-heavy screens who want to apply copy changes while preserving state.
- Projects that want to use a framework-neutral core together with framework adapters.

## Terminology

| Term | Definition |
| --- | --- |
| catalog | A set of messages for one namespace within one locale |
| namespace | A file-level partition of catalogs. For example, `common` or `cart` |
| registry revision | A monotonically increasing number that identifies transmission order within a session |
| catalogVersion | The version of a locale+namespace catalog and its deleted state |
| stateRevision | A number that identifies changes to the public UI snapshot |
| snapshot | Immutable state at a particular point in time. UI, boot, and transport snapshots serve different purposes. |
| patch | A bundle of changes from a base revision to a new revision |
| base locale | The reference locale. It is the source of keys and argument schemas. |
| generated types | Type declarations generated from the base schema |
| typegen | The background task that generates generated types |

## Principles

1. Text first. Values are strings, with no arbitrary code execution or automatic HTML injection.
2. The core does not know about frameworks. Framework dependencies belong only in adapters.
3. Development and production use the same normalization, validation, formatting, and fallback paths.
4. On failure, retain the last known-good catalog and expose diagnostics. Follow the detailed rules in [04-live-update-and-types.md](04-live-update-and-types.md).
5. Do not make performance, version, or ecosystem claims that have not been verified.
