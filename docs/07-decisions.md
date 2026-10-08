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
| 첫 프레임워크 어댑터 | vanilla subscription과 React. Svelte 5는 2026-10-08 로컬 구현 완료([38](38-svelte-adapter.md)). Vue는 후속 |
| Svelte 연결 | `createSvelteStore(instance)` readable과 `createSayloSvelte<AppSchema>()` context factory. `$i18n.t`는 불변 스냅샷에 바인딩. instance는 호출자가 소유 |
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
| 지원 버전 범위 | Node 24.x, Vite 8, React 19, Svelte 5, TypeScript 7 기준. 로컬 검증 환경은 Node 24.18.0 |
| build-time parser 런타임 제거 | Vite plugin에 로컬 구현(`astRuntime` 기본 `true`, production 한정). Saylo core formatter 경계에서만 `@formatjs/icu-messageformat-parser/no-parser.js`로 바꾸고 앱 전체 alias는 하지 않는다. 공개 `@0disoft/saylo-core/runtime`은 `parseCatalog`를 제외한다. 런타임 엔트리만으로 모든 bundler의 제거를 보장하지 않으며 검증 범위는 Vite 8 production build다. 로컬 변경이고 게시본에는 없다 |
| requireCompleteTranslations(완역 강제) | 후속. 기본은 불완전한 번역 허용 |
| unused message 제거 최적화 | 후속. 동적 t 키 tradeoff 검증 필요 |
| selector 미세구독 최적화 | 후속 |
| Svelte 어댑터 | Svelte 5 readable·typed context·SSR·hydration과 데모 로컬 구현 완료. npm 게시는 미실시([38](38-svelte-adapter.md)) |
| Vue 어댑터 | 후속 |
| secondary schema quarantine | Vite plugin에 구현. 기준 schema 변경 시 last-good 번역에서 부적합 메시지만 제거해 게시하고 나머지는 base fallback으로 둔다. 단위·통합 테스트와 2026-10-07 실제 브라우저 검증을 통과했다. schema-breaking 편집이라 입력·dialog 상태 보존은 일반 보장이 아니다. 코어 `createStore`·`replaceCatalogs`에는 격리를 넣지 않는다 |
| JSON 중복 ID·BCP 47 정규화 | 구현. 중복 ID는 `DUPLICATE_ID`로 거부하고 로케일 태그는 `Intl.getCanonicalLocales`로 canonicalize한다. 그 밖에 별도로 정할 ICU 정규화 항목은 아직 정하지 않았다 |
| message delta 비용 | request-scoped message delta·immutable catalog signature 재사용·LF 위치 색인 최적화를 로컬 구현했다. 2026-10-07 최종 서버 파일 계측 설정에서 small p95 72.66ms·large 165.94ms였고 각각 측정 50회 모두 patch였다. 파서 key 디코딩 trial은 되돌렸다. 대규모 목표 p95 ≤ 100ms는 여전히 미달이다. JSON token/임시 entry·메시지 맵 할당, 브라우저 patch 복사·검증 순회, 로케일 추가 시 cold 파싱·추가 선택 비용 최적화와 비교 실험이 남아 있다. compact 전체 전송은 아래 후속 기록을 따른다. 조건·되돌린 실험·부하 한계는 [10-performance-measurements.md](10-performance-measurements.md)와 [11-parser-measurements.md](11-parser-measurements.md)를 따른다 |
| 독립 런타임 필요성 | 기존 도구 위 얇은 계층 비교 실험으로 검증한다. 비교 실험은 아직 실시하지 않았다 |

대규모 로케일 추가의 서버 구간 계측([14](14-locale-add-server-measurements.md))에서 cold 파싱을 다음 대상으로 확인했다. 이후 일반 텍스트·ASCII 단순 인자용 경로를 로컬 구현했다. 같은 프로세스 cold 비교 20쌍 중 18쌍이 빨랐지만 parser p95는 개선되지 않았다. 당시 대규모 목록 표시 p95는 514.47ms로 관측했으며 250ms 목표는 미달이다. 조건·원시 결과·부하 한계는 [15-simple-message-parser.md](15-simple-message-parser.md)를 따른다.

