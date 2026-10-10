# 09. 릴리스

Saylo의 배포 대상과 릴리스 절차를 정리한 runbook이다. 첫 버전 `0.1.0-alpha.1`은 2026-10-06 게시했다. 게시 전 단계였던 워크플로 dry-run dispatch는 GitHub `main` `3953f24`에서 성공했고(run [37467769385](https://github.com/0disoft/saylo/actions/runs/37467769385), 46초, Ubuntu 24.04·Node 24.21.0), 그때는 실제 게시 step을 건너뛰었다.

## 확정 사항

현행 게시 버전은 `0.1.0-alpha.4`다. 2026-10-11 다섯 패키지의 CI OIDC 인증·게시와 승인 tarball SHA-512 대조, 외부 JS/TS·selector SSR·SvelteKit Chromium 소비를 통과했다. 변경·검증은 [릴리스 기록](../releases/0.1.0-alpha.4.md), 승인 integrity는 [manifest](../releases/0.1.0-alpha.4.json)에 있다. 이전 릴리스와 아래의 게시·인증 결과는 당시 기록으로 유지한다.

`0.1.0-alpha.3`부터 완역 검사, `alpha.4`부터 React·Svelte selector를 포함한다. 아래 로컬 명령과 workflow 기본 버전은 alpha.4 기준이다. 로컬 `.release/npm/` 후보는 gitignore 대상이고, 승인 기록은 성공한 CI artifact에서 가져온다. 현행 소비 명령은 `npm run verify:registry:alpha4`·`npm run verify:registry:sveltekit:alpha4`다.

2026-10-08 로컬 릴리스 목록에 `@0disoft/saylo-svelte`를 추가했다. 아래의 네 패키지 게시·인증 기록은 2026-10-06 기존 릴리스의 기록이다. 현행 로컬 pack·게시 계획·OIDC 대상은 다섯 패키지이며 `verify:registry`는 기존 `alpha.1` manifest의 네 패키지만 검사한다. 상세 범위는 [38-svelte-adapter.md](38-svelte-adapter.md)에 있다.

| 항목 | 결정 |
| --- | --- |
| 라이선스 | Apache-2.0. 배포 tarball에 루트 `LICENSE`·`NOTICE`를 함께 싣는다 |
| 첫 버전 | `0.1.0-alpha.1` |
| dist-tag | `alpha` |
| 배포 패키지 | `@0disoft/saylo-core`·`@0disoft/saylo-react`·`@0disoft/saylo-svelte`·`@0disoft/saylo-typegen`·`@0disoft/saylo-vite` |
| 루트 package | `saylo-workspace`는 `private`를 유지한다 |
| publishConfig | `access: public`, `tag: alpha`, `registry: https://registry.npmjs.org/` |
| Node | `engines.node`는 `24.x`. 로컬 검증 환경은 Node 24.18.0 |
| TypeScript | 7을 기준으로 검증한다. `typescript`를 peer로 강제하지 않는다 |
| peer 조건 | react 19, svelte 5, vite 8 |
| 런타임 | core·react·svelte는 ES2022 브라우저 대상이라 Node API에 의존하지 않는다. typegen·vite는 Node에서 실행한다 |
| provenance | 저장소가 private인 동안 `--provenance=false`로 게시한다. 공개 저장소면 true |

2026-10-06 네 패키지를 `0.1.0-alpha.1`·dist-tag `alpha`로 게시했다. 공개 metadata의 dist-tags는 네 패키지 모두 `latest`가 등록용 placeholder `0.0.0-stage`를, `alpha`가 `0.1.0-alpha.1`을 가리킨다. 실제 설치는 `@0disoft/saylo-core@alpha`처럼 `@alpha`를 지정한다. `latest`를 바꾸거나 unpublish하지 않고 alpha 정책을 유지한다.

## 버전과 태그 계약

- 게시 버전은 커밋된 manifest 값을 그대로 쓴다. 워크플로는 버전을 다시 쓰지 않는다. dispatch `version`과 릴리스 대상 `packages/*/package.json`의 `version`이 하나라도 다르면 실패한다.
- 형식은 `x.y.z` 또는 `x.y.z-alpha.N`·`-beta.N`·`-rc.N`이다.
- tag는 `alpha`·`next`·`latest`다. prerelease는 `latest`를 쓸 수 없고 stable은 `alpha`를 쓸 수 없다.
- 워크스페이스 내부 의존(`@0disoft/saylo-*`)은 같은 버전을 정확히 지정한다.

## 로컬 검증 명령

```sh
npm run release:check -- --version 0.1.0-alpha.4 --tag alpha
npm run check
npm run release:pack
```

`release:check`는 루트 `private`, 패키지의 `private` 부재, `license`, `engines`, `publishConfig`, 내부 의존 버전, 다섯 패키지의 `LICENSE`·`NOTICE` 일치를 검사한다. `check`는 빌드·워크스페이스 테스트·소비 타입 검사·typegen·React TS 검사를 돌린다. Svelte 데모 빌드는 `npm run build:svelte`로 별도 실행한다. `release:pack`은 빌드 후 다섯 tarball을 저장소 밖 JS·TS 소비 앱에 설치해 검증하고, 통과하면 tarball과 `manifest.json`(`name`·`version`·`filename`·`integrity`)을 `.release/npm/`에 남긴다. `.release/`는 gitignore 대상이다.

게시된 실물은 `npm run verify:registry`로 대조한다. 현재 명령은 `pack-smoke.mjs --registry --registry-version 0.1.0-alpha.1`을 실행해 커밋된 [releases/0.1.0-alpha.1.json](../releases/0.1.0-alpha.1.json)의 네 패키지 버전과 SHA-512 integrity를 registry metadata·다운로드한 tarball과 비교한다. 현재 소스 버전이나 이동 가능한 `alpha` tag는 과거 파일의 판정에 사용하지 않는다. 설치 metadata와 README 예제도 실제 게시본을 기준으로 검사하며, alpha.1에 없는 `/runtime`·`freezeCatalogs`·Svelte API는 요구하지 않는다. registry tarball을 저장소 밖 JS·TS 앱에 설치해 CLI·checkJs/TS·런타임 SSR·public subpath·Vite production lazy chunk를 확인한다. 새로운 승인 JSON은 실제 CI artifact의 integrity를 기록하는 별도 단계이며 로컬 후보 tarball로 기존 승인 기록을 덮어쓰지 않는다. 현행 다섯 `alpha.4`는 `npm run verify:registry:alpha4`가 [releases/0.1.0-alpha.4.json](../releases/0.1.0-alpha.4.json)을 기준으로 검사하고, `npm run verify:registry:sveltekit:alpha4`가 그 게시본으로 SvelteKit 앱을 검증한다. 과거 alpha.3 검증도 유지한다. 기존 `alpha.1`·`alpha.2` 명령과 `verify:registry:sveltekit`(`alpha.2`)은 그대로 둔다.

## GitHub Actions 워크플로

[release.yml](../.github/workflows/release.yml)은 수동 dispatch만 받는다.

| 입력 | 값 |
| --- | --- |
| `version` | 커밋된 정확한 버전 문자열. 기본 `0.1.0-alpha.4` |
| `dist_tag` | `alpha`·`next`·`latest`. 기본 `alpha` |
| `publish` | boolean. 기본 `false` |
| `verify_oidc` | boolean. 기본 `false`. `true`이면 validation 또는 publication 전에 다섯 Trusted Publisher의 OIDC 토큰 교환을 검증한다 |

단일 job이 Ubuntu·Node 24·npm 11에서 `main`이고 저장소가 `0disoft/saylo`일 때만 돈다. environment는 `npm-release`, 권한은 `contents: read`·`id-token: write`다. `release:check` → `npm ci` → `check` → `release:pack` → `release:publish`(dry run) → artifact 업로드 순서이고, `publish`가 true일 때만 `release:publish --publish`로 게시한다. 게시 순서는 core → react → svelte → typegen → vite이고 registry secret(`NPM_TOKEN` 등)을 쓰지 않는다.

`verify_oidc`는 게시와 별개 입력이다. `true`이면 `release:oidc`가 GitHub OIDC 토큰을 `npm:registry.npmjs.org` audience로 받아 npm 공식 API [api-docs.npmjs.com](https://api-docs.npmjs.com/)의 package-scoped token exchange(`.../oidc/token/exchange/package/@0disoft/saylo-<id>`)로 현행 릴리스 대상 다섯 패키지를 확인한다. 패키지 버전·게시·태그는 바꾸지 않고 토큰을 stdout에 출력하거나 디스크에 저장하지 않는다. helper의 guard·성공 교환 protocol·로그/에러 secret 누출 방지 3개 로컬 테스트와 실제 registry 토큰 교환이 모두 통과했다. 2026-10-06 [run 37471573758](https://github.com/0disoft/saylo/actions/runs/37471573758)은 네 패키지 토큰 교환과 전체 143개 테스트·타입 검사·pack 소비 검증을 42초에 마쳤다.

`npm-release` environment는 GitHub에 존재하고 보호 규칙은 없다. dry-run run 37467769385는 140개 테스트·소비 타입 검사·JS/TS packed consumer·`release:publish` dry run까지 통과하고 tarball 4개를 artifact `saylo-npm-0.1.0-alpha.1`로 올렸다. `gh run download 37467769385 --name saylo-npm-0.1.0-alpha.1 --dir .release/bootstrap`로 받은 tarball은 SHA-512가 원본과 일치했다.

게시 스크립트는 `--provenance=${NPM_CONFIG_PROVENANCE}`를 명시적으로 넘기고, 워크플로는 이 값을 `github.event.repository.private`으로 정한다. 현재 `0disoft/saylo`는 PRIVATE라 provenance를 끄고 게시한다. npm 공식 문서는 private 저장소의 provenance를 지원하지 않는다. 저장소를 공개로 바꾸면 자동으로 켜진다. 이 절차는 저장소 visibility를 바꾸지 않는다.

## Trusted Publisher

패키지마다 하나씩 등록한다. 등록 값은 모든 패키지에 동일하게 적용한다. 기존 네 패키지와 Svelte 모두 등록 완료이다. Svelte의 2026-10-09 저장·조회 결과는 아래 등록 기록에 있고, 같은 날 CI에서 다섯 패키지 모두 실제 OIDC 교환을 확인했다.

| 필드 | 값 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `0disoft` |
| Repository | `saylo` |
| Workflow file | `release.yml` |
| Environment | `npm-release` |
| Allowed action | `npm publish` 허용 |

Workflow file에는 확장자를 포함한 `release.yml`만 넣고 `.github/workflows/` 경로는 넣지 않는다. 자세한 절차는 npm 공식 문서 [Trusted publishing](https://docs.npmjs.com/trusted-publishers/)를 따르고, `npm trust` CLI로도 같은 설정을 할 수 있다. 네 패키지 모두 `npm trust github`로 설정했고 `npm trust list`로 값이 같음을 확인했다. 게시 전에는 비인증 공개 registry의 package metadata fetch가 404였고 인증된 `npm view`에서는 placeholder `0.0.0-stage`가 보였다.

## 초기 등록 절차

네 이름을 `registry.npmjs.org`에 등록하고 Trusted Publisher를 설정한 순서다. npm 11의 staged publishing과 `npm trust`를 쓴다([staged publishing](https://docs.npmjs.com/staged-publishing/), [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/)). 브라우저 2FA와 승인은 사람이 직접 한다.

```sh
gh run download 37467769385 --name saylo-npm-0.1.0-alpha.1 --dir .release/bootstrap
npm login --auth-type=web
npm whoami   # -> 0disoft
npm stage publish .release/bootstrap/0disoft-saylo-<id>-0.1.0-alpha.1.tgz --access public --tag alpha --provenance=false --ignore-scripts
npm trust github @0disoft/saylo-<id> --file release.yml --repo 0disoft/saylo --env npm-release --allow-publish --yes
npm trust list @0disoft/saylo-<id>
```

`<id>`는 `core`·`react`·`svelte`·`typegen`·`vite`이며 새 패키지 등록 시 해당 id에 적용한다. 아래의 첫 릴리스 제출 기록은 기존 네 패키지에 해당한다. `npm stage publish`는 공개 placeholder `0.0.0-stage`를 등록하고, 실제 `0.1.0-alpha.1` 내용은 승인 전까지 공개되지 않는다. `npm trust`는 패키지가 registry에 이미 있고 계정 2FA가 켜져 있어야 동작한다.

### Svelte 등록 진행 기록

2026-10-08 `0disoft` 계정으로 로컬 검증된 `.release/npm/0disoft-saylo-svelte-0.1.0-alpha.2.tgz`를 staging에 제출했다. 제출 전 SHA-512가 후보 manifest와 같음을 확인했고, `npm stage list @0disoft/saylo-svelte --json`에서 다음 값을 확인했다.

| 항목 | 값 |
| --- | --- |
| Stage ID | `4cd95172-ad66-4bc1-9cc5-b0fc968b1dee` |
| Package | `@0disoft/saylo-svelte` |
| Version / tag | `0.1.0-alpha.2` / `alpha` |
| Status | `staged` |
| Access / actor | `public` / `0disoft` |
| SHA-1 | `f1d4985ff0c2be9ad20a4760c915ff86716f38a7` |

staging 제출 직후에는 실제 버전의 승인·게시와 기존 네 패키지의 게시·태그 변경을 수행하지 않았다. 당시 `npm view`는 404를 반환해 공개 placeholder 노출을 확인하지 못했다. 아래는 이후 조회한 현행 상태이다.

2026-10-09 첫 인증 완료 조회가 404로 종료되어 설정 요청을 다시 실행했다. 새 브라우저 2FA 뒤 `npm trust github @0disoft/saylo-svelte --file release.yml --repo 0disoft/saylo --env npm-release --allow-publish --yes`가 exit 0으로 성공했다. `npm trust list @0disoft/saylo-svelte --json`도 exit 0으로 같은 저장 값을 반환했다.

| Trusted Publisher 항목 | 조회 값 |
| --- | --- |
| ID | `f9181faf-2907-4a6c-9956-520689d25568` |
| Type / repository | `github` / `0disoft/saylo` |
| File / environment | `release.yml` / `npm-release` |
| Permissions | `createPackage`, `createStagedPackage` |

같은 시점의 stage 목록은 비어 있고 공개 registry는 HTTP 200으로 `0.0.0-stage`·`0.1.0-alpha.2`를 반환했다. tag는 `latest: 0.0.0-stage`, `alpha: 0.1.0-alpha.2`이다. 공개 Svelte `alpha.2`의 metadata integrity와 다운로드한 tarball SHA-512가 검증된 로컬 후보와 일치한다. 이 작업에서는 stage approve 명령을 실행하지 않았으므로 승인 경로와 실행 주체는 확인하지 않았다.

Svelte 등록 당시에는 기존 core·react·typegen·vite가 `alpha.1`이었고, 이 단계에서 새 CI 게시·OIDC 교환·원격 푸시는 수행하지 않았다. 이후 전체 `alpha.2` 릴리스 결과는 아래에 기록한다.

### 기존 네 패키지 등록 이력

`npm login --auth-type=web`으로 인증했고 `npm whoami`는 `0disoft`, 프로필 `tfa`는 `auth-only`다. CI tarball의 SHA-512를 확인한 뒤 네 패키지 `npm stage publish`를 제출했고 `npm stage list` 기준 네 stage status가 모두 `staged`다. `npm trust github`도 네 패키지 모두 성공했고 브라우저 2FA는 사용자가 마쳤다. `npm trust list`는 네 패키지 모두 exit 0으로 repo `0disoft/saylo`, file `release.yml`, env `npm-release`, permissions `['createPackage','createStagedPackage']`가 같음을 확인했다. 게시 전 인증된 `npm view @0disoft/saylo-core versions --json`은 `["0.0.0-stage"]`를 반환해 placeholder를 확인했다. 이후 2026-10-06 네 패키지의 `0.1.0-alpha.1`을 게시했다.

| 패키지 | staged id | trust id |
| --- | --- | --- |
| `@0disoft/saylo-core` | `f6cad51f-166d-41da-bd39-2037f8b9c6a4` | `908f7eaf-0b2b-4d03-96a2-c095f2894475` |
| `@0disoft/saylo-react` | `ac9fff89-9f32-4f8f-aa80-b943c1b89051` | `52f2679c-c880-43bf-8056-1b59c8399f9d` |
| `@0disoft/saylo-typegen` | `9c7e9fc7-37d9-453b-8e4b-4edab04a5829` | `08b6515a-ef84-4f60-a00e-4a44cf15e35f` |
| `@0disoft/saylo-vite` | `e82284c6-7867-40b2-a996-4ad39835e2c8` | `bbc6a339-cbf2-4b47-8296-0a2199799e64` |

## 게시 실패와 재실행

게시는 원자적이지 않다. 중간에 실패하면 앞서 올라간 패키지만 남고 자동으로 되돌리지 않는다. 다시 실행하면 이미 게시된 버전은 tarball integrity와 요청한 dist-tag가 둘 다 같을 때만 건너뛴다. integrity가 다르면 실패하고, registry metadata의 tag가 다르면 오류로 종료한다(태그 변경은 별도 요청). 같은 버전을 지우지 말고 새 패치 버전으로 올린다. 이미 게시된 패키지를 integrity·tag가 같아 건너뛰는 skip은 OIDC 인증 성공을 뜻하지 않는다. 인증 여부는 `verify_oidc=true`·`publish=false` dispatch로 따로 확인한다.

## 게시 후 검증 결과

- `0.1.0-alpha.1`은 stage 승인을 거쳐 2026-10-06 게시했다. 공개 registry에서 네 패키지 버전과 `alpha` tag를 확인했고 `npm run verify:registry`도 통과했다.
- `verify_oidc=true`·`publish=false` dispatch에서 네 Trusted Publisher의 실제 OIDC 토큰 교환을 확인했다. 첫 실행 [37471215141](https://github.com/0disoft/saylo/actions/runs/37471215141)은 응답 검사 단계에서 실패했고, npm CLI와 같이 반환된 token을 검사하도록 수정한 뒤 [37471573758](https://github.com/0disoft/saylo/actions/runs/37471573758)이 통과했다.
- placeholder `0.0.0-stage`와 비인증 404는 게시 전 조회 기록이다. `latest`를 바꾸거나 unpublish하지 않고 alpha 정책을 유지한다.
- Trusted Publisher는 네 패키지 모두 설정했고(`npm trust github`) `npm trust list`로 값이 같음을 확인했다. `npm-release` environment는 존재하고 보호 규칙은 없다.
- 워크플로는 `publish=false`로 실행했고 실제 패키지 게시 단계는 건너뛰었다. 첫 alpha 게시는 사용자의 stage 승인으로 진행했다. OIDC 인증과 actionlint 검사는 통과했다.
- CI 검증: `npm run check`가 Node 24.21.0에서 143개 테스트(기존 140개 + OIDC helper 3개)와 소비 타입 검사를 통과했다. 로컬에서는 Node 24.18.0으로 OIDC helper 3개와 registry 소비 검증을 실행했다. 최종 README를 반영한 `release:pack`도 통과했다. 네 tarball의 LICENSE·NOTICE·메타데이터 일치와 README 예제 실행·타입 검사, 외부 JS·TS 소비 앱의 CLI·번역·React SSR·Vite 8.3.3 lazy chunk를 확인했다. `npm run verify:registry`는 게시된 네 버전·`alpha` tag와 [releases/0.1.0-alpha.1.json](../releases/0.1.0-alpha.1.json) integrity 일치, registry tarball의 CLI·checkJs/TS·런타임 SSR·public subpath·Vite production lazy chunk 검사를 exit 0으로 통과했다. `release:publish`의 dry run과 actionlint도 통과했다. 변조 tarball은 SHA-512 불일치로 거부하고, GitHub Actions 환경이 아닌 `--publish`는 registry 조회 전에 거부한다.
- CI에서 새 버전을 실제로 게시하는 단계는 아직 실행하지 않았다. 이번 검증은 OIDC 인증까지만 확인했으며, 다음 의도적인 버전 릴리스에서 실제 CI 게시를 확인한다.
- 성능 p95 목표는 여전히 미달이며 [검증과 로드맵](06-validation-and-roadmap.md)에 기록한다. 릴리스 게이트는 위 세 명령의 통과이며 성능 측정을 포함하지 않는다.

## 2026-10-09 alpha.2 게시 완료

[run 37804205176](https://github.com/0disoft/saylo/actions/runs/37804205176)은 `main` `c36ff13`, `publish=true`, `verify_oidc=true`로 실행했다. Node 24.21.0·npm 11·Ubuntu에서 다섯 Trusted Publisher 인증, 181개 테스트와 소비 타입 검사, 외부 tarball 검증, artifact 업로드를 통과했다. 1분 16초에 완료했고 core·react·typegen·vite를 게시했다. Svelte는 동일한 게시 파일과 tag를 확인해 건너뛰었다.

CI artifact의 manifest를 [releases/0.1.0-alpha.2.json](../releases/0.1.0-alpha.2.json)에 기록했다. 다섯 공개 버전의 `alpha` tag·metadata·다운로드한 tarball SHA-512가 일치한다. 처음에는 React·typegen의 metadata와 다운로드 URL이 404였으나 재게시 없이 조회·다운로드 가능 상태를 확인한 뒤 소비 검증을 마쳤다. 원인은 확정하지 않는다.

`npm run verify:registry:alpha2`는 실제 게시된 다섯 패키지로 JS/checkJs·TS·README 예제·core runtime·React/Svelte SSR·typegen CLI·Vite lazy build와 parser 제거를 검증한다. `npm run verify:registry:sveltekit`은 같은 승인 registry 파일로 SvelteKit 앱을 설치해 타입 진단 0 errors·0 warnings, client/SSR 빌드, 요청별 SSR·boot·연결 수명, Node 운영 HTTP, HeadlessChrome 154의 hydration·ko/en/ko 전환·입력과 열린 모달 유지·종료와 재진입을 검증했다. 보고된 runtime 오류·경고는 없다. 기존 네 `alpha.1`의 `npm run verify:registry`도 통과했다. 임시 서버·브라우저·소비 앱을 정리했다.

## 2026-10-09 alpha.3 게시 완료

[run 37935637066](https://github.com/0disoft/saylo/actions/runs/37935637066)은 `main` `534a912`, `publish=true`, `verify_oidc=true`로 실행했다. Node 24.21.0·npm 11·Ubuntu에서 다섯 Trusted Publisher 인증, 185개 테스트(core 75·react 9·svelte 5·typegen 8·vite 83·릴리스 helper 5, fail 0)와 소비 타입 검사, pack 검증, 게시 dry run, artifact 업로드, 실제 게시를 통과했다. 릴리스 작업은 22:16:13~22:17:35 KST에 1분 22초로 끝났고 다섯 패키지를 모두 게시했으며 skip은 없었다.

CI artifact의 manifest를 [releases/0.1.0-alpha.3.json](../releases/0.1.0-alpha.3.json)에 기록했다. 다섯 공개 버전의 `alpha` tag·metadata·다운로드한 tarball SHA-512가 일치하고 `latest`는 placeholder `0.0.0-stage`를 유지한다. 게시 직후 공개 metadata는 `alpha.2`를 가리키고 `alpha.3` 버전 endpoint는 404였으나, 재게시 없이 조회·다운로드 가능해졌다. 원인은 확정하지 않는다.

`npm run verify:registry:alpha3`는 승인 integrity와 실제 tarball 외부 설치, README 예제, JS/checkJs·TS, typegen CLI, core runtime·React/Svelte SSR, public subpath, Vite lazy build와 parser 제거, 새 완역 fixture(기본 fallback·키/namespace 누락 진단·기존 타입 유지·수정 후 빌드)의 JS/TS 소비를 exit 0으로 통과했다. `npm run verify:registry:sveltekit:alpha3`는 같은 승인 registry 파일로 SvelteKit 앱을 설치해 타입 진단 0 errors·0 warnings, client/SSR 빌드, 요청별 ko/en SSR·boot와 canonical/base fallback, dev 연결 수명(listener 정리·idempotent stop·late connection 취소), Node 운영 HTTP, HeadlessChrome 154의 hydration·ko/en/ko 전환·공통 layout 입력/모달 유지·종료/재진입을 통과했다. 임시 앱·서버·브라우저는 finally에서 정리했다. 기존 `alpha.1`·`alpha.2` 검증은 이번에 반복하지 않았다. 새 성능 측정과 `examples/npm` lock 변경은 없다.

## 2026-10-11 현재 소스 로컬 검증

게시 승인·원격 상태와 별개로, 현행 소스 `0f7840f`(제품 `eb66af8`)에 대해 로컬에서 다음을 exit 0으로 확인했다. 근거는 [review/local-readiness-2026-10-11.json](../review/local-readiness-2026-10-11.json)(입력 해시 86개, 기록 `38ee9be`)와 [로컬 릴리스 준비 상태](77-local-release-readiness.md)다.

- `npm run check`: 다섯 패키지 build·단위 테스트, JS/TS 소비 5종, React 예제, OIDC·registry 단위 검사.
- `npm exec -- node scripts/pack-smoke.mjs`: 다섯 tarball 독립 install, CLI·typegen·README 예제, Node 번역·인자 거부·React SSR, React·Svelte selector SSR, Vite production lazy, 완역 거부·복구, 개발 의존성 제거 후 SSR(관측 Vite 8.3.4).
- `npm exec -- node scripts/pack-sveltekit.mjs`: 독립 5-tarball install, svelte-check 0 error·0 warning, Vite 8.3.4 production Node·client build, ko/en 동시 SSR과 boot 일치·canonical fallback, listener 정리·runtime 취소, 운영 HTTP, Chromium 154 hydration·ko→en→ko 전환·공통 layout 상태 유지·종료·재진입.

이 pack은 미게시 후속 코드를 `0.1.0-alpha.3` metadata로 묶은 로컬 proof이고 게시된 `alpha.3` artifact가 아니다. selector 공개 API는 현행 소스에 구현돼 있고 로컬 pack으로 검증했지만 게시본에는 없다. 임시 tarball·앱·브라우저·서버는 pack 스크립트가 정리했고, 승인 파일 [releases/0.1.0-alpha.3.json](../releases/0.1.0-alpha.3.json)과 `.release/`는 갱신하지 않았다.

원격 검증(릴리스 `version`·CI 승인, `verify_oidc` 토큰 교환, `verify:registry:alpha3` registry 대조)은 이번 로컬 check와 별개다. 현행 head에 대한 외부 CI·OIDC 검증을 실행한 것이 아니다.
