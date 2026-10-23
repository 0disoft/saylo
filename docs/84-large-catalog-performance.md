# 84. 대형 카탈로그 snapshot 복사와 단일 값 편집

이 문서는 2026-10-24의 로컬 `main`에서 immutable catalog를 복사하고 단일 문자열 값을 편집할 때의 순회 비용을 줄인 기록이다. 제품 소스는 snapshot 복사를 바꾼 `9a206208cab6d806ba4e83db76088587c574ac30`(`9a20620`)과 단일 값 편집을 추가한 `7a844187661c062cf3d3d2726db53de8df7c9ac6`(`7a84418`)이다. 현재 package 버전은 `0.1.0-alpha.4`이며 버전 승격은 하지 않았다.

이 문서의 수치는 로컬 benchmark다. 검증 기록과 21개 raw 파일의 SHA-256은 [review JSON](../review/large-catalog-performance-2026-10-24.json)에 모았고 `78b181c`에 커밋했다. [83](83-push-subscription-maintenance.md)의 50회 결과와 [75](75-early-disk-rechecks.md)의 역사값은 바꾸지 않는다.

## snapshot 복사

대형 locale-add의 상세 client 계측에서 `freezeMs`가 병목 후보로 기록됐다. 최초 관측은 [client stages](../benchmarks/results/large-catalog-before-client-stages.json)와 [samples](../benchmarks/results/large-catalog-before-client-stages.10k-20-locales.samples.json)에 남겼다. 이 계측은 5표본 단일 조건이며 freeze가 전체 지연의 유일한 원인이라는 인과 증명은 아니다.

[`immutableSnapshot`](../packages/core/src/diagnostics.ts)은 transport로 받은 mutable catalog를 복사하면서 이 모듈이 이미 동결한 subtree는 공유한다. 변경 전에는 자식 객체를 재귀 복사한 뒤 새로 만든 copy에 `freeze`를 호출했다. `freeze`는 다시 모든 자식을 순회하므로, mutable catalog 하나에 복사 순회와 동결 순회가 두 번 발생했다.

`9a20620`은 자식 우선으로 복사하고 동결한다.

- 객체마다 자식을 `snapshot`으로 먼저 복사하거나 이미 동결된 subtree로 확인한다.
- 모든 자식이 준비된 뒤 현재 객체만 `Object.freeze`하고 모듈의 동결 집합에 넣는다.
- 새 copy의 자식은 이미 복사·동결됐거나 공유 가능한 immutable subtree이므로, 부모를 위해 전체 트리를 다시 순회하지 않는다.

객체 복사는 `Object.entries`를 한 번 순회하며 getter 평가 순서를 유지한다. null prototype은 그대로 재현하고, `__proto__`는 prototype setter를 타지 않도록 own data property로 정의한다. 배열은 `map`으로 자식을 먼저 처리한 뒤 현재 배열을 동결한다.

## 단일 문자열 편집

`7a84418` 이전에도 [`readCatalogJson`](../packages/core/src/catalog-json.ts)의 `editValue`가 공통 접두·접미 diff로 바뀐 구간을 찾고, 단일 JSON token 전체를 `JSON.parse`해 문자열인지 검증하는 경로가 있었다. 다만 이 경로는 모든 ID의 `JsonEntry[]`를 다시 만들었고, [`parseCatalog`](../packages/core/src/catalog.ts)는 전체 source의 `lineStarts`를 새로 인덱스했으며, message loop에서 모든 entry를 순회해 바뀌지 않은 message도 per-entry 비교를 거쳤다.

`7a84418`은 이 세 비용을 줄였다. 바뀐 entry 하나만 반환하고, 수정 token 내부 위치는 이전 message position에서 계산하며, 나머지 message record는 provenance의 물리 순서 배열로 한 번에 복사한다. 이 benchmark의 단일 값 편집 경로에서 변경 전후 모두 전체 JSON token scan을 하지 않았다.

[`catalog-json.ts`](../packages/core/src/catalog-json.ts)는 성공한 `parseCatalog`만 `WeakMap`에 provenance를 남긴다. provenance는 성공한 source, 물리 순서의 ID 배열, `Uint32Array`에 담은 key offset·value offset·value length 세 값이다. transport로 받은 catalog나 caller가 만든 catalog는 깊게 동결돼 있어도 provenance가 없으므로 전체 parser 경로를 쓴다.

[`catalog.ts`](../packages/core/src/catalog.ts)는 이전 catalog와 rich text policy signature가 같고 locale·namespace·sourceName이 같은 경우에만 빠른 경로를 시도한다.

