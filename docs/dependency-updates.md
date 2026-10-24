# Dependency updates

This document defines the rules for updating Saylo's dependencies (`renovate.json`), the local update procedure, per-path verification commands, and CI integration scope. Observation date: 2026-10-12.

## Current status

- No Renovate configuration was tracked in the repository; `renovate.json` was written locally in this change.
- The remote Renovate Dependency Dashboard issue is <https://github.com/0disoft/saylo/issues/1>. This issue also had major patches such as `@types/node` 24.19.2 and `vite` 8.3.4 waiting for approval.
- Dependabot is not added. `.github/dependabot.yml` is omitted so two bots do not manage the same repository.
- Not checked: bot execution and activation, push, PR creation, or whether the new configuration appears in the dashboard. Global or inherited bot settings can override this repository's configuration.

## renovate.json

- Defaults are `dependencyDashboard: true`, `dependencyDashboardApproval: true`, `automerge: false`, `prConcurrentLimit: 2`, `prHourlyLimit: 1`, and `timezone: "Asia/Seoul"`.
- minor and patch (npm): `rangeStrategy: "in-range-only"` updates only the lock within the currently declared major range. Updates are grouped into one `npm compatible updates` PR and created without dashboard approval. The schedule is `* 0-5 1 * *`, a window from 00:00 to 05:59 KST on the first day of each month.
- `lockFileMaintenance`: enabled and runs in the same monthly window. It does not require approval.
- major: requires prior dashboard approval (`dependencyDashboardApproval`). Approval is only approval; it does not mean compatibility checks have passed. Compatibility checks and adoption are separate steps.
- `@0disoft/saylo-*`: `enabled: false`. The five packages are released together at the same version, so the bot does not move their versions. Updates go through a separately approved release and registry validation. Keep the `alpha` publication tag used by `examples/npm` as is. However, creating a new lockfile may select a new published build that the tag points to, so validate such lock changes with the npm example check.

## TypeScript in SvelteKit

`examples/sveltekit` uses `typescript` 6, while the root uses 7. Upgrading to TS 7 depends on peer and plugin compatibility conditions and is validated manually. The bot does not make this decision.

## Per-path verification commands

| Changed path | Verification command |
| --- | --- |
| Root `package.json`, `package-lock.json`, `packages/*` | `npm run check` |
| `examples/npm` | `npm run verify:demo:npm` |
| `examples/sveltekit` | `npm run build:sveltekit && npm run verify:sveltekit` |
| `benchmarks/*` | The commands in that folder's `README.md` |

If you change benchmarks, use the scripts in that folder's README. Do not claim that `npm run check` covers benchmarks.

## Local update procedure

1. Update named packages within range. Example: `npm update @formatjs/icu-messageformat-parser intl-messageformat --ignore-scripts --no-audit --no-fund`
2. Run `npm audit` separately. Check each updated directory.
3. Run the per-path verification commands above.
4. Do not use `npm audit fix --force` to upgrade majors. Handle majors through dashboard approval and separate compatibility checks.

## audit:dependencies and CI

- `npm run audit:dependencies` runs `scripts/audit-dependencies.mjs`. This script invokes `npm audit` and queries the build and runtime dependencies in the entire root lock against registry advisories. It specifies `--audit-level=low` so that low and higher severities fail. It has no allowlist.
- The helper exists because `npm run` passes the allow-scripts setting from `.npmrc` as the `npm_config_allow_scripts` environment variable, and recent npm rejects that flag for project commands (`EALLOWSCRIPTS`). The helper removes only that key from the environment and runs the npm CLI pointed to by `npm_execpath` with Node.
- It does not install packages or run package scripts, and it passes through the audit exit code. `npm run audit:dependencies` exits 0 locally with 0 vulnerabilities.
- `.github/workflows/release.yml` places this step after `npm ci`. No new CI job or workflow was added.
- This step has not run in actual CI yet. The only record is a local run.
- Advisory lookup is not a code security scan. A clean result means only that no advisory from the registry at observation time applied.
- `npm run check` does not include a network audit. Audit remains a separate command to keep the offline checks as they are.

## Update record (2026-10-12, `ea69df3`)

| Lockfile | Package | Before → after |
| --- | --- | --- |
| `package-lock.json` | `@formatjs/icu-messageformat-parser` | 3.5.20 → 3.5.21 |
| `package-lock.json` | `intl-messageformat` | 12.1.2 → 12.1.3 |
| `package-lock.json` | `@types/node` | 24.19.1 → 24.19.2 |
| `package-lock.json` | `vite` | 8.3.2 → 8.3.4 |
| `examples/npm/package-lock.json` | `vite` | 8.3.3 → 8.3.4 |
| `examples/sveltekit/package-lock.json` | `@types/node` | 24.19.1 → 24.19.2 |

Manifest ranges were not changed; only lockfiles were updated. There are no major upgrades or release version changes.

All three verification commands passed. `npm run check`; `npm run verify:demo:npm` (npm example production build and three lifecycle regression cases); and `npm run build:sveltekit && npm run verify:sveltekit` (svelte-check with 0 errors and 0 warnings, production client and SSR build, concurrent ko/en SSR, listener cleanup). `npm audit` exited 0 with 0 vulnerabilities for the root, `examples/npm`, and `examples/sveltekit`, including development dependencies. The record is in [review/dependency-refresh-acceptance-2026-10-12.json](../review/dependency-refresh-acceptance-2026-10-12.json).

## renovate.json validation scope

`renovate.json` was checked only against the official JSON schema. Ajv CLI 5 validated it with draft-07 and `strict: false`. This check covers schema conformance.

- Regex (`format`) rules referenced by the official schema are not used by this check, so that part was not verified.
- This is not the bot's semantic check, full config validator, or dry run. It did not confirm how the configuration actually behaves.
- The document therefore claims only that schema validation passed.

## Scope

Dependency updates are not releases. See [09-release.md](09-release.md) for version promotion and publication. The release workflow is `workflow_dispatch` only and has no CI that runs automatically on PRs, so update PRs also need local and manual validation. This document covers local configuration and local validation records and does not include push, publication, or bot activation.

## Evidence

- `renovate.json`: source configuration.
- `scripts/audit-dependencies.mjs`: helper that invokes `npm audit`.
- [Renovate configuration options](https://docs.renovatebot.com/configuration-options/): [`rangeStrategy`](https://docs.renovatebot.com/configuration-options/#rangestrategy), [`schedule`](https://docs.renovatebot.com/configuration-options/#schedule), [`lockFileMaintenance`](https://docs.renovatebot.com/configuration-options/#lockfilemaintenance), and [`dependencyDashboardApproval`](https://docs.renovatebot.com/configuration-options/#dependencydashboardapproval).
- `.github/workflows/release.yml`: `npm run audit:dependencies` after `npm ci`, dispatch only.
- `review/dependency-refresh-acceptance-2026-10-12.json`: record of this patch update.
