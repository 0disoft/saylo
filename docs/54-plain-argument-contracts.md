# 54. plain argument contract 재사용

이 문서는 로컬 커밋 `169e72b`의 core `schema.ts` 최적화를 기록한다. 파서가 만드는 plain 인자 스키마를 이름별로 memo한다. cold 교차 비교 근거로 로컬 채택했고, 실제 Vite·브라우저 ABBA 비교에서 로케일 목록의 large 목표 통과를 관측했다. 편집 반영 목표는 미달이다.

## 배경: 현행 cold 파서 프로파일

관측은 2026-10-10(KST), revision `ae40ba6`에서 cold 25회로 수집했다.

| 항목 | 값 |
| --- | --- |
| cold 25회 p50 / p95 | 73.66ms / 159.48ms |
| CPU 표본 | 전체 1334 = parserStack 281 + coreWithoutParserStack 489(합산 귀속 770) + GC 95 + outside 469 + idle 0 |
| 상위 self 비중 | readJson 30.78%, inferArguments 23.90%, parseSimple 16.75%, freeze 13.12% |
| 입력 | 10k 단순 ASCII 명칭 1파일 |
| profiler 표본 간격 / forcedGC | 1000µs / false |

self 비중은 귀속 표본 중 비율이고 CPU 시간이나 할당량이 아니다. 장비·JIT·인라인 상태에 따라 순위가 달라질 수 있다.

## 구현 범위 (core/schema.ts만)

- literal 또는 동일한 하나의 plain argument가 반복되는 경우만 shortcut한다.
- canonical per-parse Map에서 이름별 schema를 WeakMap에 memo해 반복되는 Map 생성을 생략한다. 반복되는 JSON signature는 최초에 한 번만 계산하고 이후 memo를 재사용한다.
- AST 분류 loop는 그대로 남는다.
- 다인자·nested ICU는 일반 walk와 충돌 검사를 그대로 유지한다.
- canonical signature·identity·accepted type order·null prototype·깊은 불변성을 그대로 둔다.
- `parseSimpleMessage`와 파싱+수집 통합 실험([40](40-simple-argument-trial.md))은 변경하지 않는다.
- 비교 baseline은 `4aacb93`이다.

## 측정 결과

단위는 ms이고 diff는 after−before다.

| 구간 | before p50 / p95 | after p50 / p95 | diff median | diff p95 | improved |
| --- | ---: | ---: | ---: | ---: | --- |
| paired cold 첫 20쌍 | 84.02 / 163.97 | 62.92 / 125.31 | -27.81 | -0.26 | 19/20 |
| cold confirm 20쌍 | 86.10 / 163.90 | 72.41 / 133.11 | -14.67 | +54.71 | 18/20 |
| incremental 100 | 27.24 / 38.98 | 25.16 / 38.01 | -1.16 | +6.00 | 61/100 |

| 최장값 | before | after |
| --- | ---: | ---: |
| cold | 208.32 | 127.41 |
| cold 재확인 | 189.92 | 165.31 |
| edit | 100.01 | 88.20 |

## 해석과 한계

- cold는 p50과 중앙값이 두 run 모두 개선됐다. diff p95 부호는 run마다 다르다(첫 20쌍 -0.26, confirm +54.71).
- incremental은 median -1.16ms로 개선 폭이 작고 diff p95는 +6.00ms로 커졌다. 일반 편집 개선은 확인하지 않았다.
- 같은 입력의 두 파서를 동일 프로세스에서 순서를 교대해 호출하고 표본별로 짝지었다. 무작위 배정·강제 GC·부하 통제는 없어 인과 증명으로 해석하지 않는다.
- cold 근거로 로컬 채택했으나, 이 수치만으로 종단 간 개선이나 목표 달성을 주장하지 않는다.

## 검증

- 78개 core 테스트와 소비자 typecheck가 통과했다.
- 5개 typegen, 9개 Vite patch·wire, 1개 probe가 통과해 합계 93개다.
- 별도 검증에서 profile의 25 wall 표본·1334 CPU 표본과 9개 hash를 확인했고, comparison의 140 measured 쌍(warmup 포함 총 250 deepEqual 쌍)과 3개 run의 nearest-rank 요약·쌍별 차이·현행 dist 5개 hash 일치를 확인했다.

## 원본

- [parser-cpu-cold-2026-10-10.json](../benchmarks/results/parser-cpu-cold-2026-10-10.json) · [.cpuprofile](../benchmarks/results/parser-cpu-cold-2026-10-10.cpuprofile)
- [plain-contracts-cold-2026-10-10.json](../benchmarks/results/plain-contracts-cold-2026-10-10.json)
- [plain-contracts-cold-confirm-2026-10-10.json](../benchmarks/results/plain-contracts-cold-confirm-2026-10-10.json)
- [plain-contracts-incremental-2026-10-10.json](../benchmarks/results/plain-contracts-incremental-2026-10-10.json)

