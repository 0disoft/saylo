# 07. 결정 대장

이 문서는 확정된 목표, 초기 설계 결정, 제품 형태, 미해결 위험을 한곳에 모은다.

## 확정된 사용자 목표

| 항목 | 상태 |
| --- | --- |
| 번역 수정·로케일 추가 시 재컴파일 대기 제거 | 확정 |
| 개발 서버에서 즉시 반영 | 확정 |
| 입력 폼·모달·스크롤 상태 유지 | 확정 |
| JS/TS 동시 지원 | 확정 |
| 이름 Saylo | 확정 |

## 제품 형태

목표는 독립 라이브러리다. 다만 독립 런타임이 꼭 필요한지는 아직 입증되지 않았다.

- i18next·Wuchale 같은 기존 도구의 공개 확장점 위에 얇은 검증·갱신·typegen 계층을 얹는 비교 실험을 먼저 둔다.
- 그 실험으로 필수 계약을 충족하는지 확인하고, 남는 차별점이 독립 런타임을 정당화하는지 판단한다.
- 비교 실험 결과로 제품 형태를 결정한다. 현재 설계의 목표는 독립 라이브러리다.
- 이 비교 실험은 아직 실시하지 않았다.

## 초기 설계 결정 (검증 전, 바뀔 수 있음)

| 선택 | 내용 |
| --- | --- |
| 코어 형태 | 프레임워크 중립 TypeScript, 배포는 ESM JS + `.d.ts` |
| instance 생성 | 동기 `createI18n<AppSchema>` + `initialSnapshot`(BootSnapshot) + `catalogSource`. schema는 타입 전용, 런타임 schema는 boot 메타에서 |
| 첫 dev plugin | Vite 8 plugin, `hotUpdate`에서 커스텀 이벤트 + `[]` 반환 |
| 첫 프레임워크 어댑터 | vanilla subscription과 React. Svelte/Vue는 후속 |
| React 연결 | `createSayloReact<AppSchema>()` factory가 Provider와 hook을 같은 context로 생성. hook의 t는 그 렌더가 선택한 UI snapshot에 바인딩 |
| 상태 구분 | transport 상태(내부), 카탈로그 레코드(불변), UiSnapshot(공개), BootSnapshot(wire) 4종 |
| 갱신 단위 | 로케일+namespace 카탈로그 스냅샷. selector 미세구독은 후속 |
| 갱신 프로토콜 | [08-update-protocol.md](08-update-protocol.md)가 단일 출처. wire 타입과 적용·resync 규칙을 이 문서에 중복하지 않는다 |
| 갱신 적용 | envelope 먼저 원자 반영, 로드된 카탈로그만 payload 적용, 미로드는 dirty |
| 로드/전환 조정 | 하나의 desired state(locale + 원하는 namespace)로 조정. generation은 오래된 완료 차단용이며 정상 동시 호출을 서로 reject하지 않는다 |
| 로더 | core `CatalogSource` 인터페이스. 개발은 범용 `loadCatalog`, 운영은 generated static loader map |
| ICU 구현 | `@formatjs/icu-messageformat-parser` + `intl-messageformat` 재사용, AST 입력. 지원 범위는 FormatJS가 지원하는 MessageFormat 1 문법 |
| 태그 처리 | parser `ignoreTag`로 literal 처리. rich text는 MVP 제외 |
| argument 타입 | 기준 메시지에서만 추론. 번역 인자 이름은 base 부분집합, base 허용 타입은 번역 accepted 타입의 부분집합. 필수 이름은 placeholder 이름의 합집합, 각 이름 타입은 사용 형태 교집합. 생략 번역도 호출 시 base 필수 인자 검증 |
| 타입 계약 | 키·인자 상관관계를 `TypedCall` tuple로 유지. typed 경로에 넓은 `string` overload를 두지 않는다 |
| schema 버전 | namespace 단위 `namespaceSchemaFingerprint`. 전역 schemaRevision은 없음 |
| baseline schema 변경 | 유효한 변경은 커밋, 부적합한 secondary는 quarantine + fallback |
| 번역 누락 | baseLocale fallback 기본 허용. 완역 강제 옵션은 후속 |
| fallback 대상 | baseLocale 하나. `fallbackLocale` 옵션은 두지 않는다 |
| 로케일 목록 타입 | 런타임 `readonly string[]` + 검증된 setter. key·인자 타입은 strict |
| 캐시 | 메시지 formatter 캐시와 `Intl` 캐시를 분리. 문구 revision 변경이 모든 `Intl` 캐시를 비우지 않는다 |
| 소유권 | Vite dev server가 watcher/websocket 소유. Saylo는 자신이 등록한 listener·route·channel binding만 소유·해제. `connectDev`는 동일 instance 단일 binding + idempotent disposer |
| DOM 보존 범위 | 문구 수정·locale 추가·schema-compatible 편집은 보장. schema-breaking 편집은 즉시 적용과 진단·typegen. Vite 서버 재시작 reload는 제외 |
| revision 구분 | registry revision(전송, 내부)과 instance stateRevision(UI) 분리 |
| 오류 타입 | UnknownMessageError, NamespaceNotLoadedError, InvalidArgumentError, CatalogLoadError, SupersededRequestError |
| 시간대 | timeZone 명시 config, 기본 UTC 권장. 생성 시 고정하며 BootSnapshot과 options가 어긋나면 생성 오류 |

