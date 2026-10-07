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
| 성능 목표 달성 | 미달. 반영 p95 ≤ 100ms와 로케일 추가 p95 ≤ 250ms 모두 안정적 달성을 주장하지 않는다. 2026-10-07 새 로케일 목록 표시 p95는 small 226.86ms·large 3437.01ms였고 첫 번역 commit은 64.70ms·843.70ms였다. paint는 미측정. 실제 데모 초기 JS gzip 합은 parser 제거 전후 vanilla 19,656→12,796 B·React 92,241→85,139 B였고 영어 지연 청크가 유지됐다. 조건·원본/gzip·단일 run 한계는 [10-performance-measurements.md](10-performance-measurements.md)와 [12-locale-add-measurements.md](12-locale-add-measurements.md)를 따른다 |
| 지원 버전 범위 | Node 24.x, Vite 8, React 19, TypeScript 7 기준. 로컬 검증 환경은 Node 24.18.0 |
| build-time parser 런타임 제거 | Vite plugin에 로컬 구현(`astRuntime` 기본 `true`, production 한정). Saylo core formatter 경계에서만 `@formatjs/icu-messageformat-parser/no-parser.js`로 바꾸고 앱 전체 alias는 하지 않는다. 공개 `@0disoft/saylo-core/runtime`은 `parseCatalog`를 제외한다. 런타임 엔트리만으로 모든 bundler의 제거를 보장하지 않으며 검증 범위는 Vite 8 production build다. 로컬 변경이고 게시본에는 없다 |
| requireCompleteTranslations(완역 강제) | 후속. 기본은 불완전한 번역 허용 |
| unused message 제거 최적화 | 후속. 동적 t 키 tradeoff 검증 필요 |
| selector 미세구독 최적화 | 후속 |
| Svelte·Vue 어댑터 | 후속. 현재는 vanilla subscription과 React |
| secondary schema quarantine | Vite plugin에 구현. 기준 schema 변경 시 last-good 번역에서 부적합 메시지만 제거해 게시하고 나머지는 base fallback으로 둔다. 단위·통합 테스트와 2026-10-07 실제 브라우저 검증을 통과했다. schema-breaking 편집이라 입력·dialog 상태 보존은 일반 보장이 아니다. 코어 `createStore`·`replaceCatalogs`에는 격리를 넣지 않는다 |
| JSON 중복 ID·BCP 47 정규화 | 구현. 중복 ID는 `DUPLICATE_ID`로 거부하고 로케일 태그는 `Intl.getCanonicalLocales`로 canonicalize한다. 그 밖에 별도로 정할 ICU 정규화 항목은 아직 정하지 않았다 |
| message delta 비용 | request-scoped message delta·immutable catalog signature 재사용·LF 위치 색인 최적화를 로컬 구현했다. 2026-10-07 최종 서버 파일 계측 설정에서 small p95 72.66ms·large 165.94ms였고 각각 측정 50회 모두 patch였다. 파서 key 디코딩 trial은 되돌렸다. 대규모 목표 p95 ≤ 100ms는 여전히 미달이다. JSON token/임시 entry·메시지 맵 할당, 브라우저 patch 복사·검증 순회, 로케일 추가 시 cold 파싱·추가 선택 비용 최적화와 비교 실험이 남아 있다. compact 전체 전송은 아래 후속 기록을 따른다. 조건·되돌린 실험·부하 한계는 [10-performance-measurements.md](10-performance-measurements.md)와 [11-parser-measurements.md](11-parser-measurements.md)를 따른다 |
| 독립 런타임 필요성 | 기존 도구 위 얇은 계층 비교 실험으로 검증한다. 비교 실험은 아직 실시하지 않았다 |

대규모 로케일 추가의 서버 구간 계측([14](14-locale-add-server-measurements.md))에서 cold 파싱을 다음 대상으로 확인했다. 이후 일반 텍스트·ASCII 단순 인자용 경로를 로컬 구현했다. 같은 프로세스 cold 비교 20쌍 중 18쌍이 빨랐지만 parser p95는 개선되지 않았다. 당시 대규모 목록 표시 p95는 514.47ms로 관측했으며 250ms 목표는 미달이다. 조건·원시 결과·부하 한계는 [15-simple-message-parser.md](15-simple-message-parser.md)를 따른다.

full catalog 선택 경로에는 compact 개발 전송을 로컬 구현했다. 반복 필드와 literal·argument AST 위치를 배열로 보내고 같은 인자 스키마를 공유하며 복잡한 ICU AST는 유지한다. 대규모 응답 JSON은 약 71.92% 작아졌다. 새 run의 선택 준비→번역 ack p95는 400.42ms, 목록 표시 p95는 1,128.04ms였고 지연 변화의 원인은 부하·GC를 분리하지 않아 단정하지 않는다. 추가 파싱·선택 비용 최적화와 메모리 overhead 측정은 남아 있다. 현행 wire와 검증은 [08](08-update-protocol.md)·[16](16-compact-catalog-transport.md)을 따른다.

## 다른 도구와의 관계

cold 내부 계측에서는 인자 스키마·메시지·최종 카탈로그 동결 구간을 우선 후보로 확인했다. GC 관측과 함께 기록하되 GC가 tail 지연의 유일한 원인이라고 단정하지 않는다. 동일 인자 스키마 재사용이나 AST 구조별 동결을 검토하되 불변성·ICU·오류 위치 계약을 유지한다. 제품 최적화는 아직 하지 않았으며 근거는 [17-cold-parser-measurements.md](17-cold-parser-measurements.md)에 있다.

Saylo는 코드 생성 방식 도구가 겪는 재컴파일 대기를 줄이는 것을 목표로 한다. HMR 기반 접근을 쓰는 도구와 방향이 겹친다. 2026-10-07 Paraglide 2.25.4와 같은 fixture의 small 문구 수정·로케일 추가를 각각 10회 측정했다. Paraglide 문구 편집은 Fast Refresh로 입력과 상태를 유지했고, 로케일 추가·기본 setter 선택은 document reload로 최초 상태를 잃었다. Saylo는 두 흐름에서 상태 보존을 확인했다. large는 Paraglide 초기 compile의 하위 SDK timeout으로 비교를 완료하지 못했다. 조건·원시 결과·한계는 [13-paraglide-comparison.md](13-paraglide-comparison.md)를 따른다. 위 i18next/Wuchale 얇은 계층 비교 실험은 아직 실시하지 않았으며 이 측정으로 독립 런타임 필요성을 확정하지 않는다.

## 참고 자료

- [Vite HMR API](https://vite.dev/guide/api-hmr) — `handleHotUpdate` 커스텀 이벤트와 모듈 무효화
- [Vite 플러그인 API](https://vite.dev/guide/api-plugin) — `handleHotUpdate` 훅과 커스텀 이벤트 전달
- [React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — store 구독과 스냅샷 동일성
- [FormatJS ICU 문법](https://formatjs.github.io/docs/core-concepts/icu-syntax/) — 지원하는 메시지 문법
- [FormatJS intl-messageformat](https://formatjs.github.io/docs/intl-messageformat/) — AST 입력과 `ignoreTag`
- [Paraglide 메시지 컴파일](https://paraglidejs.com/compiling-messages) — 코드 생성 방식의 대기 지점
- [Wuchale 개발 모드](https://wuchale.dev/guides/dev/) — HMR 기반 반영 접근
- [TypeScript 선언 파일 배포](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html) — `.d.ts` 배포 형태