full catalog 선택 경로에는 compact 개발 전송을 로컬 구현했다. 반복 필드와 literal·argument AST 위치를 배열로 보내고 같은 인자 스키마를 공유하며 복잡한 ICU AST는 유지한다. 대규모 응답 JSON은 약 71.92% 작아졌다. 새 run의 선택 준비→번역 ack p95는 400.42ms, 목록 표시 p95는 1,128.04ms였고 지연 변화의 원인은 부하·GC를 분리하지 않아 단정하지 않는다. 추가 파싱·선택 비용 최적화와 메모리 overhead 측정은 남아 있다. 현행 wire와 검증은 [08](08-update-protocol.md)·[16](16-compact-catalog-transport.md)을 따른다.

## 다른 도구와의 관계

cold 내부 계측에서는 인자 스키마·메시지·최종 카탈로그 동결 구간을 우선 후보로 확인했다([17](17-cold-parser-measurements.md)). 이후 호출 내 동일 인자 스키마 공유와 성공한 불변 계약 쌍의 검증 재사용을 로컬 구현했다. cold 교차 비교는 20쌍 중 17쌍과 중앙값에서 개선됐지만 p95는 증가했다. GC를 tail 지연의 유일한 원인으로 단정하지 않는다. 다음 후보는 메시지·AST 동결 경로이며 불변성·ICU·오류 위치 계약을 유지한다. 조건과 원시 결과는 [18-shared-argument-schemas.md](18-shared-argument-schemas.md)를 따른다.

Saylo는 코드 생성 방식 도구가 겪는 재컴파일 대기를 줄이는 것을 목표로 한다. HMR 기반 접근을 쓰는 도구와 방향이 겹친다. 2026-10-07 Paraglide 2.25.4와 같은 fixture의 small 문구 수정·로케일 추가를 각각 10회 측정했다. Paraglide 문구 편집은 Fast Refresh로 입력과 상태를 유지했고, 로케일 추가·기본 setter 선택은 document reload로 최초 상태를 잃었다. Saylo는 두 흐름에서 상태 보존을 확인했다. large는 Paraglide 초기 compile의 하위 SDK timeout으로 비교를 완료하지 못했다. 조건·원시 결과·한계는 [13-paraglide-comparison.md](13-paraglide-comparison.md)를 따른다. 위 i18next/Wuchale 얇은 계층 비교 실험은 아직 실시하지 않았으며 이 측정으로 독립 런타임 필요성을 확정하지 않는다.

파서 소유 literal·argument AST에는 알려진 구조의 위치·노드를 직접 동결하는 경로를 선택했다. 복잡한 ICU와 외부 입력의 일반 동결은 유지한다. cold 교차 비교 p50·p95는 낮게 관측됐지만 incremental 중앙값에서는 개선을 확인하지 못했다. 일반 동결을 for...in으로 바꾼 실험은 느려져 되돌렸다. 다음은 로케일 추가 종단 간 재측정이며 조건·한계는 [19](19-ast-freeze-measurements.md)에 있다.

후속 종단 간 재측정에서는 large 목록 p95가 1,056.40ms로 250ms 목표를 넘었고 모든 측정이 250ms를 초과했다. 목록→선택 흐름의 상태 보존은 유지했다. 다음 구현 대상을 정하기 전에 현재 코드의 서버 구간을 기존 계측기로 다시 확인한다. 과거 파싱 비용 비중이나 단일 run의 시간 차이로 원인을 확정하지 않는다. 근거는 [20](20-locale-add-remeasurement.md)이다.

