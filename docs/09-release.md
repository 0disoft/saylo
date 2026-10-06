# 09. 릴리스

Saylo의 배포 대상과 릴리스 절차를 정리한 runbook이다. 게시 전 상태를 기록하며, 아래 워크플로는 아직 dispatch하지 않았다.

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

Workflow file에는 확장자를 포함한 `release.yml`만 넣고 `.github/workflows/` 경로는 넣지 않는다. 자세한 절차는 npm 공식 문서 [Trusted publishing](https://docs.npmjs.com/trusted-publishers/)를 따른다. 패키지 등록과 Trusted Publisher 설정이 선행돼야 하며, 아직 npm 외부 설정은 확인하지 않았다.

## 게시 실패와 재실행

게시는 원자적이지 않다. 중간에 실패하면 앞서 올라간 패키지만 남고 자동으로 되돌리지 않는다. 다시 실행하면 이미 게시된 버전은 tarball integrity와 요청한 dist-tag가 둘 다 같을 때만 건너뛴다. integrity가 다르면 실패하고, registry metadata의 tag가 다르면 오류로 종료한다(태그 변경은 별도 요청). 같은 버전을 지우지 말고 새 패치 버전으로 올린다.

## 아직 하지 않은 것

- 네 이름은 공개 registry에 없다. 패키지 등록과 Trusted Publisher 설정, 최초 게시 권한이 선행돼야 하며 별도 사용자 승인이 필요하다.
- `npm-release` environment와 Trusted Publisher 등록은 아직 하지 않았다.
- 워크플로는 dispatch하지 않았다. actionlint 검사는 통과했다.
- 로컬 검증: `npm run check`가 Node 24.18.0에서 통과했다(140개 테스트와 소비 타입 검사). 최종 README를 반영한 `release:pack`도 통과했다. 네 tarball의 LICENSE·NOTICE·메타데이터 일치와 README 예제 실행·타입 검사, 외부 JS·TS 소비 앱의 CLI·번역·React SSR·Vite 8.3.3 lazy chunk를 확인했다. `release:publish`의 dry run과 actionlint도 통과했다. 변조 tarball은 SHA-512 불일치로 거부하고, GitHub Actions 환경이 아닌 `--publish`는 registry 조회 전에 거부한다.
- 성능 p95 목표는 여전히 미달이며 [검증과 로드맵](06-validation-and-roadmap.md)에 기록한다. 릴리스 게이트는 위 세 명령의 통과이며 성능 측정을 포함하지 않는다.
