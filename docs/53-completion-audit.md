# 53. 완료 감사

관측일 2026-10-10(KST). 이 문서는 원래 명시된 요구사항과 로드맵을 현행 소스·테스트·기록에 대조해 완료·부분 완료·남은 작업을 구분한다. 대상 revision은 로컬 HEAD `40bfa5a`이고, 제품 소스 최적화는 `169e72b`, 최초 작성 시점은 `ae40ba6`이었다.

## 감사 방법과 한계

- 확인한 자료는 `docs/01`~`09`, `docs/42`~`44`, `docs/45`~`52`, 루트 `README.md`와 `packages/*/README.md`, `packages/*/package.json`의 exports, `packages/*/test` 파일 목록, `review/feedback-resolution.ko.md`, GitHub issue·CI 조회 결과이다.
- 최초 감사는 파일 조회로 작성했다. 이후 54의 실제 Vite·브라우저 비교와 원시 표본 재계산 결과를 반영했다. 기능 표의 테스트 이름은 구현 근거이며 전체 인수 검사의 통과 판정이 아니다.
- `docs/06`·`README.md`의 이력 측정은 필요한 표와 최신 절만 읽었고, 원시 bench JSON·cpuprofile 전문은 읽지 않았다.
- 문서와 현행 코드가 어긋나면 `packages/*/src`를 우선한다.
- 소스 근거는 파일·심볼이 존재함을 확인한 것이다. 54의 성능 비교는 해당 경로를 실행 검증했다. 최종 인수는 현행 source 기준 `npm run check`·`release:pack`·브라우저 게이트를 통과시켜 확정한다.
- 부모 작업 커밋(`ae40ba6` 이후 다수, `169e72b` 포함)은 로컬에만 있고 미푸시다. 감사 중에도 부모의 다른 변경이 작업 트리를 오갔고, 이 감사는 소스·벤치 파일을 수정하지 않았다.

## 1. 원래 명시 요구사항 대조

| # | 요구사항 (출처) | 상태 | 현행 근거 | 남은 작업 |
| --- | --- | --- | --- | --- |
| 1 | 문구 수정 즉시 반영·재컴파일 대기 제거 (01, 07) | 게시 alpha.3 | vite `index.ts` hotUpdate, core `catalog.ts`·`store.ts`; vite `plugin.test`·`client.test` | 없음(기능) |
| 2 | 로케일 추가 즉시 반영 (01, 07) | 게시 | vite `live-registry.ts`; vite `server.test`·`lazy.test` | 최신 large 조건 성능 통과(3절) |
| 3 | namespace 추가 (01) | 게시 | core `loading*`·`i18n.ts`; vite `lazy.test` | 없음 |
| 4 | atomic save·rename·delete 수렴·tombstone (02, 04) | 게시 | vite `catalog-registry.ts` tombstone, core `loading-registry.ts` STALE_MANIFEST; vite `server.test` | 없음 |
| 5 | DOM 상태 보존(입력·포커스·모달·스크롤) (01, 07) | 게시 | react `hydration.test`, svelte `components.test`, `examples/*` | 네이티브 브라우저 재검증은 릴리스 단계 한정 |
| 6 | 실패 시 last-good 유지·resync (04) | 게시 | vite `translation-quarantine.ts`, core `loading`·`i18n`; vite `wire.test` | 없음 |
| 7 | JS/TS 동시 지원 (01, 07) | 게시 | 소비 fixture, `typecheck:consumers`, `scripts/pack-smoke.mjs` | 없음 |
| 8 | typegen 배경 생성·race (04) | 게시 | `typegen/src`; `typegen.test`·`generator-race.test`·`replace.test` | 없음 |
| 9 | 세션 handshake·gap·resync (08) | 게시 | vite `dev-sync.ts` EagerSync·`lazy-connection.ts`·`catalog-source.ts`·`catalog-wire.ts`; vite `client.test`·`lazy.test`·`wire.test` | 없음 |
| 10 | 변경 메시지별 patch 전송 (06 로드맵 13) | 게시 | vite `catalog-patch.ts` createCatalogPatch·applyCatalogPatch, `client.ts`; `patch.test` | 없음 |
| 11 | lazy 부분 전송·pair version (06 로드맵 10b) | 게시 | core `loading-registry.ts`·`catalog-loader.ts`; vite `catalog-source.ts`·`lazy-connection.ts`; core `loading.test`, vite `lazy.test` | 없음 |
| 12 | static production loader (05, 11) | 게시 | vite `index.ts` 가상 모듈 생성, `static-catalog-source.ts` createStaticCatalogSource; `production.test` | 없음 |
| 13 | parser 런타임 제거(`/runtime`·astRuntime) (07) | 게시 alpha.2 | core `runtime.ts`, vite `ast-formatter.ts`; `production.test` | 없음 |
| 14 | SSR serializer·hydration (06 로드맵 12) | 게시 | core `boot.ts`, react `hydration.test` | 없음 |
| 15 | React 어댑터·selector 미세구독 (43) | 어댑터 게시, selector 로컬 | react `index.ts` useI18nSelector; `selector.test` | 게시 시 릴리스 검증 |
| 16 | Svelte 어댑터·selector (44) | 어댑터 alpha.2 게시, selector 로컬 | svelte `index.ts` selectSvelteStore·getI18nSelector; `selectors.test` | 게시 시 릴리스 검증 |
| 17 | SvelteKit 예제 SSR·hydration 검증 (39) | 게시 | `examples/sveltekit`, `scripts/pack-sveltekit.mjs` | 없음 |
| 18 | 릴리스 패키지 소비 검증 (09) | 게시 | `scripts/pack-smoke.mjs`, `verify:registry:alpha3` | selector 포함 재검증 필요 |
| 19 | 편집 반영 p95 ≤ 100ms (06) | 미달 | `docs/45`·`51`·`52` | tail 원인 분리·최적화 |
| 20 | 로케일 목록 표시 p95 ≤ 250ms (06) | 최신 large 조건 통과 | `docs/54` after 두 run p95 193.56·184.78ms | 다른 조건의 안정 달성은 미확인 |

