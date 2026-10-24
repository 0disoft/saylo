# 77. Local release readiness (`0f7840f`, `eb66af8`)

Observed on 2026-10-11 (KST). This briefly records local validation against the current source. The evidence is [review/local-readiness-2026-10-11.json](../review/local-readiness-2026-10-11.json); `observedAt` is 2026-10-10T21:25:04Z and the recording revision is `38ee9be`.

## Scope

- This document records local validation. It does not cover publication, version promotion, remote CI, OIDC token exchange, or registry comparison.
- `0f7840f` is the validation baseline source, `eb66af8` is the last product code change, and `38ee9be` is the commit that stored the validation record. The JSON's `recordedAtRevision` is `abd4c8a`, the HEAD before that commit.
- Product files have not changed since, and all 86 recorded hashes were rechecked against current files.
- Hashes cover the root package and lockfile, the five packages' package manifests, source, and tsconfigs, two pack scripts, pack fixtures, and release checks. This is not an integrity manifest of every test input or entire tarball.

## Validation results

All three commands exited 0.

- `npm run check`: builds and unit tests for all five packages, five JS/TS consumer types, the React example, and OIDC and registry unit checks.
- `npm exec -- node scripts/pack-smoke.mjs`: installs the five tarballs independently outside the repository and checks the CLI, typegen, README examples, Node translation and argument rejection, React SSR, React and Svelte selector SSR, Vite production lazy loading, rejection and recovery for incomplete translations, and SSR after removing development dependencies. Observed Vite 8.3.4.
- `npm exec -- node scripts/pack-sveltekit.mjs`: independent five-tarball install; svelte-check with 0 errors and 0 warnings; Vite 8.3.4 production Node and client builds; concurrent ko/en SSR with boot agreement and canonical fallback; listener cleanup and runtime cancellation; production HTTP; and Chromium 154 hydration, ko→en→ko switching, common-layout state preservation, shutdown, and re-entry. Observed HeadlessChrome 154.0.0.0.

## Distinction from published builds

- This pack is a local proof that bundles unpublished follow-up code under `0.1.0-alpha.3` metadata. It is not the `alpha.3` artifact published to npm.
- The public selector API is implemented in current source and was validated by the local pack, but it is absent from the published build.
- Remote observation (2026-10-11): all five packages had the `alpha` tag at `0.1.0-alpha.3`, with `latest` at placeholder `0.0.0-stage`; `alpha.4` did not exist. Evidence is [review/remote-state-2026-10-11.json](../review/remote-state-2026-10-11.json). Read the date separately from the publication-validation history (2026-10-09, [release record](../releases/0.1.0-alpha.3.md)). The last successful remote run was at `534a912`, which is not the current source.
- External CI against the current HEAD and OIDC token exchange are not part of this validation.

2026-10-11 follow-up: alpha.4 CI and OIDC publication at `d26506f`, comparison of the approved manifest against registry SHA-512 values, and validation of published JS/TS, selector SSR, and SvelteKit Chromium consumers were completed ([release record](../releases/0.1.0-alpha.4.md)). The alpha.3, unpublished, and remote states above describe the earlier local validation and are not the current publication state.

## Not performed

- No version promotion, push, publication, or update to approval manifest `releases/0.1.0-alpha.3.json` or `.release/` was performed.
- Performance figures cite the local warmed, representative-condition record in [75](75-early-disk-rechecks.md); cold startup and cold conditions were not remeasured. The product architecture decision follows [76](76-runtime-decision.md).
- The pack scripts cleaned up temporary tarballs, consumer apps, browsers, and servers.
