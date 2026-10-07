# 19. 파서 소유 AST 동결 최적화

카탈로그 파서가 새로 만든 literal·argument AST의 알려진 구조를 직접 동결하도록 로컬 구현했다. 소스 위치의 숫자 필드와 노드의 문자열 필드마다 재귀 호출하고 `Object.values` 배열을 만드는 비용을 줄인다. 복잡한 ICU 노드·분기·skeleton과 외부 입력에는 기존 깊은 동결을 유지한다.

## 구현 범위와 검증

내부 `freezeMessageAst`는 새 파서 AST에만 사용한다. literal·argument의 location start/end, location, 노드, 마지막 AST 배열 순서로 동결하고 기존 신뢰 `WeakSet`에도 등록한다. 메시지 객체의 일반 동결은 이미 동결한 AST를 재순회하지 않는다. 이 함수는 공개 package entry에서 내보내지 않는다. 위치·문구·인자 타입·직렬화 내용은 변경하지 않는다.

외부에서 얕게 동결한 객체는 기존 `freeze`가 자식을 확인한다. 이전 카탈로그의 unchanged 메시지·AST 참조 재사용도 유지한다. 단순 AST와 FormatJS가 만든 quoted literal, 중첩 plural/select와 숫자·날짜 skeleton의 모든 객체가 깊게 동결되고 신뢰 등록되는지 확인했다. ICU 오류와 UTF-16 소스 위치 검사는 기존 테스트로 유지한다.

core build, workspace 테스트 164개(core 73·React 9·typegen 5·Vite 77), workspace consumer 타입 검사를 통과했다. workspace 검사에는 production lazy/SSR build와 parser-free `astRuntime` 검증도 포함한다.

## Cold 교차 비교

```sh
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs 6e67555 benchmarks/results/parse-compare-ast-freeze-cold.json cold
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-ast-freeze-cold.json cold
node benchmarks/live-update/parse-compare.mjs 6e67555 benchmarks/results/parse-compare-ast-freeze-incremental.json
```

2026-10-07 Node 24.18.0, Windows x64, AMD Ryzen 5 7430U에서 실행했다. baseline `6e67555`는 [인자 스키마 공유](18-shared-argument-schemas.md)를 포함한다. 영어 literal·ASCII `{name}` 10,000개를 같은 프로세스에서 두 파서로 교차 호출한다. cold는 프로세스 시작이 아니라 previous catalog 없이 매번 새 카탈로그를 만드는 조건이다. warmup 5쌍 뒤 20쌍을 측정했고 모든 pair의 파싱 결과 전체를 대조했다. stringify·동등성 검사·디스크·watcher·번역 검증·브라우저는 timing에서 제외한다.

| 파서 | p50(ms) | p95(ms) |
| --- | --- | --- |
| 기존 일반 동결 | 135.39 | 356.05 |
| AST 구조별 동결 | 107.54 | 279.60 |

20쌍 중 15쌍이 빨랐고 pair별 after−before 중앙값은 -19.20ms였다. 원시 pair와 코드 hash는 [cold 비교 결과](../benchmarks/results/parse-compare-ast-freeze-cold.json)에 있다. p50과 p95는 nearest-rank 값이다. 단일 run에서 낮게 관측한 결과이며 부하·GC를 분리한 인과 추정이나 모든 ICU 입력의 속도 보장은 아니다.

## 내부 계측과 incremental

[계측 요약](../benchmarks/results/parser-stages-ast-freeze-cold.json), [1k 원시 표본](../benchmarks/results/parser-stages-ast-freeze-cold.1000.samples.json), [10k 원시 표본](../benchmarks/results/parser-stages-ast-freeze-cold.10000.samples.json)은 각각 warmup 5회·측정 20회다.

| 메시지 수 | total p50(ms) | total p95(ms) | 메시지 동결 p50(ms) | 메시지 동결 p95(ms) |
| --- | --- | --- | --- | --- |
| 1,000 | 16.09 | 50.39 | 9.66 | 38.63 |
| 10,000 | 219.54 | 589.42 | 114.18 | 408.94 |

현재 messageFreeze 구간에는 AST 동결과 메시지 구성·위치 생성도 포함한다. 이전 hook은 메시지 입력 구성을 timing 밖에서 했으므로 과거 독립 run의 단계별 시간으로 개선량을 계산하지 않는다. 계측 clock/counter 비용을 포함하며 중첩 지표의 p95를 더하지 않는다. 모든 표본에서 인자 스키마 동결은 2회, 메시지 동결은 메시지 수만큼이다. 10k 측정 20회 중 GC 겹침은 12회였다. GC duration을 실제 pause나 CPU 비용으로 보거나 파싱 시간에서 차감하지 않는다.

[incremental 비교](../benchmarks/results/parse-compare-ast-freeze-incremental.json)는 10k 입력에서 같은 길이의 문구 1개만 수정하고 이전 불변 카탈로그를 재사용했다. warmup 50쌍·측정 100쌍이다. p50은 49.90→52.53ms, p95는 119.25→88.36ms, pair별 차이 중앙값은 +1.17ms이며 45쌍이 빨랐다. 일반 편집의 속도 개선은 확인하지 못했다. 이전 메시지 참조와 파싱 결과 동등성은 유지했다.

원시 표본 수·nearest-rank 요약·잔여 구간·GC window·현재 코드 hash를 대조했다.

## 되돌린 실험과 다음 작업

먼저 일반 `freeze`의 `Object.values`를 own-key `for...in` 순회로 바꾸고 객체 자식에만 재귀 호출하는 실험을 했다. [실험 결과](../benchmarks/results/parse-compare-freeze-traversal-cold.json)는 cold 20쌍 중 6쌍만 빨랐고 차이 중앙값은 +11.54ms, p95는 250.71→350.16ms였다. 이 코드는 되돌렸으며 결과 파일의 hash는 실험 당시 코드이다. 최종 코드의 hash와 구분한다.

다음 작업은 실제 로케일 추가→목록 표시·선택→첫 번역 반영의 종단 간 재측정이다. 이번에는 브라우저 지연을 측정하지 않았으며 250ms 목록 표시 목표 달성을 주장하지 않는다. 복잡한 ICU 전용 동결과 광범위한 일반 동결 변경은 이번 범위 밖이다. 로컬 커밋 대상이며 npm 게시본에는 아직 없다.
