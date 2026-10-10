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
| 20 | 로케일 목록 표시 p95 ≤ 250ms (06) | 54 조건 통과·후속 현행 미달(58) | `docs/54` after 두 run p95 193.56·184.78ms; 후속 `8f25416` single run 322.35ms(58) | 다른 조건의 안정 달성은 미확인 |

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
2. 편집 large 100ms 목표 미달 원인을 줄인다. 로케일 large 250ms 목표는 54의 두 after run에서 통과했으나, 후속 `8f25416` single run은 편집·로케일 모두 미달이다(58).
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

기능 범위(1~18)는 소스·테스트 구현 근거가 존재한다. 성능 범위는 로케일 목록이 54 조건에서 통과했고(후속 현행 single run은 미달, 58), 편집 반영은 미달이다. 전체 인수·제품 형태 비교와 미게시 변경 전달도 남아 있으므로 장기 목표의 완료를 주장하지 않는다.

### 후속 진행

`4aacb93`에서 신규 파싱 프로파일을 기록했고 `169e72b`에서 단순 인자 스키마 반복 생성·직렬화를 줄였다. 관련 테스트 93개와 core 소비 타입 검사가 통과했고 파서 교차 비교의 cold 두 run 모두 p50/p95가 낮았다. [54](54-plain-argument-contracts.md)의 실제 브라우저 ABBA 비교에서 로케일 after 두 run p95는 193.56·184.78ms로 이번 large 조건의 250ms 목표에 들어왔지만, 편집 after pooled p95 197.22ms는 100ms 목표를 넘었다. 로케일 항목은 이번 조건의 측정 통과로 갱신하며, 편집 개선·최종 인수·얇은 기존 도구 계층 비교·미게시 변경 전달 작업은 계속 남아 있다.

2026-10-11(KST), `ed2bc8c` 이후 패치 생성 할당 최적화를 포함한 소스에서 `npm run check`가 통과했다(테스트 206개·다섯 패키지 소비자 타입 검사·React 예제 타입 검사). 이미 빌드한 dist로 `npm exec -- node scripts/pack-smoke.mjs`를 실행해 다섯 tarball의 독립 JS·TS 소비, React·Svelte selector SSR, Vite 8.3.4 production·SSR 실행을 확인했다. 릴리스 승인 기록은 저장하거나 바꾸지 않았다. 최신 large 편집 단일 run p95는 161.53ms로 여전히 100ms 목표를 넘었다. 원시 자료와 측정 한계는 54의 후속 절을 따른다.

2026-10-11(KST), `2aa5f7d` 기준 편집 large 비교를 다시 기록했다. after pooled p95는 107.49ms이고 100ms 이내 표본은 before 0/50·after 44/50이다. ABBA run p95는 after 107.49·101.75ms, before 140.26·134.60ms이고 queueToDrain pooled는 46.25→2.67ms다. control RTT p95도 5.26→3.33ms로 함께 낮아졌고 순차 독립 실행이라 인과로 보지 않는다. 1~18 기능의 상태는 위 표 그대로이고, 로케일 large 목표는 54의 통과 기록을 유지하며 편집 100ms 목표는 여전히 미달이다. 상세는 [55-next-turn-edits.md](55-next-turn-edits.md)를 따른다.

## 근거 문서

추가 관측: `2aea993`의 missing-reader 안정화 회귀를 포함해 Vite 테스트 90개와 소비자 타입 검사가 통과했다. 후속 단독 large 편집 p95는 252.95ms·100ms 이내 2/25로 목표에 미달했다. 55에 원시 기록과 이전 ABBA 비교를 함께 보존한다. 얇은 계층의 Node 계약 초기 검증은 36개 관측을 완료했으며, 브라우저·지연 로딩·typegen·운영 번들·시간대·성능 비교는 아직 남아 있다.

`01`·`02`·`04`·`05`·`06`·`07`·`08`·`09`·`13`·`38`·`39`·`42`·`43`·`44`·`45`·`46`·`48`·`49`·`50`·`51`·`52`·`54`, `releases/0.1.0-alpha.3.json`, `packages/*/README.md`, `review/feedback-resolution.ko.md`.

