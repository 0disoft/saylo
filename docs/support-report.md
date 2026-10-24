# Diagnostic support report (`saylo.support/v1`)

## Scope and status

This document describes the contract for a diagnostic JSON report that an app using Saylo can attach when reporting a problem. The implementation is in `packages/vite/src/support-report.ts` and is exported from `@0disoft/saylo-vite/client`.

`createSupportReport` and `createSupportRecorder` are included in alpha.5 and are absent from alpha.4.

## Design principles

Reports rest on three foundations: allowlist projection, explicit collection, and manual submission.

Sensitive-data safety is handled by limiting the fields that can enter the report to an allowlist, rather than by regex-scrubbing raw text. At record time, only allowed fields are selected into a new object and the rest are discarded. Fields that are not allowed are never emitted in the report. Raw string values needed for a decision are immediately folded into boolean or numeric aliases and are not retained in the buffer in their original form.

Version strings follow the same principle. Only values that pass a regex validating the entire format are included; if a value fails, that field is omitted. This is a projection that admits only well-formed values, rather than a substitution that tries to pick secrets out of free text.

The library does not enable instrumentation on its own. Environment versions and runtime use only values the app passes explicitly. There is no path that fills them automatically by inspecting `process.version` or `navigator.userAgent`.

There is no server account and no automatic upload. A report is a plain object in app memory, and the app and user decide where to send it. There is no code path in the library that sends it remotely.

## Public API

Two functions are exported from `@0disoft/saylo-vite/client`.

```ts
import { createSupportReport, createSupportRecorder } from '@0disoft/saylo-vite/client';
import type { LiveDiagnostic, DevSyncState } from '@0disoft/saylo-vite/client';
```

The contract excerpt below is for reading. Do not paste it into the same file as the import block above. Import the `SupportReport` and `SupportRecorder` types from `@0disoft/saylo-vite/client` too.

```ts
interface SupportEnvironment {
  readonly runtime?: 'browser' | 'node' | 'unknown';
  readonly node?: string;
  readonly vite?: string;
  readonly sayloCore?: string;
  readonly sayloVite?: string;
  readonly sayloReact?: string;
  readonly sayloSvelte?: string;
  readonly sayloTypegen?: string;
}

interface SupportReportOptions {
  readonly environment?: SupportEnvironment;
  readonly syncState?: DevSyncState;
  readonly diagnostics?: readonly LiveDiagnostic[];
}

declare function createSupportReport(options?: SupportReportOptions): SupportReport;
declare function createSupportRecorder(environment?: SupportEnvironment): SupportRecorder;
```

`createSupportReport` creates one report in place from the values it receives. It is a pure function with no state.

`createSupportRecorder` is a stateful collector. It provides these methods.

| Method | Input | Behavior |
| --- | --- | --- |
| `onDiagnostic` | `LiveDiagnostic` | Takes one diagnostic event, immediately reduces it, and puts it in the buffer. |
| `onSyncState` | `DevSyncState` | Keeps only the latest handshake state. Clears it if invalid. |
| `getReport` | None | Creates a report object from the current buffer. |
| `clear` | None | Clears the event buffer, state, and omission counters. |

`createSupportReport` returns a newly frozen object on every call, and `getReport()` returns one on every read. Modifying the returned object does not change the collector's internal state.

## Report schema

The object created by `createSupportReport` and `getReport()` has this skeleton.

```json
{
  "schemaVersion": "saylo.support/v1",
  "environment": {
    "runtime": "browser",
    "node": "24.18.0",
    "vite": "8.3.4",
    "sayloCore": "0.1.0-alpha.4",
    "sayloVite": "0.1.0-alpha.4"
  },
  "syncState": { "status": "connected", "attempt": 0, "maxAttempts": 3 },
  "events": [
    {
      "operation": "catalog",
      "hasMessage": true,
      "diagnostics": [
        { "code": "MISSING_MESSAGE", "source": 1, "position": { "offset": 42, "line": 3, "column": 7 } }
      ],
      "omittedDiagnostics": 0
    }
  ],
  "omittedEvents": 0
}
```

`schemaVersion` is fixed to the string `saylo.support/v1`. Increase the version when adding fields or changing their meaning.

### environment