현행 서버 재계측에서도 10회 모두 cold 파싱이 가장 큰 개별 수집 구간이었다. 번역 준비 p50은 13.06ms, 최종 active 검증은 0.04ms였으므로 다음 작은 실험은 파서의 반복 상대 위치 객체 공유로 정한다. 소스 위치·Unicode·ICU·불변성 계약을 유지하고 교차 비교 결과로 채택 여부를 판단한다. 구현 전 후보이며 근거·한계는 [21](21-locale-add-server-remeasurement.md)에 있다.

호출 내 단순 AST 상대 좌표와 위치 구간 공유를 로컬 채택했다. pool 없는 동일 fixture보다 참조 좌표·구간 객체가 줄었고 cold pair 중앙값에서 개선을 관측했다. cold 최장 시간과 incremental p95는 개선되지 않아 안정적 tail 개선은 주장하지 않는다. 절대 위치·Unicode·ICU·불변성은 유지한다. 초기 좌표만 공유한 실험과 최종 결과·다음 종단 간 재측정은 [22](22-relative-position-sharing.md)를 따른다.

위치 공유 후 50회 재측정에서 large 목록 p95는 878.98ms로 낮게 관측됐지만 250ms 목표는 미달이다. 첫 번역 선택 p95는 486.80ms로 직전 run보다 높게 관측돼 전체 흐름의 일관된 개선은 확인하지 못했다. 다음은 benchmark의 locale-add full 응답 디코딩·동결·snapshot 구간 계측으로 정한다. 브라우저 디코딩을 확정 병목으로 단정하지 않으며 근거는 [23](23-position-sharing-locale-add.md)이다.

첫 선택 계측에서 Vite 동결이 수집한 동기 구간 중 가장 컸지만 선택 잔여가 매회 전체 선택 시간의 64.15% 이상이었다. 다음 구현은 동결 최적화에 바로 귀속하기보다 snapshot 이전 core acceptOutcome의 검증·동결 경계를 추가하는 benchmark 작업으로 정한다. full/patch 모드별 필수 호출을 구분하고 잔여를 네트워크 비용으로 단정하지 않는다. 근거·검증은 [24](24-full-selection-browser-stages.md)를 따른다.

core 응답 수락 계측에서 동결 p50은 66.00ms였고 검증 p95는 0.10ms였다. Vite가 동결한 객체도 core의 별도 WeakSet에 없으면 다시 순회한다. 다음 제품 작업은 신뢰 가능한 전송 카탈로그가 core의 깊은 동결 경로를 공유하도록 하는 것으로 정한다. 외부의 얕은 동결을 깊은 동결로 간주하지 않고, AST 불변성과 오류 의미를 유지한다. 이번은 계측 작업이며 최적화 효과는 아직 측정하지 않았다. 근거는 [25](25-core-outcome-acceptance-stages.md)를 따른다.

Vite의 카탈로그 동결은 core `/runtime`의 `freezeCatalogs`를 사용한다. 같은 core 모듈의 깊은 순회 캐시를 공유하고, `Object.isFrozen`만으로 외부 객체를 신뢰하지 않는다. 전후 표본별 동결 합계 p50은 119.60→84.80ms였으나 일반 설정의 전체 성능은 별도로 재측정한다. 다음은 추가 최적화 없이 계측을 끈 small/large 종단 간 측정이며 근거는 [26](26-shared-catalog-freeze.md)를 따른다.

일반 prebundle의 규모별 50회 재측정에서 large 목록 p95는 621.18ms로 목표 미달이고 선택 p95는 631.70ms로 이전 일반 run보다 높게 관측됐다. 다음은 기본 prebundle을 유지한 서버 full 응답 준비·브라우저 수신 이후 구간을 나누는 benchmark 작업으로 정한다. 원인을 특정하거나 추가 제품 최적화를 먼저 적용하지 않으며 근거는 [27](27-shared-freeze-locale-add.md)를 따른다.