## 후속 기록 (`463083e`, `8f25416`)

- Vite watcher가 짧은 시간의 두 번째 저장을 전달하지 못하는 문제를 꼬리 디스크 재확인으로 복구한다(fresh Vite SSR 5개 케이스 모두 `recovered: true`).
- `--gap-ms 0` 브라우저 스모크 8개 시나리오, final Vite 93개 테스트·build PASS. Vite 소비자 typecheck는 공개 API 변경 전 코드로 PASS.
- 전체 root `check`·`release:pack`은 돌리지 않았다. 이번 Vite 경로 한정 검증이다.
- final same-condition large single run은 두 성능 목표 모두 미달이다(편집 100ms 목표 133.63ms·17/25, 로케일 250ms 목표 322.35ms·21/25).
- 공개 API·의존성·버전은 그대로, 로컬 커밋만 했고 push·publish는 없다.
- 상세는 [58-trailing-disk-rechecks.md](58-trailing-disk-rechecks.md)를 따른다.

## 후속 기록 (`5558185`, `432ca35`, `1ab93d5`)

- core에 이전 성공 파싱의 JSON leaf 범위를 재사용하는 단일 문자열 편집 경로를 넣었다. provenance는 성공 파싱만 `WeakMap`에 남기고 키·구조·다중 값 변경, 유효한 단일 문자열로 파싱되지 않는 JSON, foreign catalog는 full strict parse로 되돌린다. 변경된 ICU·스키마 계약도 기존 검증을 따른다.
- parser paired 비교(`json-leaf-compare-2026-10-11.json`, beforeRef `78b23b7`)는 same-length p95 44.02→12.09ms(100/100), variable-length 152.23→83.73ms(99/100), cold 92.41→92.58ms(10/20)다. cold는 이득을 주장하지 않는다.
- 종단 간 편집 single run은 small p50 16.31·p95 80.12ms(25/25), large p50 67.36·p95 95.25ms(24/25, 최대 124.11ms)이고 full 응답 0회·`.d.ts` 미변경이다. single run이라 안정 달성을 주장하지 않는다.
- 같은 조건 로케일 추가 single run은 small p95 135.22ms(250ms 이내 25/25), large p50 196.64·p95 268.58ms(250ms 이내 23/25)로 large가 목표 미달이다.
- fresh Vite SSR 복구 5/5 `true`, 얇은 계층 브라우저 스모크 8개 PASS는 프로토타입 범위 기록이다. 현행 `npm run check` PASS(모든 build·workspace test·소비자 typecheck·React typecheck·scripts, Vite 테스트 94개)와 `parser-probe` 1 PASS를 기록에 함께 남긴다.
- 본체 source API·의존성·버전은 그대로이고 로컬 커밋만 했으며 push·publish는 없다. 원시 결과는 `9743a38`에 함께 커밋됐다.
- 상세는 [59-json-leaf-edits.md](59-json-leaf-edits.md)를 따른다.

## 후속 기록 (`32e120c`)

새 경로의 카탈로그 추가는 40ms 안정화 대기 없이 다음 이벤트 루프 턴에 읽도록 했다. 기존 파일 교체·삭제와 ENOENT 안정화, 60ms 꼬리 metadata 재확인은 유지한다. 두 최초 파싱 최적화 실험은 이득이 없어 원복했다. 일반 조건 단일 run의 목록 p95는 small 91.62ms·large 189.30ms이며, large는 250ms 이내 24/25·최대 402.11ms여서 안정 달성을 주장하지 않는다. 전체 `npm run check`(Vite 95개 포함)와 이후 테스트만 추가한 plugin 43개가 통과했다. 원격 반영은 없고 전체 얇은 계층 비교·성능 안정성·미게시 변경 릴리스 결정은 남아 있다. 원시 자료·실험·교차 측정은 [60](60-next-turn-additions.md)을 따른다.

