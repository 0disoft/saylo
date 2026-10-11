# 의존성 갱신

이 문서는 Saylo의 의존성 갱신 규칙(`renovate.json`), 로컬 갱신 절차, 경로별 확인 명령, CI 연결 범위를 정한다. 관측일은 2026-10-12이다.

## 현재 상태

- 저장소에 추적되는 Renovate 설정은 없었고, 이번에 `renovate.json`을 로컬에서 작성했다.
- 원격 Renovate Dependency Dashboard 이슈는 <https://github.com/0disoft/saylo/issues/1>이다. 이 이슈에는 `@types/node` 24.19.2, `vite` 8.3.4 같은 메이저 패치도 승인 대기로 올라와 있었다.
- Dependabot은 추가하지 않는다. 같은 저장소를 두 봇이 중복 관리하지 않도록 `.github/dependabot.yml`을 두지 않는다.
- 확인하지 않은 것: 봇 실행과 활성화, 푸시, PR 생성, 새 설정이 대시보드에 반영되는지. 봇의 전역·상속 설정이 이 저장소 설정을 덮을 수 있다.

## renovate.json

- 기본값은 `dependencyDashboard: true`, `dependencyDashboardApproval: true`, `automerge: false`, `prConcurrentLimit: 2`, `prHourlyLimit: 1`, `timezone: "Asia/Seoul"`이다.
- minor·patch(npm): `rangeStrategy: "in-range-only"`라 지금 선언한 메이저 범위 안에서 lock만 올린다. 갱신은 `npm compatible updates` 한 PR로 묶고 대시보드 승인 없이 만든다. 시각은 `* 0-5 1 * *`, 곧 매월 1일 00:00~05:59(KST) 창이다.
- `lockFileMaintenance`: 켜고 같은 매월 창에 돌린다. 승인은 요구하지 않는다.
- major: 대시보드 사전 승인이 필요하다(`dependencyDashboardApproval`). 승인은 승인일 뿐이고 호환 검사 통과를 뜻하지 않는다. 호환 검사와 채택은 별도 단계다.
- `@0disoft/saylo-*`: `enabled: false`다. 다섯 패키지는 릴리스에서 같은 버전으로 묶여 나가므로 봇이 버전을 흔들지 않는다. 갱신은 별도 승인 릴리스와 registry 검증으로 한다. `examples/npm`이 쓰는 게시 태그 `alpha`도 그대로 둔다. 다만 lock을 새로 만들면 그 태그가 가리키는 새 게시본을 선택할 수 있으므로, 해당 lock 변경은 npm 예제 검증으로 확인한다.

## SvelteKit의 TypeScript

`examples/sveltekit`은 `typescript` 6을 쓰고 루트는 7이다. TS 7 승격은 peer·플러그인 호환 조건에 달려 있어 수동으로 검증한다. 봇이 이 판단을 대신하지 않는다.

## 경로별 확인 명령

| 바뀐 경로 | 확인 명령 |
| --- | --- |
| 루트 `package.json`·`package-lock.json`, `packages/*` | `npm run check` |
| `examples/npm` | `npm run verify:demo:npm` |
| `examples/sveltekit` | `npm run build:sveltekit && npm run verify:sveltekit` |
| `benchmarks/*` | 그 폴더 `README.md`의 명령 |

벤치마크를 바꾸면 해당 폴더 README의 스크립트를 쓴다. `npm run check`가 벤치마크를 덮는다고 적지 않는다.

## 로컬 갱신 절차

1. 이름을 지정해 범위 안에서 올린다. 예: `npm update @formatjs/icu-messageformat-parser intl-messageformat --ignore-scripts --no-audit --no-fund`
2. `npm audit`은 따로 돌린다. 갱신한 디렉터리마다 확인한다.
3. 위 경로별 확인 명령을 돌린다.
4. `npm audit fix --force`로 메이저를 올리지 않는다. major는 대시보드 승인과 별도 호환 검사로 다룬다.

## audit:dependencies와 CI