1. `readCatalogEdit`가 공통 접두·접미 diff와 value offset 이진 탐색으로 바뀐 token 하나를 찾는다.
2. 바뀐 구간이 여는·닫는 따옴표를 건드리지 않고, token 전체를 `JSON.parse`했을 때 문자열일 때만 채택한다.
3. 바뀐 entry 하나만 message loop에 넣는다.
4. 나머지 message record는 provenance의 물리 순서 ID로 복사하고, 길이가 바뀌면 suffix position과 offset만 보정한다.

offset은 source의 물리 순서로 저장한다. 숫자처럼 보이는 key가 JavaScript 객체 열거에서 앞으로 오더라도 suffix 보정은 source 순서를 따른다. 새 message map은 null prototype이므로 `__proto__`도 일반 ID로 저장한다.

message map을 채울 때는 provenance의 ID 배열을 처음부터 끝까지 직접 순회한다. 바뀐 message 앞쪽은 이전 record를 그대로 넣고, 뒤쪽은 같은 길이 편집이면 그대로 넣는다. 길이가 바뀌면 뒤쪽 record의 position offset을 shift만큼 옮기고, 같은 line에 있는 값은 column도 shift한다. 별도 일괄 복사 단계를 두지 않고 복사와 위치 보정을 한 번의 순회로 합친다. 초기 일괄 복사 후보는 측정에서 더 느려 채택하지 않았다.

위치 계산도 수정 token 내부에 한정한다. 이전 message의 position을 기준으로 offset 차이만 더하며 전체 source의 line start 배열을 다시 만들지 않는다. JSON 문자열 token 내부에는 실제 LF가 들어갈 수 없으므로 line은 그대로 두고 column과 offset만 보정한다. 이 locator는 token 내부 위치에만 사용한다.

provenance의 `Uint32Array`는 같은 길이 편집이면 공유한다. 길이가 바뀌면 배열을 복사하고, 바뀐 entry의 value length와 suffix의 key·value offset만 보정한다. 이전 catalog와 그 message record는 동결된 채 남으며 새 catalog는 새 map을 갖는다.

다음 경우에는 빠른 경로를 쓰지 않는다.

- caller가 만든 이전 catalog, transport로 받은 catalog, 성공 parse provenance가 없는 catalog
- rich text policy signature가 달라진 경우
- 값 token 밖의 구조 변경, 여러 token 변경, 따옴표·escape로 JSON 구조가 바뀌는 편집
- locale·namespace·sourceName이 달라진 경우
- token 전체가 유효한 JSON 문자열이 아닌 경우

잘못된 JSON은 전체 parser 경로로 돌아가 기존과 같은 진단을 낸다. 잘못된 ICU는 이전과 같은 `CatalogError` 진단을 낸다. [`catalog.test.mjs`](../packages/core/test/catalog.test.mjs)는 이전 catalog를 기준으로 한 진단과 baseline 진단이 같은지 확인한다.

## 검증

- `7a84418` source에서 core test 122/122가 통과했다.
- 같은 source에서 targeted 67/67이 통과했다. 범위는 core catalog·rich, Vite patch·live registry, benchmark parser probe·comparison policy다.
- `catalog.test.mjs`는 CRLF와 들여쓰기, 숫자 key, `__proto__`, 길이 증가·감소, 이전 snapshot 불변, 갈라진 편집, 잘못된 ICU 진단 일치, rich policy 변경을 확인한다.
- 전체 536개 workspace check, 새 후보 동결, pack, tarball, registry 소비, 배포는 수행하지 않았다. review JSON의 `freshFullWorkspaceSuite`는 `false`다.

## single-value parser 비교

`7a84418` build에서 10,000 message catalog의 같은 길이 값 하나를 바꾸는 incremental parse를 before/after 교대로 100쌍 측정했다. warmup은 50회이고 same-process다. JSON.stringify, equality 검사, disk, watcher, validation, browser는 제외한다.

| variant | p50 | p95 |
| --- | ---: | ---: |
| before `9a20620` | 16.809ms | 38.7013ms |
| after `7a84418` | 8.2033ms | 25.4513ms |

paired 차이의 median은 -8.4756ms, paired 차이의 p95는 -2.3437ms이고 100쌍 중 97쌍이 개선됐다. 중간 후보의 첫 비교는 회귀여서 최종 결과로 쓰지 않았다. 이 표는 최종 구현 뒤 다시 측정한 [single-value parser 비교](../benchmarks/results/single-value-parser-comparison-2026-10-24.json)다.

이 측정은 파서 호출만 격리한 same-process microbenchmark다. browser 수신, disk, validation, 사용자 체감 지연을 포함하지 않으며 인과 증명이 아니다.

## locale-add snapshot-copy ABBA

`9a20620`의 snapshot 복사 효과를 browser locale-add large(10k×20)에서 본 소표본이다. before는 `046fa4d`, after는 `9a20620`이고 before/after/after/before 순서다. block마다 5표본, variant별 pooled 10표본, warmup 1, calibration 5다.

