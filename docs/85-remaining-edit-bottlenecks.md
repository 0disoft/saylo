# 85. 남은 편집 병목과 100ms 목표

이 문서는 2026-10-24의 로컬 `main`에서 대형 catalog의 한 키 편집에 남은 병목을 줄인 기록이다. 제품 소스는 `35b13504ccfb14098c54f51f55863361514bbd29`(`35b1350`)와 `7ccfdba6ca9a0628246620eba13d7c98f82f0bd9`(`7ccfdba`)다. `14cea4c852e074bf1e6ccaa9da8b346c7f21c841`(`14cea4c`)은 성능 계측 경계를 고친 커밋이다. package 버전은 `0.1.0-alpha.4`이며 버전 승격은 하지 않았다.

목표는 10,000 message×20 locale catalog에서 key 하나를 수정할 때 저장→DOM ack p95를 100ms 이내로 낮추는 것이다. 최종 50회 측정은 이 조건의 p95 목표를 통과했다. 한 장비·한 세션의 결과이며 다른 환경, 렌더링 작업, I/O 조건에서 같은 값을 보장하지 않는다.

## 병목과 변경

`35b1350`은 편집 경로에서 유지 message를 반복 처리하는 비용을 줄였다.

- [schema.ts](../packages/core/src/schema.ts)의 translation 검증은 10,000개 message마다 entry tuple을 만드는 `Object.entries` 대신 `for...in`과 own key 검사를 쓴다. 이미 검증된 message를 순회하기 위해 tuple 배열을 할당하지 않는다.
- [catalog-patch.ts](../packages/vite/src/catalog-patch.ts)의 patch 생성은 own key 배열로 remove·upsert를 판정한다. 이전 message와 같은 객체이거나 `richTextTags` 참조가 같으면 문자열 직렬화 비교를 생략한다.
- patch 적용은 전체 message map을 `Object.assign`으로 복사하지 않는다. own key를 직접 복사하고 remove·upsert에서 message 개수를 증분 관리해 마지막에 key 배열을 다시 만들지 않는다.

`14cea4c`은 [runtime-profile.mjs](../benchmarks/live-update/runtime-profile.mjs)가 과거 `Promise.all` 코드 모양을 찾던 경계를 현재 `bounded('Base catalog existence check', ...)`의 `mapFileTasks` 존재 검사로 바꿨다. 현재 source의 변환 경계를 확인하는 검사를 포함해 runtime 계측 test 3개가 통과했다.

`7ccfdba`는 patch 결과를 다시 동결할 때 생기던 대형 map 재복사를 줄였다. caller가 넘긴 baseline은 `freezeCatalogs(..., { copy: true })`로 snapshot해 외부 mutable 입력과 분리한다. patch의 upsert child도 `copy: true`로 복사·동결한다. position 교체는 새 객체를 쓴다. 새 owned map과 root만 `copy: false`로 동결하므로, 이미 신뢰하는 immutable baseline의 자식 message는 공유하고 결과 생성 뒤 10,000개 map을 다시 복사하지 않는다.

[catalog-registry.ts](../packages/vite/src/catalog-registry.ts)의 동등성 검사는 message 차이를 찾는 즉시 종료한다. 양쪽 map 크기를 재기 위해 `Object.keys` 배열을 두 번 만들지 않고, 같은 message 참조는 세부 비교 전에 건너뛴다. caller 입력 불변과 immutable child 공유를 확인하는 test도 추가했다.

## 단위 비교

[patch CPU 비교](../benchmarks/results/sparse-patch-cpu-2026-10-24.json)는 10,000 message에서 create/apply를 교대로 100쌍 측정했다. warmup은 20회다. JSON round-trip한 patch를 입력으로 쓰고, 각 쌍의 결과를 deep equality로 확인한다. 입력 준비와 equality 검사는 측정 구간 밖이다. same-process microbenchmark이며 browser, disk, watcher를 포함하지 않는다.

| 시나리오 | before p50 | after p50 | before p95 | after p95 | 개선 pair |
| --- | ---: | ---: | ---: | ---: | ---: |
| same length | 11.8751ms | 7.4824ms | 20.4303ms | 11.3397ms | 97/100 |
| uniform shift | 12.9193ms | 9.0635ms | 24.2372ms | 16.2400ms | 96/100 |
| mixed | 11.1258ms | 7.8099ms | 18.7796ms | 12.8266ms | 93/100 |

