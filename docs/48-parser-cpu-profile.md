# 48. 현행 파서 CPU 프로파일

제품 코드는 바꾸지 않고 파서 전용 V8 CPU 수집기·요약기를 추가했다. 편집에서는 JSON 읽기 호출 지점과 일반 동결에, cold에서는 일반 동결·JSON 읽기·AST seal·인자 추론에 표본이 모였다. 다음 작은 후보는 **이미 깊게 동결한 메시지를 담은 최종 메시지 맵의 재순회 생략**이다. 이번에는 후보를 구현하거나 성능 향상을 확인하지 않았다.

## 조건과 수집 범위

2026-10-10 KST, 기준 revision `abdf076`, Node v24.18.0, Windows x64, Ryzen 5 7430U에서 기존 core build를 재사용했다. 제품 5개 dist·실행기·요약기·통계·lockfile의 hash를 남겼다. 한 파일에 plain/ASCII `{name}` 메시지 10,000개를 두고 probe 하나를 같은 길이로 변경한다. incremental은 이전 불변 카탈로그를 사용하고 cold는 이전 카탈로그 없이 파싱한다. 새 로케일 추가의 파서 부분을 보는 fixture이며 실제 20개 로케일 registry나 watcher·브라우저 실행은 아니다.

```sh
node benchmarks/live-update/parser-cpu.mjs incremental benchmarks/results/parser-cpu-2026-10-10-incremental.json 100
node benchmarks/live-update/parser-cpu.mjs cold benchmarks/results/parser-cpu-2026-10-10-cold.json 100
```

최종 두 run은 서로 다른 Node 프로세스에서 순차 실행했다. 각각 측정 100회이며 warmup은 incremental 50회·cold 5회다. JSON 생성·warmup·시작 준비·검증·파일 쓰기는 profiler 밖이다. 모든 입력 JSON을 미리 만들어 유지하며 측정 loop·호출별 clock·관측 GC는 포함한다. 표본 간격은 1000µs를 요청했다. 상세 구간 clock·강제 GC는 없고 OS 부하·GC는 통제하지 않았다. 수집 중 다른 저장소 테스트·빌드는 함께 실행하지 않았다.

## 표본 분포

함수 표의 분모는 `parseCatalog` 또는 core dist 스택이 보이는 **귀속 가능 표본**이다. GC와 귀속 불명 표본을 함수에 배분하지 않는다. 비중은 sample count이며 exact CPU 시간이나 할당량이 아니다. self만 비교하고 inclusive 행은 합산하지 않는다.

| 표본 종류 | incremental | cold |
| --- | ---: | ---: |
| 전체 | 1868 | 7295 |
| parseCatalog 스택 | 1754 | 6586 |
| core만 보이고 parser 부모가 없는 스택 | 0 | 0 |
| GC | 97 | 685 |
| idle/program | 1 | 1 |
| 파서 밖 또는 귀속 불명 | 16 | 23 |
| 음수 timeDelta | 0 | 0 |

| 함수 self / 귀속 가능 표본 | incremental | cold |
| --- | ---: | ---: |
| parseCatalog | 59.35% | 9.16% |
| freeze | 22.92% | 25.27% |
| readJson | 17.50% | 19.85% |
| seal (AST) | 0.06% | 17.13% |
| inferArguments | 0% | 13.39% |
| parseSimpleMessage | 0.06% | 9.35% |

incremental의 `parseCatalog`에는 인라인/native 호출 비용이 귀속될 수 있다. 이 함수의 profiler line ticks 중 744개는 dist 20행의 `readJson(source, context)` 호출 지점이고, `readJson`의 307개는 dist 9행의 엄격한 `JSON.parse(source)` 지점이다. `parseCatalog` self 전체를 메시지 loop 비용으로 해석하지 않는다. 일반 `freeze`에서는 dist 9행의 `Object.values` 순회에 incremental 311·cold 766 ticks가 기록됐다. line ticks는 V8의 줄 카운터이며 실제 TypeScript 문장별 CPU 시간을 뜻하지 않는다.

profiler를 켠 호출 wall time의 p50/p95는 incremental 26.88/42.35ms, cold 99.82/133.66ms이고 cold 최장값은 1134.78ms였다. 부하·GC·profiler 영향을 분리하지 않았으므로 이를 기존 unprofiled 기준값과 비교하거나 개선·회귀로 판정하지 않는다. GC 표본만으로 최장 호출의 원인도 확정하지 않는다.

## 다음 후보와 한계

`catalog.ts`의 모든 성공한 메시지는 깊은 동결을 마쳤거나 신뢰하는 이전 카탈로그에서 재사용한다. 그 뒤 최종 `freeze({ ...context, messages })`가 맵의 메시지들을 다시 순회한다. incremental에서 대부분의 메시지가 재사용되는 조건과 일반 동결의 표본 비중을 함께 보면 이 마지막 맵 순회를 줄이는 후보를 시험할 근거가 있다. 단, 동결 표본 전부를 최종 맵 비용으로 귀속하지 않는다.

다음 실험은 파서 소유 맵에 한정한다. 메시지·AST·위치의 깊은 불변성과 외부 얕은 동결 객체를 다시 순회하는 일반 `freeze` 계약을 유지하고, cold/incremental 동일 프로세스 교차 비교로 채택 여부를 정한다. [33](33-owned-message-freeze-trial.md)의 새 메시지 레코드 직접 동결이나 [19](19-ast-freeze-measurements.md)의 일반 for-in 교체를 재도입하는 후보가 아니다.

초기 수집에서는 음수 timeDelta가 검증을 중단시켰고, 다른 예비 cold 수집에서는 parser 부모가 생략된 core 스택과 익명 실행기 프레임이 많았다. 요약기는 음수 값을 보정하지 않고 원본을 보존하며 표본 수를 사용한다. core 스택을 별도로 수락하되 누락된 부모를 만들어 내지 않는다. 최종 파일은 수정된 도구로 다시 수집한 두 run이며, 예비 run과 혼합하지 않았다. JIT·인라인·native 귀속·표본 간격·장비 상태 때문에 함수 순위도 달라질 수 있다. literal/단순 인자 fixture이므로 복잡한 plural/select 중심 카탈로그에 일반화하지 않는다.

## 검증과 원본

요약기 테스트 1개는 GC·idle·외부 표본 분리, 부모가 없는 core 스택, 재귀 inclusive 중복 제거, dist line ticks, 음수 delta 보존, 잘못된 배열 길이·node ID 거부를 확인한다. 두 모드에서 각각 100회 실행 후 마지막 probe 값과 전체 키 수를 확인하고 incremental의 unchanged 메시지 참조 유지도 확인했다. 200회 wall 표본 통계·두 원본의 전체 9163 CPU 표본·bucket 분해·함수 요약을 다시 대조했고, 9개 코드 hash가 두 모드와 현재 파일에 모두 일치했다. 제품 소스 diff는 없다. 기존 제품 테스트·build·pack·브라우저 검사는 입력이 같아 반복하지 않았다.

- [incremental 요약·호출 표본](../benchmarks/results/parser-cpu-2026-10-10-incremental.json), [원본 cpuprofile](../benchmarks/results/parser-cpu-2026-10-10-incremental.cpuprofile)
- [cold 요약·호출 표본](../benchmarks/results/parser-cpu-2026-10-10-cold.json), [원본 cpuprofile](../benchmarks/results/parser-cpu-2026-10-10-cold.cpuprofile)

버전 변경·push·publish·deploy는 없다.