- `npm run audit:dependencies`는 `scripts/audit-dependencies.mjs`를 돌린다. 이 스크립트가 `npm audit`을 호출하고, 루트 lock 전체의 build·runtime 의존성을 registry advisory 기준으로 조회한다. `--audit-level=low`를 명시해 low 이상에서 실패한다. 허용 목록은 두지 않는다.
- helper를 두는 이유: `npm run`은 `.npmrc`의 allow-scripts를 `npm_config_allow_scripts` 환경 변수로 넘기는데, 최신 npm은 프로젝트 명령에서 그 플래그를 거부한다(`EALLOWSCRIPTS`). 그래서 그 키 하나만 환경에서 빼고 `npm_execpath`가 가리키는 npm CLI를 Node로 실행한다.
- 설치나 패키지 스크립트는 실행하지 않고, audit의 exit 코드를 그대로 전달한다. `npm run audit:dependencies`는 로컬에서 exit 0, 취약점 0건이다.
- `.github/workflows/release.yml`은 `npm ci` 다음에 이 단계를 둔다. 새 CI job이나 워크플로는 추가하지 않았다.
- 이 단계는 실제 CI에서 아직 돌지 않았다. 있는 기록은 로컬 실행뿐이다.
- advisory 조회는 코드 보안 스캔이 아니다. 결과가 깨끗해도 관측 시점의 registry 공지 기준이라는 뜻이다.
- `npm run check`에는 network audit을 넣지 않았다. offline에서 도는 검사를 그대로 유지하려고 audit을 별도 명령으로 둔다.

## 이번 갱신 기록 (2026-10-12, `ea69df3`)

| lock 파일 | 패키지 | 전 → 후 |
| --- | --- | --- |
| `package-lock.json` | `@formatjs/icu-messageformat-parser` | 3.5.20 → 3.5.21 |
| `package-lock.json` | `intl-messageformat` | 12.1.2 → 12.1.3 |
| `package-lock.json` | `@types/node` | 24.19.1 → 24.19.2 |
| `package-lock.json` | `vite` | 8.3.2 → 8.3.4 |
| `examples/npm/package-lock.json` | `vite` | 8.3.3 → 8.3.4 |
| `examples/sveltekit/package-lock.json` | `@types/node` | 24.19.1 → 24.19.2 |

매니페스트의 범위는 바꾸지 않았고 lock만 갱신했다. 메이저 승격과 릴리스 버전 변경은 없다.

검증은 세 명령 모두 통과했다. `npm run check`, `npm run verify:demo:npm`(npm example production build와 lifecycle 회귀 3건), `npm run build:sveltekit && npm run verify:sveltekit`(svelte-check 0 errors·0 warnings, production client·SSR build, 동시 ko/en SSR, listener 정리). `npm audit`은 루트·`examples/npm`·`examples/sveltekit` 모두 exit 0에 취약점 0건이고 개발 의존성을 포함한 수치다. 기록은 [review/dependency-refresh-acceptance-2026-10-12.json](../review/dependency-refresh-acceptance-2026-10-12.json)에 있다.

## renovate.json 검사 범위

`renovate.json`은 공식 JSON schema로만 검사했다. Ajv CLI 5에서 draft-07, `strict: false`로 valid를 받았다. 이 검사가 보는 것은 schema 정합성이다.

- 공식 schema가 참조하는 정규식(`format`) 규칙은 이 검사에서 쓰지 않아 그 부분은 확인하지 않았다.
- 봇의 semantic 검사, 전체 config validator, dry run은 아니다. 설정이 실제로 어떻게 동작하는지는 확인하지 않았다.
- 그래서 여기서는 schema 검사를 통과했다는 것까지만 적는다.

## 범위

의존성 갱신은 릴리스가 아니다. 버전 승격과 게시는 [09-release.md](09-release.md)를 따른다. release workflow는 `workflow_dispatch` 전용이고 PR에 자동으로 도는 CI가 없어, 갱신 PR도 로컬·수동 검증이 필요하다. 이 문서는 로컬 설정과 로컬 검증 기록이고, 푸시·게시·봇 활성화는 포함하지 않는다.

## 근거

- `renovate.json` — 설정 원본
- `scripts/audit-dependencies.mjs` — `npm audit` 호출 helper
- [Renovate configuration options](https://docs.renovatebot.com/configuration-options/) — [`rangeStrategy`](https://docs.renovatebot.com/configuration-options/#rangestrategy), [`schedule`](https://docs.renovatebot.com/configuration-options/#schedule), [`lockFileMaintenance`](https://docs.renovatebot.com/configuration-options/#lockfilemaintenance), [`dependencyDashboardApproval`](https://docs.renovatebot.com/configuration-options/#dependencydashboardapproval)
- `.github/workflows/release.yml` — `npm ci` 뒤 `npm run audit:dependencies`, dispatch 전용
- `review/dependency-refresh-acceptance-2026-10-12.json` — 이번 패치 기록