기본 prebundle의 full 응답 계측에서 수신 이후→DOM 구간이 50/50회 모두 수신 전 구간보다 컸다. 다음은 같은 설정에서 client 디코딩·검증·동결·snapshot과 React commit 구간 분리로 정한다. 먼저 prebundle 그래프에서도 core 깊은 동결 신뢰가 공유되는지 확인한다. 수신 후 p95 557.80ms를 특정 함수나 GC에 귀속하지 않으며 근거는 [28](28-full-reply-stages.md)를 따른다.

client 수신 이후 계측에서 같은 Vite 동결 카탈로그 참조가 core 수락에 50/50 전달됐지만 core의 깊은 동결 신뢰는 0/50이었다. core 동결 신뢰가 모듈 지역 WeakSet에 있어 dev의 core root prebundle과 `/runtime` subpath가 다른 graph면 공유되지 않는다. 다음 후보는 Vite `freeze.ts`가 `/runtime` 대신 core root의 기존 `freezeCatalogs`를 가져와 같은 prebundle 경로를 쓰는 것으로 정하고, production `astRuntime` parser 제거를 깨지 않는지 먼저 확인한다. 전역 WeakSet 제품 도입과 `Object.isFrozen` shallow 신뢰는 쓰지 않는다. 이번은 계측 작업이고 제품 최적화는 적용하지 않았다. 근거는 [29](29-prebundle-client-stages.md)를 따른다.

Vite 동결 import를 core root로 바꿔 개발 prebundle에서 깊은 동결 신뢰를 공유한다. 대규모 50회 모두 공유했고 production parser 제거도 유지했다. 다음은 상세 계측을 끈 small/large 50회 종단 간 재측정이다. 조건·한계는 [30](30-prebundle-freeze-sharing.md)를 따른다.

상세 계측을 끈 재측정에서 large 목록 p95는 268.54ms로 250ms 목표를 넘었다. 두 규모의 50회 모두 저장→broadcast 구간이 broadcast→목록 ack보다 컸다. 다음은 현행 large 서버의 경로 검사·파일 읽기·파싱·번역 준비를 재계측한 뒤 최적화를 정한다. 이번 측정만으로 특정 함수나 GC를 원인으로 확정하지 않으며 근거는 [31](31-prebundle-freeze-locale-add.md)를 따른다.

현행 large 서버 재계측에서 파싱이 10/10회 가장 컸다. parser core 5개 파일의 hash가 같은 기존 내부 계측도 재사용하며, 메시지 생성·동결 구간은 17/20회 가장 컸다. 다음 후보는 파서가 만든 메시지·숫자 위치의 구조를 활용해 일반 동결 순회를 줄이는 작은 실험이다. 깊은 불변성·소스 위치·ICU 오류와 외부 입력 처리를 유지하고 cold/incremental 교차 비교로 채택 여부를 정한다. 아직 구현하지 않았으며 근거는 [32](32-prebundle-server-measurements.md)를 따른다.

파서 소유 메시지·숫자 위치의 직접 동결 실험은 개선을 확인하지 못해 되돌렸다. cold 10/20쌍·incremental 47/100쌍만 빨랐고 두 비교의 p95는 높았다. 결과 원인을 확정하지 않으며 다음은 messageFreeze 내부 비용 분리이다. 재현 패치·원시·검증은 [33](33-owned-message-freeze-trial.md)를 따른다.

메시지 동결 구간을 분리한 결과 10k의 AST 동결이 하위 구간 중 18/20회 가장 컸다. 다음 작은 실험은 `freezeMessageAst` 내부 `seal` 함수를 모듈 범위로 옮겨 호출별 헬퍼 생성을 없애는 것으로 정한다. 헬퍼 생성만의 비용은 분리하지 않아 효과는 미확인이며, 깊은 동결 신뢰·ICU·위치 계약을 유지하고 cold/incremental 교차 비교로 판단한다. 이번은 계측 작업이며 제품 변경은 없다. 근거는 [34](34-message-freeze-stages.md)이다.