## 2. 로드맵 1~13 직접 확인

`docs/06`은 1~13단계 로컬 구현 완료로 기록한다. 아래는 해당 기능의 소스·테스트 구현 근거가 존재함을 확인한 매핑이며, 동작·성능을 실행 검증한 결과가 아니다.

| 단계 | 소스 근거 | 테스트 근거 |
| --- | --- | --- |
| 1~4 | core `catalog.ts`·`translator.ts`·`store.ts` | core `catalog`·`translator`·`store`·`snapshot-signature` |
| 5~6 | vite `index.ts`·`dev-sync.ts`·`live-registry.ts` | vite `plugin`·`client`·`server` |
| 7 | react `index.ts` | react `react.test` |
| 8 | typegen `src` | typegen `typegen`·`generator-race`·`replace` |
| 9 | vite `dev-sync.ts`·`lazy-connection.ts`·`catalog-source.ts` | vite `client.test`·`lazy.test`·`wire.test` |
| 10a·10b | core `loading-registry.ts`·`i18n.ts`, vite `catalog-source.ts`·`lazy-connection.ts` | core `loading.test`, vite `lazy.test` |
| 11 | vite `index.ts`·`static-catalog-source.ts` | vite `production.test` |
| 12 | core `boot.ts` | react `hydration.test` |
| 13 | vite `catalog-patch.ts`·`client.ts` | vite `patch.test` |

1~13단계는 기능 범위에서 구현 근거가 존재한다. 이 판정은 실행 검증이 아니며, 성능 목표 달성이나 게시 완료를 뜻하지 않는다. 43·44가 서술한 selector·리뷰 수정·맵 최적화와 `169e72b`의 plain argument contract 재사용은 게시본에 없다.

## 3. 성능 목표 현황

| 측정 | 조건 | 최근 기록 | 목표 | 판정 |
| --- | --- | ---: | ---: | --- |
| 편집 반영 p95 | small 1k×3 | 80.08ms (45) | ≤100ms | 1런 통과 |
| 편집 반영 p95 | large 10k×20 | 398.73ms (45) / 168.50ms (52) | ≤100ms | 미달 |
| 로케일 목록 p95 | small | 251.27ms (45) | ≤250ms | 경계 초과 |
| 로케일 목록 p95 | large | 627.48ms (45) / 479.67ms (52) | ≤250ms | 미달 |
| 편집 교차 p95 (전→후) | large ABBA | 212.52→300.98 (51) | ≤100ms | 0/50 → 0/50 |
| 로케일 교차 p95 (전→후) | large ABBA | 309.09→704.48 (51) | ≤250ms | 46/50 → 34/50 |
| plain contract 편집 교차 p95 (전→후) | large ABBA | 259.15→197.22 (54) | ≤100ms | 0/50 → 0/50 |
| plain contract 로케일 교차 p95 (전→후) | large ABBA | 536.37→193.56 (54) | ≤250ms | 36/50 → 48/50 |