동일 두 소스만 치환한 ABBA 후속 비교는 목록 p50 214.09→150.97ms, 250ms 이내 31/50→40/50이지만 pooled p95 417.47→642.02ms로 목표 미달이다. after 두 run도 각각 642.02·463.31ms다. control·파일 쓰기 시간도 달라져 인과를 확정하지 않으며 대기창 제거의 성능 채택은 잠정 상태로 둔다. 상세 파일 계측은 after의 1회 읽기 가정을 만족하지 못해 종료했고 해당 시도에 after·pooled 결과는 없다. 정상 조건 ABBA와 복구 5개·프로토타입 브라우저 8개는 완료했다. 근거와 재현은 60을 따른다.

2026-10-11(KST), 새 카탈로그 경로의 single-read 단정이 실제로 실패한 기록을 추가했고(`c19ca34`), 중복 cold parse는 superseded 성공 파싱을 파일별로 넘겨 최신 읽기에서 재사용하도록 고쳤다. 제품 `c19ca34` 루트 `npm run check` 223개와 이후 tests-only schema 케이스 plugin 48개가 통과했지만, 정상 벤치는 large만 250ms 목표에 들어오고 small은 미달이라 성능 안정성 목표는 미달이다. 상세와 실패 trace는 [61-superseded-parse-reuse.md](61-superseded-parse-reuse.md)를 따른다.

2026-10-11(KST), `a0e47d5`에서 benchmark 계측만 고쳐 각 drain의 callback과 `prepareTranslations`를 `AsyncLocalStorage`로 자기 batch에 묶고 겹치는 대기창을 union으로 계산했다. 제품 소스 `c19ca34`와 출고 package·dist·clock에는 손대지 않았다. 상세 계측 조건 단일 run은 목록 p95 115.88ms·250ms 이내 24/25이고 [61](61-superseded-parse-reuse.md)의 일반 조건 기록은 역사값으로 보존한다. 성능 안정성 목표와 나머지 후보는 여전히 미완이다. 상세는 [62](62-multi-read-measurements.md)를 따른다.

2026-10-11(KST), 얇은 계층의 시간대 계약을 Node에서 관측했다(`benchmarks/thin-layer/timezone-probe.mjs`, [원시 결과](../benchmarks/results/thin-layer-timezone-2026-10-11.json)). UTC·Asia/Seoul·America/Los_Angeles 3개 호스트에서 168건을 보고, 현행 계층이 시간대 옵션 없이 호스트 시간대를 그대로 쓰며 서울·LA에서는 UTC 기준값과 각각 42건 어긋남을 기록했다. 공개 `formats`로 named style을 UTC에 고정하면 두 호스트의 미일치는 각각 14건으로 줄지만 기본 date·skeleton은 남는다. 제품 소스·dist 변경은 없었고, 판정은 thin-layer 시간대 미충족이다. 상세는 [63](63-thin-layer-timezone.md)를 따른다.

2026-10-11(KST), 얇은 계층 시간대를 어댑터로 고쳤다(`5fec231`). main adapter가 i18next-icu 대신 공개 `i18nFormat` 모듈을 직접 구현하고 snapshot·engine마다 timeZone을 고정한다. `timezone.test` 5개, 기존 계약 프로브 36개, 브라우저 8단계가 통과했고 Node 336비교에서 default UTC·명시 host 불일치가 모두 0이다. native ICU named 우회의 0/14/14는 참고 기준으로 보존한다. `packages/vite`·버전은 그대로이고 SSR·브라우저 시간대 매트릭스는 아직이다. 실제 production build는 [64](64-thin-layer-timezone-adapter.md)에 있고, layer가 parser marker를 실어 production parser-free gate는 미충족이다.

2026-10-11(KST), benchmark 전용 helper `ast-runtime.mjs`로 prototype AST-only production formatter에서 parser emission을 제거했다(`d04c841`). 실제 production build 4개 중 `layer-ast`가 marker false·no-parser entry 2이고, unrelated 문자열 IMF 경로는 그대로 둔 채 작은 fixture에서 gate를 닫았다. 제품 package·공개 API는 그대로이고 SSR hydration·lazy·전체 계약·large scale 성능·production browser는 아직이다. 상세는 [65](65-thin-layer-ast-production.md)를 따른다.
