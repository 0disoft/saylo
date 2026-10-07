# 22. 단순 AST 상대 위치 공유

한 카탈로그 파싱 호출 안에서 단순 AST의 동일 상대 좌표와 동일 start/end 위치 객체를 공유하도록 로컬 구현했다. 새 파싱 교차 비교 20쌍 중 15쌍이 빨랐고 p50은 118.42→95.26ms로 낮게 관측됐다. 최장 시간은 늘었으므로 긴 지연 해결이나 안정적 성능 목표 달성을 주장하지 않는다.

## 구현과 계약

- `parseCatalog`가 호출마다 `createSimplePositionPool`을 만든다. 단순 literal·ASCII 인자 파서만 pool을 사용하고 FormatJS로 위임하는 복잡한 ICU는 기존 경로를 유지한다. 내부 함수이며 공개 package entry에서 내보내지 않는다.
- 좌표는 offset·line·column 세 값을 모두 구분한다. 첫 줄이고 column=offset+1인 경우는 offset 숫자 키만 사용해 tuple 문자열 생성을 줄인다. 나머지는 세 좌표의 문자열 키를 사용하므로 같은 UTF-16 offset의 다른 Unicode 열과 줄 번호가 합쳐지지 않는다.
- start/end 좌표는 깊게 동결해 공유하고, 두 좌표 객체를 키로 같은 위치 구간도 공유한다. AST 노드·배열과 메시지의 카탈로그 절대 위치 객체는 각각 유지한다. serialized AST의 값과 wire 형식은 변경하지 않는다.
- `freezeMessageAst`는 이미 신뢰 등록된 위치 구간의 동결을 생략한다. 신뢰하지 않는 위치와 복잡한 ICU는 기존 깊은 동결을 유지한다.
- pool은 호출 밖에 캐시하지 않는다. 이전 unchanged 메시지는 기존 AST를 재사용하지만 새 메시지의 pool에 이전 상대 위치를 넣지는 않는다. AST 출력은 좌표·구간 객체만 참조하고 Map을 보유하지 않는다. 고유 위치가 많은 입력에는 키·Map 비용이 추가되므로 모든 메시지 형태의 개선을 주장하지 않는다.

기존 파서의 Unicode·UTF-16 offset·CRLF·lone surrogate·FormatJS AST 일치·ICU 오류 위치 검사를 유지했다. 동일 좌표/구간 공유와 별도 호출 분리, 절대 소스 위치 분리, incremental 참조 재사용, 실패한 단순 파싱 뒤 ICU fallback 진단을 추가 확인했다. core build, workspace 테스트 166개(core 75·React 9·typegen 5·Vite 77), workspace consumer 타입 검사를 통과했다. production lazy/SSR build와 parser-free astRuntime 검증도 workspace 테스트에 포함한다.

## Cold·incremental 교차 비교

```sh
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs 0a1beb2 benchmarks/results/parse-compare-position-pool-final-cold.json cold
node benchmarks/live-update/parse-compare.mjs 0a1beb2 benchmarks/results/parse-compare-position-pool-final-incremental.json
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-position-pool-cold.json cold
```

2026-10-07 Node 24.18.0, Windows x64, Ryzen 5 7430U에서 실행했다. baseline `0a1beb2`는 기존 인자 스키마 공유와 AST 전용 동결을 포함한다. 비교 fixture는 영어 literal·ASCII `{name}` 메시지 10,000개이다. 두 파서를 한 프로세스에서 번갈아 호출하고 매 pair 전체 결과를 대조한다. stringify·동등성 검사·디스크·watcher·번역 검증·브라우저는 timing에서 제외한다.

| 모드 | 기존 p50(ms) | 공유 후 p50(ms) | 기존 p95(ms) | 공유 후 p95(ms) | 빨라진 pair |
| --- | --- | --- | --- | --- | --- |
| cold | 118.42 | 95.26 | 382.37 | 271.70 | 15/20 |
| incremental | 25.78 | 25.15 | 52.45 | 53.10 | 62/100 |

cold는 previous catalog 없이 warmup 5쌍·측정 20쌍, incremental은 같은 길이의 값 하나를 바꾸고 이전 카탈로그를 재사용하며 warmup 50쌍·측정 100쌍이다. nearest-rank 요약이며 pair별 after−before 중앙값은 각각 -13.81ms·-0.83ms이다.

원시는 [최종 cold 비교](../benchmarks/results/parse-compare-position-pool-final-cold.json)와 [incremental 비교](../benchmarks/results/parse-compare-position-pool-final-incremental.json)에 있다. cold 최장 시간은 413.83→680.49ms로 늘었고 pair 차이 p95도 +126.35ms였다. incremental 최장은 86.54→124.58ms였고 p95 개선은 확인하지 못했다. 단일 run의 부하·GC·스케줄링 영향을 분리하지 않았으므로 모든 tail이 개선됐다고 해석하지 않는다.

동일 10k 비교 fixture를 standalone 단순 파서(pool 없음)와 카탈로그 파서(pool 있음)로 구성하고 AST 값의 동등성을 확인했다. AST가 참조하는 고유 좌표 객체는 39,998→10개, 위치 구간 객체는 19,999→9개였다. 이는 참조 그래프의 객체 수이며 총 할당량·heap bytes·메모리 사용량 측정이나 전송 크기 감소가 아니다.

## 내부 계측과 초기 실험

[내부 요약](../benchmarks/results/parser-stages-position-pool-cold.json)과 [1k 원시](../benchmarks/results/parser-stages-position-pool-cold.1000.samples.json), [10k 원시](../benchmarks/results/parser-stages-position-pool-cold.10000.samples.json)은 warmup 5회·측정 20회이며 clock/counter 비용을 포함한다. 10k total p50/p95는 143.08/282.73ms, AST 구간은 20.19/56.79ms, 메시지 동결은 39.17/94.92ms였다.

좌표·구간을 처음 만들어 동결하는 비용은 이제 AST 구간에 포함된다. 과거 독립 run의 메시지 동결 시간만 비교해 개선량을 계산하지 않고 중첩 p95도 더하지 않는다. 10k 측정 20회 중 GC 겹침은 10회였으며 GC duration을 실제 pause/CPU 비용으로 보거나 파싱 시간에서 차감하지 않는다.

처음에는 좌표만 공유하고 AST의 seal마다 신뢰 조회를 추가했다. [초기 실험 결과](../benchmarks/results/parse-compare-position-pool-cold.json)는 20쌍 중 11쌍이 빨랐고 pair 중앙값은 -9.40ms였지만 p95는 245.66→249.98ms였다. 최종 구현은 위치 구간도 공유하고 구간 단위로 신뢰 조회를 한다. 초기 파일의 hash는 당시 실험 코드이며 현재 hash와 구분한다. 독립 run의 시간을 서로 빼서 두 실험의 차이를 계산하지 않는다.

원시 pair·표본 수·nearest-rank 요약·단계 잔여·호출 수·GC window·최종 코드 hash를 대조했고 임시 benchmark 디렉터리가 남지 않았음을 확인했다.

## 다음 작업

객체 수 감소와 cold 중앙값 개선을 근거로 최종 구현을 로컬 채택했다. 다음은 실제 대규모 로케일 추가의 목록 표시·선택→첫 번역 반영 재측정이다. 이번 작업에서는 종단 간 브라우저 지연을 다시 측정하지 않았으며 기존 목록 표시 250ms 목표 달성을 주장하지 않는다. npm 게시본에는 아직 없다.