apply만 보면 세 시나리오의 p50이 10.3902→3.7112ms, 20.5433→9.8669ms, 12.1710→6.1609ms였다. 이 표는 patch 함수 비용을 분리한 결과이며 사용자 체감 지연의 인과 증명이 아니다.

## 첫 browser ABBA

[첫 sparse-patch ABBA](../benchmarks/results/sparse-patch-edit-comparison-2026-10-24.json)는 before `d0483a6`과 after `35b1350`을 before/after/after/before 순서로 비교했다. block마다 10표본, variant별 pooled 20표본, warmup 2, calibration 10이다.

| 지표 | before | after `35b1350` |
| --- | ---: | ---: |
| 저장→ack p50 | 93.2164ms | 67.0457ms |
| 저장→ack p95 | 118.7416ms | 121.7816ms |
| 100ms 이내 표본 | 14/20 | 18/20 |

p50과 목표 안 표본 수는 늘었지만 p95는 121.7816ms로 목표에 미달했다. 이 비교는 최종 `7ccfdba`를 포함하지 않는다. 최종 50회 통과값과 합쳐 `35b1350`이나 `7ccfdba`의 인과 효과를 주장하지 않는다.

## 최종 50회

[최종 측정](../benchmarks/results/remaining-edit-final-2026-10-24.json)은 `7ccfdba`에서 warmup 5회, calibration 25회, 표본 50회로 실행했다. CPU, browser, server file, reply, client 상세 계측은 모두 껐다. Chromium headless의 React development mode에서 10,000 message×20 locale, 한 키 수정, DOM에 보이는 두 message를 관측했다. 저장→ack에는 HTTP acknowledgment가 포함되고 paint 시간은 측정하지 않았다.

| 지표 | p50 | p95 | 최소 | 최대 |
| --- | ---: | ---: | ---: | ---: |
| 저장→ack | 62.4911ms | 89.1650ms | 42.8063ms | 149.0247ms |
| 저장→manifest broadcast | 27.2104ms | 42.2542ms | 16.7362ms | 113.3524ms |
| 수신→commit | 31.3000ms | 36.3000ms | 20.8000ms | 47.8000ms |
| file write | 9.7603ms | 12.3327ms | 6.6416ms | 12.6089ms |

p95 89.1650ms로 100ms 목표를 통과했다. 50표본 중 49개가 100ms 이내였고 최대값은 149.0247ms였다. patch reply와 push reply는 각각 50건, request와 full reply는 0건이며 선언 파일은 다시 쓰지 않았다.

측정은 한 로컬 장비의 한 세션에서 50회 실행한 결과다. control 왕복은 stage p95에 더하거나 빼지 않았다. 이 조건의 통과를 다른 장비·부하·렌더링 범위로 일반화하지 않는다.

## 검증과 증거

- `7ccfdba`에서 core test 122/122와 client, lazy, patch, push, wire, live-registry, sync-state, profile·comparison policy test 102/102가 통과했다.
- core와 Vite build가 통과했다.
- 전용 review [remaining-edit-bottlenecks-2026-10-24.json](../review/remaining-edit-bottlenecks-2026-10-24.json)에 실행 조건, 판정, 14개 원본 파일의 SHA-256을 기록했고 `b571d71`에 커밋했다.
- 최초 10회 진단 [remaining-edit-stages-2026-10-24.json](../benchmarks/results/remaining-edit-stages-2026-10-24.json)과 [samples](../benchmarks/results/remaining-edit-stages-2026-10-24.10k-20-locales.samples.json)은 I/O 지연이 큰 before 표본이다. 최종 50회의 인과 증명이나 전후 비교로 쓰지 않는다.

full workspace suite, 새 후보 동결, pack, tarball 소비, git push, npm publish, deploy, admin 적용은 이번 범위에 포함하지 않았다. [83](83-push-subscription-maintenance.md)과 [84](84-large-catalog-performance.md)의 과거 측정은 변경하지 않는다.