`environment` has only the following fields. `runtime` is always present and is one of `browser`, `node`, or `unknown`. The others are package version strings and are omitted when invalid.

| Field | Meaning |
| --- | --- |
| `runtime` | Execution environment. Use `unknown` when it is neither `browser` nor `node`. |
| `node` | Node version reported by the caller. In browser demos, this is the Node that ran dev or build. |
| `vite` | Vite version. |
| `sayloCore` | `@0disoft/saylo-core` version. |
| `sayloVite` | `@0disoft/saylo-vite` version. |
| `sayloReact` | `@0disoft/saylo-react` version. Omitted when unused. |
| `sayloSvelte` | `@0disoft/saylo-svelte` version. Omitted when unused. |
| `sayloTypegen` | `@0disoft/saylo-typegen` version. Omitted when unused. |

Version values allow a three-number numeric core such as `0.1.0-alpha.4`, optionally followed by a prerelease with one of `alpha`, `beta`, `rc`, `dev`, or `next` and a number. `0.1.0` and `1.2.3-rc.1` are valid; `v8.3.4`, values with build metadata (`1.2.3+build`), arbitrary labels (`1.2.3-preview.1`), and strings longer than 64 characters do not pass and are omitted.

### Providing environment values

Versions are supplied by the app; there is no automatic discovery. The example demos inject constants at dev and build time with Vite `define`.

```js
// vite.config.mjs
import { defineConfig, version } from 'vite';

export default defineConfig({
  define: {
    __SAYLO_SUPPORT_ENV__: JSON.stringify({
      runtime: 'browser',                       // 앱이 브라우저에서 도는 경우
      node: process.versions.node,              // 개발·빌드를 돌린 Node
      vite: version,
      sayloCore: '0.1.0-alpha.4',               // package.json에서 읽어도 된다
      sayloVite: '0.1.0-alpha.4',
    }),
  },
});
```

In browser demos, `node` refers to the Node version that ran the development server or build. When the app runs in a browser, this value describes which tool built it. In a Node app, it can be the running Node version, and this value is also supplied by the caller rather than by the library. `runtime` directly states where the app runs.

### syncState

`syncState` reduces the latest `DevSyncState` to only `status`, `attempt`, and `maxAttempts`. `status` is one of `idle`, `connecting`, `retrying`, `connected`, `disconnected`, `failed`, or `stopped`. `attempt` is an integer from 0 to 3, and `maxAttempts` is 3. If there is no state or it fails validation, omit the entire `syncState` field. Do not insert `null`.

### events

`events` lists diagnostic events from oldest to newest. Each event has these fields.

| Field | Meaning |
| --- | --- |
| `operation` | One of `catalog`, `handshake`, `observer`, or `unknown`. |
| `hasMessage` | Whether `LiveDiagnostic.message` was a non-empty string. The text is not included. |
| `diagnostics` | Array of diagnostic rows reduced by the rules below. |
| `omittedDiagnostics` | Number of diagnostic rows dropped from this event because of limits. |

`operation` uses `LiveDiagnostic.operation` when it is `handshake` or `observer`, and treats a missing value as `catalog` (server catalog diagnostics do not have this field). Any other value is lowered to `unknown`.

`hasMessage` is a boolean that keeps only the fact that an error occurred. Human-readable error text is not included anywhere in the report; only whether text was present.

Each row in `diagnostics` has only these fields.

| Field | Meaning |
| --- | --- |
| `code` | Diagnostic code. `UNKNOWN` when outside the allowlist or unparseable. |
| `source` | Numeric alias assigned from 1 within the event. The original `sourceName` is not used. |
| `position` | The three numbers `offset`, `line`, and `column`. Omit the field if it fails validation. |

`code` uses only the core `DiagnosticCode` allowlist. The list is `INVALID_LOCALE`, `INVALID_NAMESPACE`, `INVALID_JSON`, `INVALID_CATALOG`, `INVALID_ID`, `DUPLICATE_ID`, `INVALID_ICU`, `ARGUMENT_CONFLICT`, `NAMESPACE_MISMATCH`, `UNKNOWN_MESSAGE`, `UNKNOWN_ARGUMENT`, `ARGUMENT_TYPE_NARROWING`, `MISSING_MESSAGE`, `MISSING_NAMESPACE`, `DUPLICATE_CATALOG`, and `LOCALE_MISMATCH`. If the code is unknown, write `UNKNOWN`.

