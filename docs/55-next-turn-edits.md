# 55. 다음 턴 편집 병합

이 문서는 로컬 커밋 `29970fc`의 Vite `live-registry.ts` 최적화와 `2aa5f7d`의 비교 하네스 확장을 기록한다. Vite가 일반 `update`에 넘기는 guarded reader를 다음 타이머 턴에서 병합한다. 실제 Vite·브라우저 ABBA 비교에서 편집 p95가 낮아졌지만 100ms 목표에는 미달한다.

## 구현 범위 (packages/vite/src/live-registry.ts)

- `read`가 있는 읽기(Vite `update`의 guarded reader)는 대기 없이 다음 타이머 턴(`0ms`)에 drain한다.
- `read` 없는 항목이 하나라도 큐에 섞이면(디스크 `add`·`unlink`, 이전 시도의 재큐) 기존 40ms quiet 창을 그대로 적용한다.
- 같은 경로에 뒤이어 reader가 들어와도 디스크 안정화 플래그는 배치가 끝날 때까지 유지한다.
- `drain`이 큐·waiter·`firstQueued`와 함께 플래그를 초기화하고, `MAX_WAIT_MS` 200 상한은 그대로 둔다.

디스크 안정화가 필요할 때 40ms를 기다리고, 일반 편집은 다음 타이머 턴에서 바로 처리한다. 하네스는 스냅샷에서 정책 소스가 있는 패키지만 다시 빌드하도록 넓히고 `fast-edits` 정책(`live-registry.ts`)을 추가했다.

## 측정 결과

단위는 ms이고 편집은 10k×20, measured 25·warmup 5·control 10, before/after/after/before 순서다.

| 지표 (pooled 50) | before | after |
| --- | ---: | ---: |
| 저장→DOM ack p50 / p95 | 125.10 / 140.13 | 78.26 / 107.49 |
| 100ms 이내 표본 | 0/50 | 44/50 |
| queueToDrain p50 / p95 | 46.25 / 54.74 | 2.67 / 3.82 |

| ABBA run p95 | 1 before | 2 after | 3 after | 4 before |
| --- | ---: | ---: | ---: | ---: |
| 저장→ack | 140.26 | 107.49 | 101.75 | 134.60 |
| control RTT | 5.62 | 3.33 | 3.86 | 5.26 |

## 해석과 한계

- 순차 독립 실행이고 표본 짝짓기·무작위 배정·강제 GC·부하 통제가 없다. 인과 증명으로 쓰지 않는다.
- control RTT p95도 함께 낮아졌으며 변경 효과와 런타임·측정 조건 차이를 분리하지 못했다. paint는 관측하지 않았다.
- Node 시계와 브라우저 시계를 서로 빼지 않고 구간 quantile을 더하지 않는다.
- 편집 100ms 목표는 미달이고 전체 목표도 완료가 아니다.

## 검증

- vite plugin 35 + server 2 = 37개 기능 테스트와 Vite 소비자 typecheck가 통과했다.
- comparison-policy 테스트 1개가 통과했다.
- locale-add 1k 스모크를 before·after 각 1회 통과했다. 스모크 출력은 임시 디렉터리에만 쓰고 정리했으며 성능 근거로 쓰지 않는다.
- 원시 표본에서 36개 요약과 37개 파일 hash를 재계산했고, variant 차이는 dist `live-registry.js` 하나뿐이었다. 임시 스냅샷은 정리했다.

## 원본과 재현

[비교 요약](../benchmarks/results/fast-edits-comparison-2026-10-11.json)의 runs[].file이 4개 실행 결과, results[].samplesFile이 원시 표본을 가리킨다.

```sh
node benchmarks/live-update/locale-compare.mjs --experiment fast-edits --mode edit --baseline 95eb41b --current 29970fc --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/fast-edits-comparison-2026-10-11.json
node benchmarks/live-update/locale-compare.mjs --experiment fast-edits --mode locale-add --smoke --baseline 95eb41b --current 29970fc
```

## 상태

로컬 커밋 `29970fc`·`2aa5f7d`이고 미푸시다. 버전 bump·게시·배포는 없다.

## 누락된 파일의 재확인과 후속 단독 측정

`2aea993`은 reader가 `ENOENT`를 낼 때 삭제를 바로 게시하지 않고 디스크 안정화로 재큐한다. 이미 최신 reader가 큐에 있어도 40ms 플래그를 유지한다. 두 회귀 사례와 기존 테스트를 포함한 Vite 테스트 90개, Vite 소비자 typecheck가 통과했다.

[후속 단독 측정](../benchmarks/results/guarded-edit-current-2026-10-11.json)은 해당 보완을 포함한 제품 소스로 25 measured·5 warmup·10 control을 실행했다. 저장→ack p50/p95는 163.30/252.95ms이고 100ms 이내는 2/25다. 모든 measured 응답은 단일 메시지 patch이며 입력·상태·typegen 보존 검사는 통과했다. 최장 표본에서는 이벤트 2개·drain 3개를 관측했고 파일 쓰기 p95도 60.71ms였다. 변경 전 대조나 GC·부하 통제가 없어 지연 원인을 보완 코드로 확정하지 않는다. 앞의 ABBA 결과와 함께 보존하며 현재 성능 목표는 미달로 유지한다.