편집 목표는 small 1회 기록을 뺀 나머지 조건에서 달성하지 못했다. 54의 로케일 after 두 run은 p95 250ms 안에 들었으며 pooled 표본 48/50이 목표 안에 들었다. 순차 ABBA 결과는 이번 large 조건의 관측이며 모든 환경의 안정 달성이나 인과 증명은 아니다. 49의 맵 동결 최적화는 51의 종단 간 교차 비교에서 p95가 오히려 커져 채택이 잠정 상태다. 52는 편집 최장 표본이 51의 300~400ms를 재현하지 못했고, 로케일 최장 표본도 GC 교집합이 0이라 tail 원인을 파싱 하나로 확정하지 않았다.

참고로 `ae40ba6`의 cold 파서 프로파일은 p50 73.66ms·p95 159.48ms였고, `169e72b`는 cold 교차 비교 첫 20쌍에서 median -27.81ms·19/20 개선을 관측했다. 이는 파서 구간 값이며 위 두 종단 간 목표의 달성을 뜻하지 않는다. 상세는 [54-plain-argument-contracts.md](54-plain-argument-contracts.md)를 따른다.

## 4. 원격 상태 관측

- npm: 다섯 패키지 `0.1.0-alpha.3`·dist-tag `alpha` 게시 완료(문서 기록, `releases/0.1.0-alpha.3.json`). `latest`는 placeholder `0.0.0-stage`를 유지한다.
- 부모가 2026-10-10 registry를 직접 조회해 다섯 패키지 `alpha.3` 게시와 `latest` placeholder를 모두 확인했다. 위 npm 항목은 문서 기록이고 이 줄은 직접 조회 결과다.
- 게시본에 없는 로컬 변경: React·Svelte selector, 리뷰 수정 커밋, 파서 소유 메시지 맵 최적화, plain argument contract 재사용(`169e72b`).
- GitHub open issue는 `#1 Dependency Dashboard` 1건뿐이다(2026-10-10 조회).
- 최신 CI run `37935637066`은 head `534a912`, conclusion `success`이다(조회 확인). 로컬 HEAD `169e72b`는 그 이후 커밋을 포함한다.

## 5. 남은 필수 작업 (순차)

1. 완료: `169e72b`의 편집·로케일 종단 간 경로를 54에서 비교했다.
2. 편집 large 100ms 목표 미달 원인을 줄인다. 로케일 large 250ms 목표는 54의 두 after run에서 통과했다.
3. 49의 맵 동결 최적화 채택 여부를 tail 원인 규명 결과와 함께 확정한다.
4. selector 게시 여부를 결정하고, 게시하면 `check`·`release:pack`·`verify:registry:*`·SvelteKit 검증을 해당 버전으로 수행한다.
5. i18next·Wuchale 확장점 위 얇은 계층 비교 실험으로 제품 형태(독립 런타임 정당화)를 판정한다.
6. 현행 상태 문서(`06` 로드맵, `README.md`, `07` 대장)를 최신 커밋·수치에 맞춰 갱신한다.

## 6. 잔여 후보의 필수성 평가

| 후보 | 필수 여부 | 근거 |
| --- | --- | --- |
| 얇은 i18n 레이어 계약 비교 | 필수 | `07` 제품 형태가 독립 런타임 정당화를 이 실험에 걸어 두었다. 56의 Node 초기 검증은 완료했으나 전체 계층 비교는 남아 있다. 릴리스 차단은 아니다 |
| 메모리 overhead 측정 | 비필수 | 성능 목표는 wall-clock p95이고 메모리 수치 목표는 명시되지 않았다. 16의 compact 전송 도입 뒤 남긴 진단 |
| test·pack·release 재검증 | 조건부 필수 | `09`의 릴리스 게이트다. selector를 게시할 때만 해당 버전으로 다시 돌린다 |
| 파서 소유 맵 최적화 확정 | 필수 | 51·52가 tail 악화를 남긴 잠정 상태라 채택·원복을 닫아야 한다 |