`source` does not copy each distinct source string. Within one event, assign fresh numbers such as `1` and `2` per `sourceName`, preserving only the fact that several diagnostics came from the same file. The same source string within an event gets the same number; if the source is not a string, omit `source`. Aliases are scoped to one event and restart at `1` for each event.

`position` is included only when `offset` is a non-negative integer and `line` and `column` are integers of at least 1. Otherwise discard the value and omit `position`. Objects in the report, including the included `position` object, are returned deeply frozen.

## What is kept and discarded at record time

`onDiagnostic` reduces a `LiveDiagnostic` immediately on receipt. Values needed for a decision are read and folded; raw strings are not retained in the reduced result or the buffer.

- `message` is used only to decide whether a value is present and becomes the `hasMessage` boolean; the text itself is not included.
- `sourceName` is used only to create a numeric alias that distinguishes sources within an event; the original is not included.

The following values do not appear in raw form in the reduced result or in `getReport()` output.

- Human-readable error text (`message`)
- Original file names (`sourceName`)
- Locale (`locale`) and namespace
- Message keys (`id`)
- Argument names (`argument`)
- Request identifiers (`requestId`) and request coordinates
- File paths and URLs
- Stack traces
- Environment variable values

There is no substitution stage that deletes raw text; raw forms are never put into the buffer in the first place. Dumping the reduced buffer therefore does not expose the values above in raw form.

## Limits and omission markers

The buffer has size limits.

- Keep the 32 most recent diagnostic events. When it overflows, drop the oldest events first.
- Keep up to 64 rows from the start of each event's `diagnostics`. Drop later rows.

Omitted amounts are recorded as numbers in the report.

| Field | Meaning |
| --- | --- |
| `omittedEvents` | Number of events dropped because of the limit. |
| `events[].omittedDiagnostics` | Number of diagnostic rows dropped from that event because of the limit. |

`createSupportReport` applies the same limits to the `diagnostics` array passed to it. If there are more than 32 events, drop from the front and record the count in `omittedEvents`. Omissions do not disappear silently.

## Collection flow

Collection is explicit, not automatic. Passing recorder methods as `connectDev` callbacks sends live diagnostics and state into the recorder. If the app does not create a recorder, nothing is collected.

### Example connecting to connectDev

```ts
import { connectDev, createSupportRecorder } from '@0disoft/saylo-vite/client';

const recorder = createSupportRecorder({
  runtime: 'browser',
  node: '24.18.0',            // 개발·빌드를 돌린 Node
  vite: '8.3.4',
  sayloCore: '0.1.0-alpha.4',
  sayloVite: '0.1.0-alpha.4',
});

const disconnect = connectDev(i18n, {
  catalogSource,
  onDiagnostic: diagnostic => recorder.onDiagnostic(diagnostic),
  onSyncState: state => recorder.onSyncState(state),
});

// 정리
// disconnect(); recorder.clear();
```

`onDiagnostic` receives `LiveDiagnostic` and `onSyncState` receives `DevSyncState`. Both callbacks are optional, so apps that do not use a recorder can pass nothing.

If the same example is written in JavaScript, remove only the type annotations.

```js
import { connectDev, createSupportRecorder } from '@0disoft/saylo-vite/client';

const recorder = createSupportRecorder({ runtime: 'browser', node: '24.18.0', vite: '8.3.4' });
const disconnect = connectDev(i18n, {
  catalogSource,
  onDiagnostic: d => recorder.onDiagnostic(d),
  onSyncState: s => recorder.onSyncState(s),
});
```

### Manual save and submission

The app turns the report into a string when it chooses. The library does not save it to a file or send it over the network.

```js
const json = JSON.stringify(recorder.getReport(), null, 2);
await navigator.clipboard.writeText(json); // 또는 Blob으로 파일 저장
```

A person reviews it once before submission. The report has no raw messages or file names, so it is expected not to leak personal information, but use numbers such as `position` and event counts to judge the scale of the problem, and include reproduction steps in the inquiry body.

### Review UI in the example demos

