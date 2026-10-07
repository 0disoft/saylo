# 17. Cold 파서 계측 결과

이 문서는 제품 최적화가 아니라 benchmark-only cold 내부 계측 추가 결과를 정리한다. 제품 source와 dist는 변경하지 않았고, 계측은 benchmark 하네스 안에서만 동작한다. 모든 수치는 파서 계측 전용이며 watcher, validation, browser 경로는 범위 밖이다.

## 실행

```
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-cold-final.json cold
```

최종 실행 환경은 Node 24.18.0, Windows x64다. 여기서 cold는 프로세스 cold start가 아니라 previous catalog가 없는 상태를 뜻한다(previous는 항상 undefined).

## 측정 구성

- cold 설정: warmup 5, samples 20, 입력 1k와 10k 각각, en-GB English literal + ASCII `{name}` 자리표시자.
- 계측 3 모듈, in-memory Node hook(catalog/json/schema). 제품 source/dist 변경 없음.
- 계측 지표: per-message AST, 인자 추론(inclusive), 인자 schema freeze, 메시지 freeze, final catalog freeze.
- jsonMs는 strict parse와 tokenScan을 포함한다. argumentsMs는 argumentFreeze를 포함하고, messageLoop는 AST, arguments, messageFreeze를 포함한다.
- per-sample residual을 먼저 계산한 뒤 요약한다. p95를 서로 합산하지 않는다.
- 계측 clock/counter overhead는 측정에 포함된다.

## 결과

최종 결과는 [parser-stages-cold-final.json](../benchmarks/results/parser-stages-cold-final.json), raw는 [1k 표본](../benchmarks/results/parser-stages-cold-final.1000.samples.json)과 [10k 표본](../benchmarks/results/parser-stages-cold-final.10000.samples.json)이다(warmup 포함 각 25행).

| 입력 | total p50(ms) | total p95(ms) |
| --- | --- | --- |
| 1k | 24.78 | 77.65 |
| 10k | 321.21 | 598.09 |

10k 단계별 p95(ms): json 17.82, AST 90.23, argumentInferenceOnly 95.50, argumentFreeze 219.30, messageFreeze 213.98, finalFreeze 6.20.

단일 sample마다 겹치지 않는 동결 3개 합계가 total에서 차지하는 비중은 10k에서 최소 52.16%, 중앙 71.25%, 최대 90.62%다. 이 값은 p95끼리 합친 것이 아니다. 동결 호출의 wall time 비중이며 CPU 사용률이나 GC를 뺀 비용으로 사용하지 않는다.

10k 입력은 387772 B다. locale add fixture 387783 B와는 probe 차이만큼 다르다.

## GC 관측

GC PerformanceObserver entries의 startTime을 parser perf.now window와 대조해 귀속한다. callback 전달 시점에 귀속하지 않고, 겹친 구간은 union으로 합쳐 중복 계산하지 않는다. forced GC는 쓰지 않는다. 파싱 전후 heapUsed 값은 timing 밖에서 읽는다. 그 차이는 회수 전 쓰레기도 포함하는 사용량 변화이며 총 할당량이나 V8 heap snapshot이 아니다. GC 관측 duration은 실제 stop-the-world pause나 CPU 사용 시간을 측정한 값이 아니므로 파싱 시간에서 차감할 수 없다.

20회 중 GC 겹침이 관측된 표본은 15회, GC interval union p95는 112.89ms다. 겹침이 관측되지 않은 5개 표본도 p95가 585.69ms이므로 tail 원인을 GC만으로 단정할 수 없다. GC 겹침이 관측된 15회의 p95는 648.26ms다. 작은 표본의 분류별 p95를 일반화하지 않는다.

## Incremental 회귀 확인

Incremental 회귀 smoke는 [parser-stages-incremental-gc-smoke.json](../benchmarks/results/parser-stages-incremental-gc-smoke.json), raw는 같은 stem의 .1000/.10000.samples.json이다(warmup 10, samples 50). unchanged message ref reuse와 AST 동결 검사는 통과했다. 1k/10k total p95는 2.74/36.12이며, 후속 성능 개선 비교가 아니라 회귀 실행 확인용이다. GC interval clipping·union·경계·빈 구간을 독립 입력으로 확인했고, detailed hook에서도 중첩 ICU·skeleton·동결·중복 ID와 ICU 오류 처리를 확인했다. 원시 표본의 수·요약·잔여 구간·GC window·코드 hash도 대조했다.

## 한계와 다음 후보

이번 실행은 계측 추가일 뿐 최적화가 아니므로 목록 표시 250ms 목표 달성을 주장할 수 없다. 첫 탐색 run(p95 774.68ms) 뒤 GC 중복 union을 수정하고 raw를 분리했다. 첫 탐색 raw는 보존하지 않았고 전후 성능 비교에 쓰지 않는다.

그 뒤의 [선행 cold run](../benchmarks/results/parser-stages-cold.json)은 10k total p95 1,054.05ms, 동결 비중 최소 51.59%·중앙 58.67%였다. 최종 run 전에 heap metadata의 표현을 바로잡았으며 측정 로직과 제품 코드는 바꾸지 않았다. 두 run의 원시 표본은 각각 보존한다. 부하·GC·스케줄링을 분리하지 않았으므로 1,054.05→598.09ms를 성능 개선으로 해석하지 않는다. 이전 결과의 `heap snapshots`·`live-heap` 표현 역시 실제 수집은 `process.memoryUsage().heapUsed` 전후 값이다.

다음 제품 최적화 후보는 동결 과정의 객체 생성과 순회, 동일 인자 schema 재사용 또는 AST 구조별 동결 경로 검토다. 불변성, ICU, 오류 위치 계약은 유지한다.
