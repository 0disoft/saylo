# 09. Release

Alpha.7 was published on 2026-10-25. The [release record](../releases/0.1.0-alpha.7.md), [CI run](https://github.com/0disoft/saylo/actions/runs/40187216309), and [approved manifest](../releases/0.1.0-alpha.7.json) record publication of all five packages and registry download integrity. Existing translator/store/Svelte call signatures remain compatible. The alpha.6 results below remain historical evidence.

Alpha.6 was published on 2026-10-25. The five public packages use `0.1.0-alpha.6`; Vue stays private at alpha.4. The [CI release](https://github.com/0disoft/saylo/actions/runs/40131860171) and [CI-approved manifest](../releases/0.1.0-alpha.6.json) record publication and artifact integrity. The [alpha.6 release record](../releases/0.1.0-alpha.6.md) records the completed registry acceptance. The published alpha.5 [release record](../releases/0.1.0-alpha.5.md) and [manifest](../releases/0.1.0-alpha.5.json) remain as historical evidence.

This is the runbook for Saylo's distribution targets and release process. The first version, `0.1.0-alpha.1`, was published on 2026-10-06. A pre-publication workflow dry-run dispatch succeeded on GitHub `main` at `3953f24` (run [37467769385](https://github.com/0disoft/saylo/actions/runs/37467769385), 46 seconds, Ubuntu 24.04, Node 24.21.0); the actual publish step was skipped then.

## Confirmed details

The previous published version was `0.1.0-alpha.5`. Its five packages passed CI publication and registry acceptance; details are in the [release record](../releases/0.1.0-alpha.5.md), and approved integrity is in the [manifest](../releases/0.1.0-alpha.5.json). Earlier releases and the publication and authentication results below are retained as records from their respective times.

The change scope, promotion, publication, and rollback procedure for the alpha.5 release are in the [alpha.5 plan](../releases/0.1.0-alpha.5-plan.md). Before promotion, source versions stayed at alpha.4 while alpha.5 was validated in temporary candidates; the 2026-10-25 release supersedes that preparation state. The 2026-10-12 [documentation check](../review/release-alpha5-documentation-acceptance-2026-10-12.json) covers a local pack of the latest source containing candidate guidance; it distinguishes that work from the earlier alpha.5 candidate and the actual registry alpha.4. Registry checks after alpha.5 also verify the synchronization-state and support-diagnostic APIs and the accompanying documentation. The new SvelteKit check used the pinned `sveltekit-registry-alpha5` example, while existing alpha.1–4 verification paths remain ([readiness verification](../review/registry-consumer-contract-acceptance-2026-10-12.json)). Recheck the release with `verify:registry:alpha5` and `verify:registry:sveltekit:alpha5`.

Full-translation checking has been present since `0.1.0-alpha.3`, and React and Svelte selectors since `alpha.4`. The current release commands use alpha.7. Local `.release/npm/` candidates are gitignored, and approved records come from successful CI artifacts. Both `npm run verify:registry:alpha6` and `npm run verify:registry:sveltekit:alpha6` exited 0 against the published alpha.6 artifacts.

On 2026-10-08, `@0disoft/saylo-svelte` was added to the local release list. The four-package publication and authentication record below is from the original release on 2026-10-06. The current local pack, publication plan, and OIDC targets cover five packages, while `verify:registry` checks only the four packages in the existing `alpha.1` manifest. Detailed scope is in [38-svelte-adapter.md](38-svelte-adapter.md).

| Item | Decision |
| --- | --- |
| License | Apache-2.0. Include the root `LICENSE` and `NOTICE` in distributed tarballs |
| First version | `0.1.0-alpha.1` |
| dist-tag | `alpha` |
| Distributed packages | `@0disoft/saylo-core`, `@0disoft/saylo-react`, `@0disoft/saylo-svelte`, `@0disoft/saylo-typegen`, and `@0disoft/saylo-vite` |
| Root package | `saylo-workspace` remains `private` |
| publishConfig | `access: public`, `tag: alpha`, `registry: https://registry.npmjs.org/` |
| Node | `engines.node` is `24.x`. The local verification environment uses Node 24.18.0 |
| TypeScript | Verified against version 7. `typescript` is not forced as a peer |
| Peer requirements | react 19, svelte 5, vite 8 |
| Runtime | core, react, and svelte target ES2022 browsers and do not depend on Node APIs. typegen and vite run in Node |
| provenance | Publish with `--provenance=false` while the repository is private. Use true when it is public |

On 2026-10-06, four packages were published as `0.1.0-alpha.1` with dist-tag `alpha`. In public metadata, `latest` points to the registration placeholder `0.0.0-stage` for all four packages, and `alpha` points to `0.1.0-alpha.1`. Install with `@alpha`, for example `@0disoft/saylo-core@alpha`. The alpha policy remains; `latest` is not changed and nothing is unpublished.

## Version and tag contract

- Published versions use committed manifest values unchanged. The workflow does not rewrite versions. It fails if the dispatch `version` differs from any release-target `version` in `packages/*/package.json`.
- Versions use `x.y.z` or `x.y.z-alpha.N`, `-beta.N`, or `-rc.N`.
- Tags are `alpha`, `next`, and `latest`. Prereleases cannot use `latest`, and stable releases cannot use `alpha`.
- Workspace-internal dependencies (`@0disoft/saylo-*`) use exactly the same version.

## Local verification commands

```sh
npm run release:check -- --version 0.1.0-alpha.7 --tag alpha
npm run check
npm run release:pack
```

`release:check` checks that the root is `private`, packages are not `private`, and `license`, `engines`, `publishConfig`, internal dependency versions, and the five packages' `LICENSE` and `NOTICE` files match. `check` runs builds, workspace tests, consumer type checks, typegen, and React TS checks. The Svelte demo build runs separately with `npm run build:svelte`. `release:pack` builds, installs the five tarballs into JS and TS consumer apps outside the repository for verification, and on success leaves the tarballs and `manifest.json` (`name`, `version`, `filename`, `integrity`) in `.release/npm/`. `.release/` is gitignored.

The `packages/vite` build generates install-time `docs/` from the original user documentation. `release:pack` with `--ignore-scripts` packages that build output as-is and checks all 13 documentation files for missing or unexpected files, differences from the source, and links to internal files after installation. `npm run build:docs` and `npm run verify:docs` generate and compare only the documentation. Runnable code blocks are preserved; external URLs and heading fragments are outside the file-existence check. This bundled change is in the local preparation state and is absent from the existing public alpha.4.

Compare the published artifacts with `npm run verify:registry`. The current command runs `pack-smoke.mjs --registry --registry-version 0.1.0-alpha.1` and compares the four package versions and SHA-512 integrity in the committed [releases/0.1.0-alpha.1.json](../releases/0.1.0-alpha.1.json) with registry metadata and downloaded tarballs. Current source versions and the moving `alpha` tag are not used to judge historical files. Install metadata and README examples are checked against the actual published build; APIs absent from alpha.1 such as `/runtime`, `freezeCatalogs`, and Svelte are not required. It installs registry tarballs into JS/TS apps outside the repository and checks CLI, checkJs/TS, runtime SSR, public subpaths, and the Vite production lazy chunk. New approved JSON records integrity from an actual CI artifact; local candidate tarballs do not overwrite existing approved records. For the published five-package `alpha.6`, `npm run verify:registry:alpha6` checks [releases/0.1.0-alpha.6.json](../releases/0.1.0-alpha.6.json), and `npm run verify:registry:sveltekit:alpha6` verifies a SvelteKit app against that published build. Both exited 0. Alpha.3 through alpha.5 verification is also retained, and the existing `alpha.1` and `alpha.2` commands remain unchanged.

## GitHub Actions workflow

[release.yml](../.github/workflows/release.yml) accepts manual dispatches only.

| Input | Value |
| --- | --- |
| `version` | Exact committed version string. Default `0.1.0-alpha.7` |
| `dist_tag` | `alpha`, `next`, or `latest`. Default `alpha` |
| `publish` | boolean. Default `false` |
| `verify_oidc` | boolean. Default `false`. When `true`, verify the OIDC token exchange for all five Trusted Publishers before validation or publication |

A single job runs only on Ubuntu, Node 24, npm 11, on `main`, in repository `0disoft/saylo`. Its environment is `npm-release`; permissions are `contents: read` and `id-token: write`. The sequence is `release:check` → `npm ci` → `check` → `release:pack` → `release:publish` (dry run) → artifact upload. It publishes with `release:publish --publish` only when `publish` is true. Publish order is core → react → svelte → typegen → vite, and it uses no registry secret such as `NPM_TOKEN`.

`verify_oidc` is independent of publication. When `true`, `release:oidc` obtains a GitHub OIDC token with the `npm:registry.npmjs.org` audience and verifies the five current release target packages through npm's official package-scoped token exchange API at [api-docs.npmjs.com](https://api-docs.npmjs.com/) (`.../oidc/token/exchange/package/@0disoft/saylo-<id>`). It does not change package versions, publication, or tags and does not print or store the token. The helper's three local tests (guard, successful exchange protocol, and secret-leak prevention in logs and errors) and actual registry token exchange all passed. On 2026-10-06, [run 37471573758](https://github.com/0disoft/saylo/actions/runs/37471573758) completed token exchange for four packages, all 143 tests, type checks, and pack consumption verification in 42 seconds.

The `npm-release` environment exists on GitHub and has no protection rules. Dry-run 37467769385 passed 140 tests, consumer type checks, JS/TS packed consumers, and the `release:publish` dry run, and uploaded four tarballs as artifact `saylo-npm-0.1.0-alpha.1`. The tarballs downloaded with `gh run download 37467769385 --name saylo-npm-0.1.0-alpha.1 --dir .release/bootstrap` had SHA-512 hashes matching the originals.

The publish script explicitly passes `--provenance=${NPM_CONFIG_PROVENANCE}`, and the workflow sets that value from `github.event.repository.private`. `0disoft/saylo` is currently PRIVATE, so it publishes with provenance disabled. npm's official documentation says provenance is unsupported for private repositories. It turns on automatically if the repository becomes public. This procedure does not change repository visibility.

## Local distribution candidate

The latest candidate reconciled 973 inputs at `b39b3fd` and passed all 256 tests, five tarballs, and SvelteKit SSR/Chromium consumption. The version-bump patch was not applied to the original. Candidate files and hashes are recorded in [candidate refresh record](../review/release-alpha5-candidate-refresh-2026-10-12.json). The `5d90701` record below is from the first execution.

To review the next version without bumping the original, first commit related changes, then run:

```sh
npm run release:candidate -- --version 0.1.0-alpha.5
npm run release:candidate:verify -- --candidate .release/candidate-0.1.0-alpha.5-<generated-suffix>
```

The first command archives the committed HEAD at `.release/candidate-<version>-<suffix>/source.zip` and extracts it into `source/`. In that copy, only the five package.json files, internal dependencies, and workspace lockfile entries are changed to the proposed version. Original package.json, lockfile, and existing `.release/npm` are retained. It does not create a candidate if tracked files have uncommitted changes or Git symlinks exist. Untracked files are excluded. The current command prepares an `alpha` dist-tag candidate.

The verification command compares every input in the source commit with Git objects and rejects differences other than the version changes. In the copy, it runs `npm ci --ignore-scripts`, full `check`, `release:check`, independent JS and TS tarball consumption, and a publication-plan dry run. It compares inputs at start and finish and verifies actual tarball SHA-512 values against the manifest. It writes five tgz files, the manifest, input SHA-256 values, per-command logs, and `validation.json` into a new `validation-<suffix>/`. On failure, it records `failure.json` and the relevant logs and does not mark the result as successful. Because verification uses a new result directory, earlier results remain.

These results are evidence for a local candidate. `source.zip` is the original commit before version changes, and the tarballs use the proposed version; this does not mean publication or registry acceptance. Original version promotion, push, workflow dispatch, OIDC, and publishing are separate steps. Before publication, update README public/unpublished labels and release documentation for the final version, then rebuild artifacts from the final commit. SvelteKit browser and assistive-technology verification are not part of this command.

In the local run on 2026-10-12, the alpha.5 candidate reconciled all 937 inputs at `5d90701` and passed the checks above. Results for five tarballs, inputs and log hashes, and two tool regression cases are in [candidate verification record](../review/release-candidate-acceptance-2026-10-12.json). The product source baseline for this candidate is `5d90701`; candidate tooling added afterward was checked by separate regression tests. Public delivery has not been completed.

## Trusted Publisher

Register one for each package. Use the same registration values for every package. The original four packages and Svelte are all registered. Svelte's save and retrieval results on 2026-10-09 are in the registration record below, and on the same day CI verified actual OIDC exchange for all five packages.

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `0disoft` |
| Repository | `saylo` |
| Workflow file | `release.yml` |
| Environment | `npm-release` |
| Allowed action | Allow `npm publish` |

Use only `release.yml`, including the extension, for the workflow file; do not include the `.github/workflows/` path. Follow npm's official [Trusted publishing](https://docs.npmjs.com/trusted-publishers/) documentation; the same settings can be made with the `npm trust` CLI. All four original packages were configured with `npm trust github` and confirmed identical with `npm trust list`. Before publication, unauthenticated package metadata fetch on the public registry returned 404, while authenticated `npm view` showed the `0.0.0-stage` placeholder.

## Initial registration procedure

This is the sequence used to register four names on `registry.npmjs.org` and configure Trusted Publisher. It uses npm 11 staged publishing and `npm trust` ([staged publishing](https://docs.npmjs.com/staged-publishing/), [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/)). A person completes browser 2FA and approval.

```sh
gh run download 37467769385 --name saylo-npm-0.1.0-alpha.1 --dir .release/bootstrap
npm login --auth-type=web
npm whoami   # -> 0disoft
npm stage publish .release/bootstrap/0disoft-saylo-<id>-0.1.0-alpha.1.tgz --access public --tag alpha --provenance=false --ignore-scripts
npm trust github @0disoft/saylo-<id> --file release.yml --repo 0disoft/saylo --env npm-release --allow-publish --yes
npm trust list @0disoft/saylo-<id>
```

`<id>` is `core`, `react`, `svelte`, `typegen`, or `vite`, and is applied to that ID when registering a new package. The initial release submission record below applies to the original four packages. `npm stage publish` registers the public placeholder `0.0.0-stage`; the actual `0.1.0-alpha.1` content is not public until approval. `npm trust` works only when the package already exists in the registry and 2FA is enabled on the account.

### Svelte registration progress record

On 2026-10-08, using account `0disoft`, the locally verified `.release/npm/0disoft-saylo-svelte-0.1.0-alpha.2.tgz` was submitted to staging. Before submission, its SHA-512 was checked against the candidate manifest, and `npm stage list @0disoft/saylo-svelte --json` returned the following values.

| Item | Value |
| --- | --- |
| Stage ID | `4cd95172-ad66-4bc1-9cc5-b0fc968b1dee` |
| Package | `@0disoft/saylo-svelte` |
| Version / tag | `0.1.0-alpha.2` / `alpha` |
| Status | `staged` |
| Access / actor | `public` / `0disoft` |
| SHA-1 | `f1d4985ff0c2be9ad20a4760c915ff86716f38a7` |

Immediately after staging, no approval or publication of the actual version and no changes to published versions or tags of the original four packages were performed. At the time, `npm view` returned 404, so the public placeholder could not be confirmed visible. The following is the current state retrieved later.

On 2026-10-09, the first authenticated check completed with 404, so the configuration request was run again. After new browser 2FA, `npm trust github @0disoft/saylo-svelte --file release.yml --repo 0disoft/saylo --env npm-release --allow-publish --yes` succeeded with exit 0. `npm trust list @0disoft/saylo-svelte --json` also exited 0 and returned the same saved values.

| Trusted Publisher item | Retrieved value |
| --- | --- |
| ID | `f9181faf-2907-4a6c-9956-520689d25568` |
| Type / repository | `github` / `0disoft/saylo` |
| File / environment | `release.yml` / `npm-release` |
| Permissions | `createPackage`, `createStagedPackage` |

The stage list at the same time was empty, and the public registry returned HTTP 200 with `0.0.0-stage` and `0.1.0-alpha.2`. Tags were `latest: 0.0.0-stage` and `alpha: 0.1.0-alpha.2`. Public Svelte `alpha.2` metadata integrity and downloaded tarball SHA-512 matched the verified local candidate. This work did not run a stage approve command, so the approval path and executing actor were not verified.

When Svelte was registered, core, react, typegen, and vite were on `alpha.1`. This step did not perform a new CI publish, OIDC exchange, or remote push. The later full `alpha.2` release result is recorded below.

### Original four-package registration history

Authentication used `npm login --auth-type=web`. `npm whoami` returned `0disoft`, and profile `tfa` was `auth-only`. After verifying CI tarball SHA-512 values, `npm stage publish` was submitted for four packages; `npm stage list` showed all four stages as `staged`. `npm trust github` succeeded for all four, and the user completed browser 2FA. `npm trust list` exited 0 for all four and confirmed identical repository `0disoft/saylo`, file `release.yml`, environment `npm-release`, and permissions `['createPackage','createStagedPackage']`. Before publication, authenticated `npm view @0disoft/saylo-core versions --json` returned `["0.0.0-stage"]`, confirming the placeholder. On 2026-10-06, the four packages were then published as `0.1.0-alpha.1`.

| Package | staged id | trust id |
| --- | --- | --- |
| `@0disoft/saylo-core` | `f6cad51f-166d-41da-bd39-2037f8b9c6a4` | `908f7eaf-0b2b-4d03-96a2-c095f2894475` |
| `@0disoft/saylo-react` | `ac9fff89-9f32-4f8f-aa80-b943c1b89051` | `52f2679c-c880-43bf-8056-1b59c8399f9d` |
| `@0disoft/saylo-typegen` | `9c7e9fc7-37d9-453b-8e4b-4edab04a5829` | `08b6515a-ef84-4f60-a00e-4a44cf15e35f` |
| `@0disoft/saylo-vite` | `e82284c6-7867-40b2-a996-4ad39835e2c8` | `bbc6a339-cbf2-4b47-8296-0a2199799e64` |

## Publication failure and rerun

Publication is not atomic. If it fails midway, only packages already uploaded remain, and there is no automatic rollback. On rerun, already published versions are skipped only when both tarball integrity and the requested dist-tag match. A different integrity fails; a different registry tag exits with an error (changing the tag is a separate request). Do not delete the same version; publish a new patch version. A skip caused by matching integrity and tag does not indicate successful OIDC authentication. Verify authentication separately with a `verify_oidc=true` and `publish=false` dispatch.

## Post-publication verification results

- `0.1.0-alpha.1` was published through stage approval on 2026-10-06. Four package versions and the `alpha` tag were confirmed on the public registry, and `npm run verify:registry` passed.
- A `verify_oidc=true` and `publish=false` dispatch verified actual OIDC token exchange for four Trusted Publishers. The first run, [37471215141](https://github.com/0disoft/saylo/actions/runs/37471215141), failed at response validation; after changing it to validate the token as returned by the npm CLI, [37471573758](https://github.com/0disoft/saylo/actions/runs/37471573758) passed.
- The placeholder `0.0.0-stage` and unauthenticated 404 are pre-publication retrieval records. The alpha policy remains; `latest` was not changed and nothing was unpublished.
- Trusted Publisher was configured for all four packages (`npm trust github`) and `npm trust list` confirmed matching values. The `npm-release` environment exists and has no protection rules.
- The workflow ran with `publish=false`, so the actual package publication step was skipped. The first alpha publication proceeded through user stage approval. OIDC authentication and actionlint checks passed.
- CI verification: `npm run check` passed 143 tests (the existing 140 plus 3 OIDC helpers) and consumer type checks on Node 24.21.0. Locally, the 3 OIDC helpers and registry consumption verification were run on Node 24.18.0. `release:pack` with final READMEs also passed. It verified LICENSE, NOTICE, and metadata matching in the four tarballs, README example execution and type checks, and CLI, translation, React SSR, and Vite 8.3.3 lazy chunks in external JS and TS consumer apps. `npm run verify:registry` exited 0 after confirming the four published versions, `alpha` tag, and integrity in [releases/0.1.0-alpha.1.json](../releases/0.1.0-alpha.1.json), and checking registry tarballs' CLI, checkJs/TS, runtime SSR, public subpaths, and Vite production lazy chunk. The `release:publish` dry run and actionlint also passed. Tampered tarballs are rejected for SHA-512 mismatch, and `--publish` outside GitHub Actions is rejected before registry lookup.
- The step that actually publishes a new version from CI had not yet run. This verification covered OIDC authentication only; actual CI publishing would be verified on the next intentional version release.
- The performance p95 targets were still not met and are recorded in [Validation and Roadmap](06-validation-and-roadmap.md). The release gate is passing the three commands above and does not include performance measurement.

## 2026-10-09 alpha.2 publication completed

[Run 37804205176](https://github.com/0disoft/saylo/actions/runs/37804205176) ran on `main` at `c36ff13` with `publish=true` and `verify_oidc=true`. On Node 24.21.0, npm 11, and Ubuntu, it passed authentication of five Trusted Publishers, 181 tests and consumer type checks, external tarball verification, and artifact upload. It completed in 1 minute 16 seconds and published core, react, typegen, and vite. Svelte was skipped after confirming the same publication file and tag.

The CI artifact manifest was recorded in [releases/0.1.0-alpha.2.json](../releases/0.1.0-alpha.2.json). The `alpha` tag, metadata, and downloaded tarball SHA-512 match for all five public versions. Initially, React and typegen metadata and download URLs returned 404, but without republishing they became retrievable and downloadable, and consumption verification was completed. The cause is not established.

`npm run verify:registry:alpha2` verifies JS/checkJs, TS, README examples, core runtime, React/Svelte SSR, typegen CLI, and the Vite lazy build with parser removal using the five actually published packages. `npm run verify:registry:sveltekit` installs a SvelteKit app from the same approved registry file and verified zero type errors and warnings, client and SSR builds, per-request SSR, boot, and connection lifetime, production Node HTTP, and HeadlessChrome 154 hydration, ko/en/ko switching, input and open-modal retention, exit, and re-entry. No runtime errors or warnings were reported. The existing four-package `alpha.1` `npm run verify:registry` also passed. Temporary servers, browsers, and consumer apps were cleaned up.

## 2026-10-09 alpha.3 publication completed

[Run 37935637066](https://github.com/0disoft/saylo/actions/runs/37935637066) ran on `main` at `534a912` with `publish=true` and `verify_oidc=true`. On Node 24.21.0, npm 11, and Ubuntu, it passed authentication of five Trusted Publishers, 185 tests (core 75, react 9, svelte 5, typegen 8, vite 83, release helpers 5; 0 failures), consumer type checks, pack verification, a publication dry run, artifact upload, and actual publication. The release job ran from 22:16:13 to 22:17:35 KST, completing in 1 minute 22 seconds; it published all five packages with no skips.

The CI artifact manifest was recorded in [releases/0.1.0-alpha.3.json](../releases/0.1.0-alpha.3.json). The `alpha` tag, metadata, and downloaded tarball SHA-512 match for all five public versions, and `latest` remained at placeholder `0.0.0-stage`. Immediately after publication, public metadata pointed to `alpha.2` and the `alpha.3` version endpoint returned 404, but without republishing they became retrievable and downloadable. The cause is not established.

`npm run verify:registry:alpha3` exited 0 after verifying approved integrity, external installation of actual tarballs, README examples, JS/checkJs and TS, typegen CLI, core runtime, React/Svelte SSR, public subpaths, the Vite lazy build with parser removal, and JS/TS consumption of new full-translation fixtures (default fallback, missing key and namespace diagnostics, retention of existing types, and build after correction). `npm run verify:registry:sveltekit:alpha3` installed a SvelteKit app from the same approved registry file and passed zero type errors and warnings, client and SSR builds, per-request ko/en SSR and boot with canonical/base fallback, dev connection lifetime (listener cleanup, idempotent stop, late-connection cancellation), production Node HTTP, and HeadlessChrome 154 hydration, ko/en/ko switching, retention of shared-layout input and modal state, exit, and re-entry. Temporary apps, servers, and browsers were cleaned up in `finally`. Earlier `alpha.1` and `alpha.2` verification was not repeated in this run. There were no new performance measurements or `examples/npm` lockfile changes.

## Current source local verification on 2026-10-11

Separately from publication approval and remote state, the following local checks exited 0 for current source `0f7840f` (product `eb66af8`). Evidence is in [review/local-readiness-2026-10-11.json](../review/local-readiness-2026-10-11.json) (86 input hashes, record `38ee9be`) and [local release readiness](77-local-release-readiness.md).

- `npm run check`: five-package builds and unit tests, five JS/TS consumption cases, the React example, and OIDC and registry unit checks.
- `npm exec -- node scripts/pack-smoke.mjs`: independent installs of five tarballs, CLI, typegen and README examples, Node translation and argument rejection, React SSR, React and Svelte selector SSR, Vite production lazy loading, full-translation rejection and recovery, and SSR after removing development dependencies (observed with Vite 8.3.4).
- `npm exec -- node scripts/pack-sveltekit.mjs`: independent five-tarball install, svelte-check with 0 errors and 0 warnings, Vite 8.3.4 production Node and client builds, simultaneous ko/en SSR with matching boot and canonical fallback, listener cleanup and runtime cancellation, production HTTP, Chromium 154 hydration, ko→en→ko switching, shared-layout state retention, exit, and re-entry.

This pack is a local proof combining unpublished follow-up code with `0.1.0-alpha.3` metadata; it is not the published `alpha.3` artifact. Selector public APIs are implemented in current source and verified with the local pack, but they are absent from the published build. The pack scripts cleaned up temporary tarballs, apps, browsers, and servers, and did not update the approved [releases/0.1.0-alpha.3.json](../releases/0.1.0-alpha.3.json) file or `.release/`.

Remote verification (release `version` and CI approval, `verify_oidc` token exchange, and `verify:registry:alpha3` registry comparison) is separate from this local check. External CI and OIDC verification were not run for the current HEAD.

## Dependency vulnerability checks

Existing release work runs `npm run audit:dependencies` after `npm ci` to query npm advisories for development and runtime dependencies in the root lockfile. A failed lookup or any reported vulnerability at low severity or higher stops the next step. No separate CI job was added, and remote execution has not been verified. [Dependency updates](dependency-updates.md) records the bot policy, update-PR check commands, and lookup scope.