`freezeMessageAst` 내부 `seal`을 모듈 범위로 옮기는 단일 최적화를 채택했다. 깊은 동결 순회·`WeakSet` 신뢰·복잡한 ICU 일반 동결·공개 API는 유지한다. 두 비교의 파싱 p50·p95는 낮게 관측됐지만 쌍별 차이 p95는 양수이고 incremental 최장 시간은 늘어 안정적 tail 개선은 주장하지 않는다. 실제 로케일 목록 250ms 목표 개선은 아직 측정하지 않았다. 다음은 상세 계측을 끈 large locale-add 목록 재측정이다. 이 변경은 로컬이며 게시본에는 없다. 근거는 [35](35-shared-ast-seal.md)이다.

AST 동결 `seal` 모듈화 뒤 상세 계측을 끈 large locale-add 재측정에서 목록 p95는 767.54ms로 250ms 목표에 미달했고 250ms 이내는 11/50회였다. 직전 31 run의 large 268.54ms보다 p50·p95가 모두 크게 관측됐지만 두 run의 시점이 다르고 부하·GC를 통제하지 않아 파싱·GC나 `seal` 변경의 효과·퇴행으로 확정하지 않는다. 한 run이라 감소 효과도 확인하지 못했고 35 제품 변경 원복이나 추가 최적화는 적용하지 않는다. 다음은 변경 전후를 가까운 시점의 같은 조건으로 직접 대조하는 비교 측정이며 실효성은 미확인이다. 근거는 [36](36-shared-ast-seal-locale-add.md)이다.

AST 동결 `seal` 모듈화의 이득을 가까운 시점에서 확인하기 위해 변경 전 `cbd6871`과 공유 헬퍼 실험 `4f6b5cd`를 같은 조건의 격리 스냅샷으로 순차 대조했다. 순서는 before/after/after/before이고 네 run을 합쳐 measured 100·control 40이다. 두 블록(run 1↔2, run 3↔4) 모두 after 목록 p50·p95가 before보다 컸고 pooled 목록 p95는 547.74→682.94ms, 250ms 이내는 38/50→23/50이었다. Browser 선택 p95는 236.40→293.50ms, Node 선택 ack p95는 320.33→296.96ms로 지표별로 엇갈린다. 목록 목표는 두 variant 모두 미달이다. 표본별 paired·무작위 배정이 아니라 코드 퇴행의 인과를 확정하지 않고, 이득도 확인하지 못해 35의 `seal` 공유 제품 변경을 되돌렸다(원복 커밋 `d408500`). `diagnostics.ts`의 `seal`은 다시 `freezeMessageAst` 내부 함수가 되었고, 원복 뒤 명시 역사 ref 스모크와 `node --check`가 통과했다. 이 비교의 before 547.74ms는 현행 일반 단일 run 최신 p95가 아니고 36의 767.54ms와도 직접 비교하지 않는다. 근거는 [37](37-seal-locale-add-comparison.md)이다.

## 참고 자료

- [Vite HMR API](https://vite.dev/guide/api-hmr) — `handleHotUpdate` 커스텀 이벤트와 모듈 무효화
- [Vite 플러그인 API](https://vite.dev/guide/api-plugin) — `handleHotUpdate` 훅과 커스텀 이벤트 전달
- [React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — store 구독과 스냅샷 동일성
- [FormatJS ICU 문법](https://formatjs.github.io/docs/core-concepts/icu-syntax/) — 지원하는 메시지 문법
- [FormatJS intl-messageformat](https://formatjs.github.io/docs/intl-messageformat/) — AST 입력과 `ignoreTag`
- [Paraglide 메시지 컴파일](https://paraglidejs.com/compiling-messages) — 코드 생성 방식의 대기 지점
- [Wuchale 개발 모드](https://wuchale.dev/guides/dev/) — HMR 기반 반영 접근
- [TypeScript 선언 파일 배포](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html) — `.d.ts` 배포 형태