## 미해결 위험

| 항목 | 상태 |
| --- | --- |
| 라이선스 | Apache-2.0 확정. 배포 tarball에 `LICENSE`·`NOTICE`를 함께 싣는다 |
| npm 패키지 이름 | `@0disoft/saylo-core`·`saylo-react`·`saylo-typegen`·`saylo-vite` 네 이름으로 2026-10-06 `0.1.0-alpha.1`(dist-tag `alpha`) 게시 완료 |
| 성능 목표 달성 | 미달. 반영 p95 ≤ 100ms와 로케일 추가 p95 ≤ 250ms 모두 안정적 달성을 주장하지 않는다. 로케일 추가·paint·번들 크기는 아직 미측정 |
| 지원 버전 범위 | Node 24.x, Vite 8, React 19, TypeScript 7 기준. 로컬 검증 환경은 Node 24.18.0 |
| build-time parser 런타임 제거 | 미구현. bundler 경계 검증 필요 |
| requireCompleteTranslations(완역 강제) | 후속. 기본은 불완전한 번역 허용 |
| unused message 제거 최적화 | 후속. 동적 t 키 tradeoff 검증 필요 |
| selector 미세구독 최적화 | 후속 |
| Svelte·Vue 어댑터 | 후속. 현재는 vanilla subscription과 React |
| secondary schema quarantine | 미구현(작업 시작). 현재는 기준 schema와 맞지 않는 후보를 배치 단위로 거부한다. 구현을 시작한 상태이며 완료·검증 전이다 |
| JSON 중복 ID·BCP 47 정규화 | 구현. 중복 ID는 `DUPLICATE_ID`로 거부하고 로케일 태그는 `Intl.getCanonicalLocales`로 canonicalize한다. 그 밖에 별도로 정할 ICU 정규화 항목은 아직 정하지 않았다 |
| message delta 비용 | request-scoped message delta를 로컬 구현했다. 대규모 반영 성능 목표는 여전히 미달이고 대규모 fixture 재측정이 남았다 |
| 독립 런타임 필요성 | 기존 도구 위 얇은 계층 비교 실험으로 검증한다. 비교 실험은 아직 실시하지 않았다 |

## 다른 도구와의 관계

Saylo는 코드 생성 방식 도구가 겪는 재컴파일 대기를 줄이는 것을 목표로 한다. HMR 기반 접근을 쓰는 도구와 방향이 겹친다. 구체 수치 비교나 측정 결과는 아직 없으므로 비교는 정성적·한정적 표현에 머문다. 위 비교 실험도 아직 실시하지 않았다.

## 참고 자료

- [Vite HMR API](https://vite.dev/guide/api-hmr) — `handleHotUpdate` 커스텀 이벤트와 모듈 무효화
- [Vite 플러그인 API](https://vite.dev/guide/api-plugin) — `handleHotUpdate` 훅과 커스텀 이벤트 전달
- [React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — store 구독과 스냅샷 동일성
- [FormatJS ICU 문법](https://formatjs.github.io/docs/core-concepts/icu-syntax/) — 지원하는 메시지 문법
- [FormatJS intl-messageformat](https://formatjs.github.io/docs/intl-messageformat/) — AST 입력과 `ignoreTag`
- [Paraglide 메시지 컴파일](https://paraglidejs.com/compiling-messages) — 코드 생성 방식의 대기 지점
- [Wuchale 개발 모드](https://wuchale.dev/guides/dev/) — HMR 기반 반영 접근
- [TypeScript 선언 파일 배포](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html) — `.d.ts` 배포 형태
