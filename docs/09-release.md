# 09. 릴리스

Saylo의 배포 대상과 릴리스 절차를 정리한 runbook이다. 게시 전 상태를 기록한다. 워크플로 dry-run dispatch는 GitHub `main` `3953f24`에서 성공했고(run [37467769385](https://github.com/0disoft/saylo/actions/runs/37467769385), 46초, Ubuntu 24.04·Node 24.21.0), 실제 게시 step은 건너뛰었다.

## 확정 사항

| 항목 | 결정 |
| --- | --- |
| 라이선스 | Apache-2.0. 배포 tarball에 루트 `LICENSE`·`NOTICE`를 함께 싣는다 |
| 첫 버전 | `0.1.0-alpha.1` |
| dist-tag | `alpha` |
| 배포 패키지 | `@0disoft/saylo-core`·`@0disoft/saylo-react`·`@0disoft/saylo-typegen`·`@0disoft/saylo-vite` |
| 루트 package | `saylo-workspace`는 `private`를 유지한다 |
| publishConfig | `access: public`, `tag: alpha`, `registry: https://registry.npmjs.org/` |
| Node | `engines.node`는 `24.x`. 로컬 검증 환경은 Node 24.18.0 |
| TypeScript | 7을 기준으로 검증한다. `typescript`를 peer로 강제하지 않는다 |
| peer 조건 | react 19, vite 8 |
| 런타임 | core·react는 ES2022 브라우저 대상이라 Node API에 의존하지 않는다. typegen·vite는 Node에서 실행한다 |
| provenance | 저장소가 private인 동안 `--provenance=false`로 게시한다. 공개 저장소면 true |

아직 게시하지 않았다. `latest`가 없으므로 설치할 때 `@0disoft/saylo-core@alpha`처럼 `@alpha`를 지정한다.

## 버전과 태그 계약

- 게시 버전은 커밋된 manifest 값을 그대로 쓴다. 워크플로는 버전을 다시 쓰지 않는다. dispatch `version`과 네 `packages/*/package.json`의 `version`이 하나라도 다르면 실패한다.
- 형식은 `x.y.z` 또는 `x.y.z-alpha.N`·`-beta.N`·`-rc.N`이다.
- tag는 `alpha`·`next`·`latest`다. prerelease는 `latest`를 쓸 수 없고 stable은 `alpha`를 쓸 수 없다.
- 워크스페이스 내부 의존(`@0disoft/saylo-*`)은 같은 버전을 정확히 지정한다.

## 로컬 검증 명령

```sh
npm run release:check -- --version 0.1.0-alpha.1 --tag alpha
npm run check
npm run release:pack
```

`release:check`는 루트 `private`, 패키지의 `private` 부재, `license`, `engines`, `publishConfig`, 내부 의존 버전, 네 패키지의 `LICENSE`·`NOTICE` 일치를 검사한다. `check`는 빌드·워크스페이스 테스트·소비 타입 검사·typegen·React TS 검사를 돌린다. `release:pack`은 빌드 후 네 tarball을 저장소 밖 JS·TS 소비 앱에 설치해 검증하고, 통과하면 tarball과 `manifest.json`(`name`·`version`·`filename`·`integrity`)을 `.release/npm/`에 남긴다. `.release/`는 gitignore 대상이다.

## GitHub Actions 워크플로

[release.yml](../.github/workflows/release.yml)은 수동 dispatch만 받는다.

| 입력 | 값 |
| --- | --- |
| `version` | 커밋된 정확한 버전 문자열. 기본 `0.1.0-alpha.1` |
| `dist_tag` | `alpha`·`next`·`latest`. 기본 `alpha` |
| `publish` | boolean. 기본 `false` |

단일 job이 Ubuntu·Node 24·npm 11에서 `main`이고 저장소가 `0disoft/saylo`일 때만 돈다. environment는 `npm-release`, 권한은 `contents: read`·`id-token: write`다. `release:check` → `npm ci` → `check` → `release:pack` → `release:publish`(dry run) → artifact 업로드 순서이고, `publish`가 true일 때만 `release:publish --publish`로 게시한다. 게시 순서는 core → react → typegen → vite이고 registry secret(`NPM_TOKEN` 등)을 쓰지 않는다.

`npm-release` environment는 GitHub에 존재하고 보호 규칙은 없다. dry-run run 37467769385는 140개 테스트·소비 타입 검사·JS/TS packed consumer·`release:publish` dry run까지 통과하고 tarball 4개를 artifact `saylo-npm-0.1.0-alpha.1`로 올렸다. `gh run download 37467769385 --name saylo-npm-0.1.0-alpha.1 --dir .release/bootstrap`로 받은 tarball은 SHA-512가 원본과 일치했다.

게시 스크립트는 `--provenance=${NPM_CONFIG_PROVENANCE}`를 명시적으로 넘기고, 워크플로는 이 값을 `github.event.repository.private`으로 정한다. 현재 `0disoft/saylo`는 PRIVATE라 provenance를 끄고 게시한다. npm 공식 문서는 private 저장소의 provenance를 지원하지 않는다. 저장소를 공개로 바꾸면 자동으로 켜진다. 이 절차는 저장소 visibility를 바꾸지 않는다.

## Trusted Publisher

패키지마다 하나씩 등록한다. 값은 네 패키지 모두 같다.

| 필드 | 값 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `0disoft` |
| Repository | `saylo` |
| Workflow file | `release.yml` |
| Environment | `npm-release` |
| Allowed action | `npm publish` 허용 |

Workflow file에는 확장자를 포함한 `release.yml`만 넣고 `.github/workflows/` 경로는 넣지 않는다. 자세한 절차는 npm 공식 문서 [Trusted publishing](https://docs.npmjs.com/trusted-publishers/)를 따르고, `npm trust` CLI로도 같은 설정을 할 수 있다. 네 패키지 모두 `npm trust github`로 설정했고 `npm trust list`로 값이 같음을 확인했다. 비인증 공개 registry의 package metadata fetch는 아직 404이고, 인증된 `npm view`에서는 placeholder `0.0.0-stage`가 보인다.

## 초기 등록 절차

네 이름을 `registry.npmjs.org`에 등록하고 Trusted Publisher를 설정하는 순서다. npm 11의 staged publishing과 `npm trust`를 쓴다([staged publishing](https://docs.npmjs.com/staged-publishing/), [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/)). 브라우저 2FA와 승인은 사람이 직접 한다.

```sh
gh run download 37467769385 --name saylo-npm-0.1.0-alpha.1 --dir .release/bootstrap
npm login --auth-type=web
npm whoami   # -> 0disoft
npm stage publish .release/bootstrap/0disoft-saylo-<id>-0.1.0-alpha.1.tgz --access public --tag alpha --provenance=false --ignore-scripts
npm trust github @0disoft/saylo-<id> --file release.yml --repo 0disoft/saylo --env npm-release --allow-publish --yes
npm trust list @0disoft/saylo-<id>
```

`<id>`는 `core`·`react`·`typegen`·`vite`이고 네 패키지 모두 반복한다. `npm stage publish`는 공개 placeholder `0.0.0-stage`를 등록하고, 실제 `0.1.0-alpha.1` 내용은 승인 전까지 공개되지 않는다. `npm trust`는 패키지가 registry에 이미 있고 계정 2FA가 켜져 있어야 동작한다.

### 현재 stage와 trust 상태

`npm login --auth-type=web`으로 인증했고 `npm whoami`는 `0disoft`, 프로필 `tfa`는 `auth-only`다. CI tarball의 SHA-512를 확인한 뒤 네 패키지 `npm stage publish`를 제출했고 `npm stage list` 기준 네 stage status가 모두 `staged`다. `npm trust github`도 네 패키지 모두 성공했고 브라우저 2FA는 사용자가 마쳤다. `npm trust list`는 네 패키지 모두 exit 0으로 repo `0disoft/saylo`, file `release.yml`, env `npm-release`, permissions `['createPackage','createStagedPackage']`가 같음을 확인했다. 인증된 `npm view @0disoft/saylo-core versions --json`은 `["0.0.0-stage"]`를 반환해 placeholder를 확인했고, 비인증 공개 metadata fetch는 아직 404다. `0.1.0-alpha.1`은 아직 승인·게시 전이다.

| 패키지 | staged id | trust id |
| --- | --- | --- |
| `@0disoft/saylo-core` | `f6cad51f-166d-41da-bd39-2037f8b9c6a4` | `908f7eaf-0b2b-4d03-96a2-c095f2894475` |
| `@0disoft/saylo-react` | `ac9fff89-9f32-4f8f-aa80-b943c1b89051` | `52f2679c-c880-43bf-8056-1b59c8399f9d` |
| `@0disoft/saylo-typegen` | `9c7e9fc7-37d9-453b-8e4b-4edab04a5829` | `08b6515a-ef84-4f60-a00e-4a44cf15e35f` |
| `@0disoft/saylo-vite` | `e82284c6-7867-40b2-a996-4ad39835e2c8` | `bbc6a339-cbf2-4b47-8296-0a2199799e64` |

## 게시 실패와 재실행

게시는 원자적이지 않다. 중간에 실패하면 앞서 올라간 패키지만 남고 자동으로 되돌리지 않는다. 다시 실행하면 이미 게시된 버전은 tarball integrity와 요청한 dist-tag가 둘 다 같을 때만 건너뛴다. integrity가 다르면 실패하고, registry metadata의 tag가 다르면 오류로 종료한다(태그 변경은 별도 요청). 같은 버전을 지우지 말고 새 패치 버전으로 올린다.

## 아직 하지 않은 것

- 남은 것은 `0.1.0-alpha.1`의 stage 승인과 실제 OIDC publish 검증뿐이다. 승인은 아직 하지 않았다.
- placeholder `0.0.0-stage`는 인증된 `npm view`에서 확인됐고, 비인증 공개 metadata fetch는 아직 404다.
- Trusted Publisher는 네 패키지 모두 설정했고(`npm trust github`) `npm trust list`로 값이 같음을 확인했다. `npm-release` environment는 존재하고 보호 규칙은 없다.
- 워크플로는 dry-run(`publish=false`)으로만 dispatch했다. 실제 게시는 하지 않았다. actionlint 검사는 통과했다.
- 로컬 검증: `npm run check`가 Node 24.18.0에서 통과했다(140개 테스트와 소비 타입 검사). 최종 README를 반영한 `release:pack`도 통과했다. 네 tarball의 LICENSE·NOTICE·메타데이터 일치와 README 예제 실행·타입 검사, 외부 JS·TS 소비 앱의 CLI·번역·React SSR·Vite 8.3.3 lazy chunk를 확인했다. `release:publish`의 dry run과 actionlint도 통과했다. 변조 tarball은 SHA-512 불일치로 거부하고, GitHub Actions 환경이 아닌 `--publish`는 registry 조회 전에 거부한다.
- 성능 p95 목표는 여전히 미달이며 [검증과 로드맵](06-validation-and-roadmap.md)에 기록한다. 릴리스 게이트는 위 세 명령의 통과이며 성능 측정을 포함하지 않는다.