## 상태

로컬 커밋 `169e72b`의 최종 로컬 채택이고 미푸시다. 버전 bump·게시·배포는 없다.

라이브 전후 교차 비교는 측정 전·후 ABBA, 각 mode·variant 50 measured로 실행했다. 도구 policy는 plain-contracts `40bfa5a`이고 `schema.ts`만 대체한다.

## 실제 Vite·브라우저 전후 비교

같은 의존성과 하네스에서 4aacb93 → 169e72b의 schema.ts만 바꾼 격리 스냅샷을 실행했다. 편집과 로케일 추가 각각 before/after/after/before 순서이고, 매 run measured 25·warmup 5·control 10이다. 일반 prebundle·typegen을 유지하고 CPU·GC·파일·브라우저 상세 계측은 껐다. edit → locale-add 순서로 실행했다. 아래 p50/p95(ms)는 각 variant의 measured 50개를 합친 nearest-rank 값이다.

| 구간 | before p50 / p95 | after p50 / p95 |
| --- | ---: | ---: |
| 편집 저장→DOM ack | 136.94 / 259.15 | 143.58 / 197.22 |
| 로케일 저장→목록 ack | 201.50 / 536.37 | 151.79 / 193.56 |
| 로케일 저장→첫 번역 ack | 406.65 / 784.11 | 323.79 / 491.51 |
| 선택 준비→번역 ack (Node) | 193.28 / 258.73 | 164.72 / 279.53 |
| setLocale→commit (Browser) | 190.30 / 256.10 | 161.90 / 217.50 |

| ABBA run p95 | 1 before | 2 after | 3 after | 4 before |
| --- | ---: | ---: | ---: | ---: |
| 편집 | 284.54 | 199.98 | 153.54 | 153.66 |
| 로케일 목록 | 536.37 | 193.56 | 184.78 | 445.72 |

이번 조건의 로케일 after 두 run은 목록 250ms 목표에 들어왔다. 250ms 이내 표본은 before 36/50·after 48/50이고, 편집 100ms 이내는 전후 모두 0/50이다. 편집은 pooled p95가 낮았지만 p50은 커졌고 두 번째 블록의 p95 차이는 거의 없다. 선택 준비→번역 ack의 p95도 높아졌다. 모든 구간이 일관되게 빨라졌다고 판단하지 않는다. 순차 독립 블록이며 표본별 짝짓기·무작위 배정·GC·부하 통제가 없다. 이 결과를 코드 변경의 인과 증명으로 쓰거나 Node·Browser 시계를 서로 빼거나 구간 quantile을 더하지 않는다.

control RTT p95는 편집 4.80→4.72ms·로케일 4.01→4.89ms다. raw 240개(measured 200·warmup 40), control 80개, timing 요약 78개를 원시와 대조했다. 비교 policy·runner를 포함한 39개 파일 hash가 현재 dist·하네스와 일치하고 variant 사이 차이는 schema.js 하나다. 전 run의 입력 노드·입력값·React state·번역 DOM·로케일 복귀/삭제 검사가 통과했고 .d.ts mtime·size도 유지됐다. measured 편집은 한 메시지 patch·position 갱신 0, 로케일은 선택 전 응답 0·선택 후 compact full 1개다. 임시 스냅샷은 정리됐다.

원본: [편집 비교](../benchmarks/results/plain-contracts-edit-comparison-2026-10-10.json), [로케일 비교](../benchmarks/results/plain-contracts-locale-comparison-2026-10-10.json). 각 비교의 runs[].file과 run의 results[].samplesFile이 같은 디렉터리의 독립 실행 결과·원시 표본을 가리킨다.

재현 명령:

```sh
node benchmarks/live-update/locale-compare.mjs --experiment plain-contracts --mode edit --baseline 4aacb93 --current 169e72b --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/plain-contracts-edit-comparison-2026-10-10.json
node benchmarks/live-update/locale-compare.mjs --experiment plain-contracts --mode locale-add --baseline 4aacb93 --current 169e72b --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/plain-contracts-locale-comparison-2026-10-10.json
```

남은 편집 경로에서는 after 서버 queueToDrain p50/p95가 47.56/55.64ms, readAndCandidate가 33.63/52.86ms, catalogDelta가 15.09/23.21ms다. 다음은 대기 정책과 이미 최신인 pair의 불필요한 delta 생성·적용을 실제 요청 범위에서 확인해 개선 후보를 정한다.