| 지표 | before p50 | after p50 | before p95 | after p95 |
| --- | ---: | ---: | ---: | ---: |
| 저장→목록 ack | 394.12ms | 350.07ms | 996.66ms | 818.33ms |
| 선택→번역 ack | 624.55ms | 502.72ms | 1,136.54ms | 869.99ms |
| 저장→번역 ack | 994.74ms | 812.81ms | 2,155.57ms | 1,709.99ms |
| 선택→DOM commit | 620.50ms | 499.10ms | 1,132.90ms | 865.20ms |
| 저장→broadcast | 379.00ms | 340.43ms | 949.45ms | 799.89ms |
| file write | 43.76ms | 33.42ms | 145.87ms | 633.93ms |
| control 왕복 | 10.67ms | 6.03ms | 69.46ms | 20.28ms |

표의 값은 raw JSON의 ms를 소수 둘째 자리로 반올림했다. 저장→목록 ack이 250ms 이내인 표본은 before 2/10, after 3/10이다. p50과 p95 모두 250ms 목표를 넘어 목표 미달이다. file write p95의 after 값은 한 표본의 큰 지연이 반영됐고, 이 소표본으로 file I/O 효과를 해석하지 않는다.

측정은 같은 장비에서 순차 독립 fresh Vite/browser run을 역순 block으로 실행했다. sample-level pairing, random 배치, forced GC, control·GC·cross-process clock 차감은 없다. 한 장비의 10+10 소표본이므로 인과 증명이 아니며 [83](83-push-subscription-maintenance.md)의 50회 결과와 직접 비교하지 않는다.

원시 결과는 [요약 JSON](../benchmarks/results/snapshot-copy-locale-comparison-2026-10-24.json)과 네 run 파일에 있다.

## edit large browser ABBA

`9a20620`과 `7a84418`을 비교한 edit large(10k×20) browser ABBA다. block마다 10표본, variant별 20표본, warmup 2, calibration 10이며 before/after/after/before 순서다. pooled 20표본 기준이다. 값 하나를 수정했고 저장→ack는 HTTP ack를 포함하며 receive→commit은 client 수신 뒤 commit 구간이다.

| 지표 | before p50 | after p50 | before p95 | after p95 |
| --- | ---: | ---: | ---: | ---: |
| 저장→ack | 148.2024ms | 114.0775ms | 245.1552ms | 198.4887ms |
| 저장→manifest broadcast | 93.1745ms | 55.4344ms | 193.3396ms | 118.0490ms |
| receive→commit | 42.6000ms | 46.0000ms | 47.7000ms | 59.0000ms |

저장→ack이 100ms 이내인 표본은 before 2/20, after 2/20으로 같다. p50과 p95 모두 100ms 목표를 넘어 목표 미달이다. receive→commit은 p50 42.6→46ms, p95 47.7→59ms로 늘었다. 이 구간이 늘어난 원인은 이 표본으로 확정하지 않는다.

file write는 before p50 19.6879ms·p95 42.2344ms, after p50 13.4155ms·p95 32.8843ms였다. control 왕복은 before p50 4.4321ms·p95 6.8805ms, after p50 3.9337ms·p95 6.7810ms였다.

같은 장비에서 순차 독립 fresh Vite/browser run을 역순 block으로 실행했고 random 배치, sample-level pairing, forced GC, control 차감은 없다. 한 장비의 20+20 표본이므로 인과 증명이 아니며 다른 장비나 조건으로 일반화하지 않는다. 새 50회 browser 측정은 추가하지 않았다.

원시 결과는 [요약 JSON](../benchmarks/results/single-value-edit-comparison-2026-10-24.json)과 네 run 파일에 있다.

## 릴리스 경계

- `9a20620`과 `7a84418`은 로컬 `main` 커밋이며 원격에 올리지 않았다. `78b181c`는 검증 기록과 raw hash를 남긴 로컬 커밋이다. npm publish, version promotion, 새 후보 동결도 하지 않았다.
- `.release/candidate-0.1.0-alpha.5-fTJYGI`는 `d3e5252` 동결 후보이며 두 최적화를 포함하지 않는다.
- admin 고객 지원 pilot([82](82-admin-support-pilot.md))의 추가 적용은 이 문서의 범위가 아니다.

## 원시 결과와 hash

- [검증 기록과 21개 evidence hash](../review/large-catalog-performance-2026-10-24.json) — `78b181c`
- [single-value parser 비교](../benchmarks/results/single-value-parser-comparison-2026-10-24.json)
- [snapshot-copy locale-add 비교](../benchmarks/results/snapshot-copy-locale-comparison-2026-10-24.json)
- [single-value edit large 비교](../benchmarks/results/single-value-edit-comparison-2026-10-24.json)
