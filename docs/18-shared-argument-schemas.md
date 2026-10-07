# 18. 동일 인자 스키마 공유

`parseCatalog` 한 번의 호출 안에서 이름·인자 타입·순서가 같은 인자 스키마를 공유하도록 로컬 구현했다. 반복 메시지의 스키마 객체 생성과 깊은 동결을 줄이는 변경이다. 메시지 AST와 소스 위치는 각각 유지한다.

## 구현과 계약

- 호출마다 별도 `Map`을 만들고 인자 등장 순서와 acceptedTypes 순서를 유지한 JSON을 키로 사용한다. 호출 간 전역 캐시는 두지 않는다. 고유 계약이 많은 카탈로그에서는 키 생성과 Map 비용이 추가되므로 모든 입력의 속도 개선을 주장하지 않는다.
- 모든 메시지의 AST를 먼저 순회해 인자 충돌을 확인한다. 앞서 성공한 스키마가 있어도 이후 메시지의 `ARGUMENT_CONFLICT`와 오류 위치를 생략하지 않는다.
- 반환한 스키마는 깊게 동결한다. unchanged 메시지의 incremental 재사용은 유지하며, 이전 호출의 스키마까지 새 pool에 넣지는 않는다.
- `validateTranslation`은 깊게 동결한 번역 스키마별로 검증에 성공한 기준 스키마들을 `WeakSet`에 기록한다. ID가 기준에 있는지 먼저 확인하고, 같은 객체 쌍의 성공 결과만 재사용한다. mutable 입력과 새로운 기준 계약은 다시 검증하고 실패 진단은 캐시하지 않는다.

## Cold 교차 비교

```sh
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs 4b69398 benchmarks/results/parse-compare-schema-sharing-cold.json cold
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-schema-sharing-cold.json cold
```

2026-10-07 Node 24.18.0, Windows x64, AMD Ryzen 5 7430U에서 실행했다. cold는 프로세스 시작이 아니라 previous catalog 없이 매번 파싱하는 조건이다. 영어 literal·ASCII `{name}` 메시지 10,000개를 같은 프로세스에서 이전 코드와 현재 코드로 번갈아 파싱했다. warmup 5쌍 뒤 20쌍을 측정하고 모든 pair의 파싱 결과 동등성을 확인했다. JSON.stringify·동등성 검사·디스크·watcher·번역 검증·브라우저는 timing에서 제외했다.

원시 pair와 코드 hash는 [parse-compare-schema-sharing-cold.json](../benchmarks/results/parse-compare-schema-sharing-cold.json)에 있다. baseline은 `4b69398126032d35872bb93bc20d511e96cf6ce1`이다.

| 파서 | p50(ms) | p95(ms) |
| --- | --- | --- |
| 이전 | 167.60 | 396.18 |
| 스키마 공유 | 125.54 | 563.63 |

20쌍 중 17쌍이 빨랐고 pair별 after−before 중앙값은 -36.08ms였다. p95는 증가했으므로 긴 지연 개선은 확인하지 못했다. 중앙값은 nearest-rank p50이며 짝수 표본의 중간 두 값을 평균한 값이 아니다. 부하와 GC를 분리하지 않은 단일 run이며 화면 반영 시간으로 확장하지 않는다.

## 내부 계측

세부 계측은 별도 run이다. [요약](../benchmarks/results/parser-stages-schema-sharing-cold.json)과 [1k 원시 표본](../benchmarks/results/parser-stages-schema-sharing-cold.1000.samples.json), [10k 원시 표본](../benchmarks/results/parser-stages-schema-sharing-cold.10000.samples.json)에 각각 warmup 5회·측정 20회가 있다. clock/counter 비용을 포함한다.

| 메시지 수 | total p50(ms) | total p95(ms) | 인자 동결 p95(ms) | 메시지 동결 p95(ms) |
| --- | --- | --- | --- | --- |
| 1,000 | 24.95 | 68.97 | 0.06 | 48.77 |
| 10,000 | 324.52 | 644.15 | 0.10 | 494.82 |

이 fixture의 인자 계약은 빈 스키마와 `{name}` 두 종류이다. 모든 표본에서 인자 스키마 동결 호출은 2회이고, AST 순회와 메시지 동결은 메시지 수만큼 실행한다. 이는 동결 호출 수 감소를 확인한 결과이며 이전 독립 run의 절대 시간과 비교해 개선량을 계산하지 않는다. 중첩 p95도 합산하지 않는다.

10k의 20회 중 GC 겹침은 14회, GC interval union p95는 123.64ms였다. GC duration은 실제 pause나 CPU 비용이 아니므로 파싱 시간에서 차감하지 않는다. heapUsed 전후 차이는 총 할당량이 아니다. 표본 수·nearest-rank 요약·잔여 구간·동결 호출 수·GC window·코드 hash를 원시 파일과 대조했다.

## 검증과 다음 작업

core build, workspace 테스트(core 72·React 9·typegen 5·Vite 77), workspace consumer 타입 검사를 통과했다. 동일 스키마 공유·AST/위치 분리·깊은 불변성·ICU 충돌 위치·복수 기준 계약 검증 재사용·알 수 없는 ID/인자·타입 narrowing 회귀를 확인했다.

메시지 객체와 AST의 동결 경로가 다음 최적화 후보이다. 이번에는 종단 간 로케일 추가와 브라우저 선택 지연을 재측정하지 않았으며 기존 250ms 목록 표시 목표 달성을 주장하지 않는다. 로컬 변경이고 npm 게시본에는 아직 없다.