The vanilla, React, Svelte, and SvelteKit examples provide a support diagnostic panel with the same flow. The `진단 자료 만들기` button fills a read-only textarea from `getReport()`, and `오류 기록 지우기` calls `clear()` and then records the current connection state again, so the on-screen sync status and the report do not disagree. The diagnostic textarea and JSON do not contain input values, raw translation text, or file names, and the examples do not save or send the JSON. The create, review, and clear flow is included in browser verification for all four examples.

Recorder lifetime follows the framework. React creates it with a `useState` lazy initializer so one recorder survives StrictMode's double render; Svelte creates it as a component-instance `const`; SvelteKit creates it as a shared layout-instance `const` and does not put it at module scope. As a result, SPA navigation from `/` to `/about` within the layout preserves panel input and the diagnostic data string, while leaving the layout for `/plain` and returning creates a new recorder.

Environment metadata is injected with Vite `define`. Vanilla reads core and vite versions in its own Vite config; React and Svelte read core, vite, and the relevant adapter versions in `examples/shared/support-environment.mjs`. The development and build Node version is injected as well. SvelteKit is an independently installed consumer, so it reads versions from installed package `package.json` files in `node_modules`.

`npm run verify:pack:sveltekit` has two modes. Local mode copies `examples/sveltekit` as the consumer and runs through support-check. `--registry-version` mode compares the SHA-512 of five approved release tarballs with `releases/<version>.json` and uses `scripts/pack-fixtures/sveltekit-registry` as the consumer. This fixture is a snapshot of 20 files at source revision `d26506ff78076b282033895f3966fb97dc86306c` (metadata in `fixture.json`) and uses only published contracts, so it has no new API and skips support-check.

The verified scope is these four examples. This document does not claim that other examples support it.

### Normal recovery and reset

The recorder keeps its history when the development server reconnects or a translation file is restored. This allows later tracing of which diagnostics occurred before and after recovery. Reset happens only through `clear()`. `clear()` empties the event buffer, the latest `syncState`, and the `omittedEvents` counter together. Because it also clears state, an app that keeps showing status should call `onSyncState` with the current state after clearing.

## Reproducing the cause

A report does not contain raw error wording, file names, or message keys. A report alone therefore cannot reproduce the same failure exactly. If reproduction is needed, write a minimal synthetic translation in Saylo's flat catalog format in the inquiry body. It is a short example that carries only the structure that caused the problem, not actual user wording.

Saylo catalog files list keys flat in `locales/<locale>/<namespace>.json`. For an `INVALID_ICU` diagnostic, for example, put invalid ICU in the base locale.

`locales/ko/demo.json`

```json
{ "countLabel": "{count, plural, invalid}" }
```

`locales/en/demo.json`

```json
{}
```

This makes the ICU syntax in `countLabel` invalid and produces `INVALID_ICU`. Missing-type diagnostics such as `MISSING_MESSAGE` may not occur in the default behavior because the plugin falls back to the base locale value, so to reproduce that code, also include the production build condition `requireCompleteTranslations: true` in the inquiry body.

Use generic keys such as `demo` instead of real key names in synthetic examples, and do not include personal information or real service wording.

## Public channels

See [support guide](../SUPPORT.md) for general inquiries and feature proposals, and [security guide](../SECURITY.md) for private security reports. The contact is the email on the maintainer's public GitHub profile, and data is not sent automatically. Review the material for personal information and secrets before submitting. This guide and the metadata changes are included in alpha.5.

## Evidence

This document was written after reading the following.

- `packages/vite/src/support-report.ts`: implementation contract.
- `packages/vite/src/client.ts`: export list and `onDiagnostic` connection point.
- `packages/vite/src/lazy-connection.ts`: forwarding of `onDiagnostic` on the lazy path.
- `packages/vite/src/types.ts`: `LiveDiagnostic`.
- `packages/vite/src/dev-sync.ts`: `DevSyncState` and retry policy.
- `packages/core/src/types.ts`: `DiagnosticCode`, `SourcePosition`, and `CatalogDiagnostic`.
- `examples/vanilla/vite.config.mjs`, `examples/vanilla/main.js`, and `examples/vanilla/index.html`: environment injection and review UI.
- `docs/dev-sync-state.md` and `packages/vite/README.md`: sync state labels and publication status.

Published build state and code details change over time. Actual behavior follows the current code in `packages/vite/src` and the current `packages/vite/README.md`.

