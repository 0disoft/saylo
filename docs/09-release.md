# 09. 릴리스

Saylo의 배포 대상과 릴리스 절차를 정리한 runbook이다. 첫 버전 `0.1.0-alpha.1`은 2026-10-06 게시했다. 게시 전 단계였던 워크플로 dry-run dispatch는 GitHub `main` `3953f24`에서 성공했고(run [37467769385](https://github.com/0disoft/saylo/actions/runs/37467769385), 46초, Ubuntu 24.04·Node 24.21.0), 그때는 실제 게시 step을 건너뛰었다.

## 확정 사항

현행 로컬 릴리스 후보는 `0.1.0-alpha.2`이며 다섯 패키지와 내부 의존 버전을 함께 맞췄다. 아직 게시하지 않았다. 변경 범위와 검증 기록은 [후보 기록](../releases/0.1.0-alpha.2.md)에 있다. 아래의 기존 게시·인증 결과는 당시 기록으로 유지한다.

2026-10-08 로컬 릴리스 목록에 `@0disoft/saylo-svelte`를 추가했다. 새 패키지는 미게시이고 Trusted Publisher 등록도 남아 있다. 아래의 네 패키지 게시·인증 기록은 2026-10-06 기존 릴리스의 기록이다. 현행 로컬 pack·게시 계획·OIDC 대상은 다섯 패키지이며 `verify:registry`는 해당 릴리스 manifest의 네 패키지만 검사한다. 상세 범위는 [38-svelte-adapter.md](38-svelte-adapter.md)에 있다.

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
npm run release:check -- --version 0.1.0-alpha.2 --tag alpha
npm run check
npm run release:pack
```

`release:check`는 루트 `private`, 패키지의 `private` 부재, `license`, `engines`, `publishConfig`, 내부 의존 버전, 다섯 패키지의 `LICENSE`·`NOTICE` 일치를 검사한다. `check`는 빌드·워크스페이스 테스트·소비 타입 검사·typegen·React TS 검사를 돌린다. Svelte 데모 빌드는 `npm run build:svelte`로 별도 실행한다. `release:pack`은 빌드 후 다섯 tarball을 저장소 밖 JS·TS 소비 앱에 설치해 검증하고, 통과하면 tarball과 `manifest.json`(`name`·`version`·`filename`·`integrity`)을 `.release/npm/`에 남긴다. `.release/`는 gitignore 대상이다.

게시된 실물은 `npm run verify:registry`로 대조한다. 현재 명령은 `pack-smoke.mjs --registry --registry-version 0.1.0-alpha.1`을 실행해 커밋된 [releases/0.1.0-alpha.1.json](../releases/0.1.0-alpha.1.json)의 네 패키지 버전과 SHA-512 integrity를 registry metadata·다운로드한 tarball과 비교한다. 현재 소스 버전이나 이동 가능한 `alpha` tag는 과거 파일의 판정에 사용하지 않는다. 설치 metadata와 README 예제도 실제 게시본을 기준으로 검사하며, alpha.1에 없는 `/runtime`·`freezeCatalogs`·Svelte API는 요구하지 않는다. registry tarball을 저장소 밖 JS·TS 앱에 설치해 CLI·checkJs/TS·런타임 SSR·public subpath·Vite production lazy chunk를 확인한다. 새로운 승인 JSON은 실제 CI artifact의 integrity를 기록하는 별도 단계이며 로컬 후보 tarball로 기존 승인 기록을 덮어쓰지 않는다.

## GitHub Actions 워크플로

[release.yml](../.github/workflows/release.yml)은 수동 dispatch만 받는다.

| 입력 | 값 |
| --- | --- |
| `version` | 커밋된 정확한 버전 문자열. 기본 `0.1.0-alpha.2` |
| `dist_tag` | `alpha`·`next`·`latest`. 기본 `alpha` |
| `publish` | boolean. 기본 `false` |
| `verify_oidc` | boolean. 기본 `false`. `publish`가 `false`일 때 현행 다섯 패키지의 Trusted Publisher OIDC 토큰 교환만 검증한다 |

단일 job이 Ubuntu·Node 24·npm 11에서 `main`이고 저장소가 `0disoft/saylo`일 때만 돈다. environment는 `npm-release`, 권한은 `contents: read`·`id-token: write`다. `release:check` → `npm ci` → `check` → `release:pack` → `release:publish`(dry run) → artifact 업로드 순서이고, `publish`가 true일 때만 `release:publish --publish`로 게시한다. 게시 순서는 core → react → svelte → typegen → vite이고 registry secret(`NPM_TOKEN` 등)을 쓰지 않는다.

`verify_oidc`는 게시와 별개 입력이다. `true`이고 `publish`가 `false`이면 `release:oidc`가 GitHub OIDC 토큰을 `npm:registry.npmjs.org` audience로 받아 npm 공식 API [api-docs.npmjs.com](https://api-docs.npmjs.com/)의 package-scoped token exchange(`.../oidc/token/exchange/package/@0disoft/saylo-<id>`)로 현행 릴리스 대상 다섯 패키지를 확인한다. 패키지 버전·게시·태그는 바꾸지 않고 토큰을 stdout에 출력하거나 디스크에 저장하지 않는다. helper의 guard·성공 교환 protocol·로그/에러 secret 누출 방지 3개 로컬 테스트와 실제 registry 토큰 교환이 모두 통과했다. 2026-10-06 [run 37471573758](https://github.com/0disoft/saylo/actions/runs/37471573758)은 네 패키지 토큰 교환과 전체 143개 테스트·타입 검사·pack 소비 검증을 42초에 마쳤다.

`npm-release` environment는 GitHub에 존재하고 보호 규칙은 없다. dry-run run 37467769385는 140개 테스트·소비 타입 검사·JS/TS packed consumer·`release:publish` dry run까지 통과하고 tarball 4개를 artifact `saylo-npm-0.1.0-alpha.1`로 올렸다. `gh run download 37467769385 --name saylo-npm-0.1.0-alpha.1 --dir .release/bootstrap`로 받은 tarball은 SHA-512가 원본과 일치했다.

게시 스크립트는 `--provenance=${NPM_CONFIG_PROVENANCE}`를 명시적으로 넘기고, 워크플로는 이 값을 `github.event.repository.private`으로 정한다. 현재 `0disoft/saylo`는 PRIVATE라 provenance를 끄고 게시한다. npm 공식 문서는 private 저장소의 provenance를 지원하지 않는다. 저장소를 공개로 바꾸면 자동으로 켜진다. 이 절차는 저장소 visibility를 바꾸지 않는다.

## Trusted Publisher

패키지마다 하나씩 등록한다. 등록 값은 모든 패키지에 동일하게 적용한다. 기존 네 패키지는 등록 완료이고 Svelte는 등록 전이다.

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

### 초기 stage와 trust 이력

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