## 7. 비목표·미래 제안 (필수 작업과 분리)

- unused message 제거 최적화: 동적 t 키 tradeoff 검증이 필요하다(07, 비목표).
- Vue 어댑터, core selector 미세구독, rich text 보간: 초기 범위 밖 후속이다(01, 07).
- Paraglide large 초기 compile 실패 원인 분리와 성공 조건 재측정: 비교 실험 후속이다(13).
- 위 항목은 완료 판정이나 릴리스 게이트에 넣지 않는다.

## 8. 완료 판정

기능 범위(1~18)는 소스·테스트 구현 근거가 존재한다. 성능 범위는 로케일 목록이 최신 large 조건에서 통과했고 편집 반영은 미달이다. 전체 인수·제품 형태 비교와 미게시 변경 전달도 남아 있으므로 장기 목표의 완료를 주장하지 않는다.

### 후속 진행

`4aacb93`에서 신규 파싱 프로파일을 기록했고 `169e72b`에서 단순 인자 스키마 반복 생성·직렬화를 줄였다. 관련 테스트 93개와 core 소비 타입 검사가 통과했고 파서 교차 비교의 cold 두 run 모두 p50/p95가 낮았다. [54](54-plain-argument-contracts.md)의 실제 브라우저 ABBA 비교에서 로케일 after 두 run p95는 193.56·184.78ms로 이번 large 조건의 250ms 목표에 들어왔지만, 편집 after pooled p95 197.22ms는 100ms 목표를 넘었다. 로케일 항목은 이번 조건의 측정 통과로 갱신하며, 편집 개선·최종 인수·얇은 기존 도구 계층 비교·미게시 변경 전달 작업은 계속 남아 있다.

2026-10-11(KST), `ed2bc8c` 이후 패치 생성 할당 최적화를 포함한 소스에서 `npm run check`가 통과했다(테스트 206개·다섯 패키지 소비자 타입 검사·React 예제 타입 검사). 이미 빌드한 dist로 `npm exec -- node scripts/pack-smoke.mjs`를 실행해 다섯 tarball의 독립 JS·TS 소비, React·Svelte selector SSR, Vite 8.3.4 production·SSR 실행을 확인했다. 릴리스 승인 기록은 저장하거나 바꾸지 않았다. 최신 large 편집 단일 run p95는 161.53ms로 여전히 100ms 목표를 넘었다. 원시 자료와 측정 한계는 54의 후속 절을 따른다.

2026-10-11(KST), `2aa5f7d` 기준 편집 large 비교를 다시 기록했다. after pooled p95는 107.49ms이고 100ms 이내 표본은 before 0/50·after 44/50이다. ABBA run p95는 after 107.49·101.75ms, before 140.26·134.60ms이고 queueToDrain pooled는 46.25→2.67ms다. control RTT p95도 5.26→3.33ms로 함께 낮아졌고 순차 독립 실행이라 인과로 보지 않는다. 1~18 기능의 상태는 위 표 그대로이고, 로케일 large 목표는 54의 통과 기록을 유지하며 편집 100ms 목표는 여전히 미달이다. 상세는 [55-next-turn-edits.md](55-next-turn-edits.md)를 따른다.

## 근거 문서

추가 관측: `2aea993`의 missing-reader 안정화 회귀를 포함해 Vite 테스트 90개와 소비자 타입 검사가 통과했다. 후속 단독 large 편집 p95는 252.95ms·100ms 이내 2/25로 목표에 미달했다. 55에 원시 기록과 이전 ABBA 비교를 함께 보존한다. 얇은 계층의 Node 계약 초기 검증은 36개 관측을 완료했으며, 브라우저·지연 로딩·typegen·운영 번들·시간대·성능 비교는 아직 남아 있다.

`01`·`02`·`04`·`05`·`06`·`07`·`08`·`09`·`13`·`38`·`39`·`42`·`43`·`44`·`45`·`46`·`48`·`49`·`50`·`51`·`52`·`54`, `releases/0.1.0-alpha.3.json`, `packages/*/README.md`, `review/feedback-resolution.ko.md`.
