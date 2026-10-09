# 41. JSON entry 방문 콜백 실험

JSON 읽기 경로에서 임시 entry 배열을 없애는 실험을 했다. cold·incremental 모두 성능 근거가 부족해 되돌렸다. 제품 코드와 계측 하네스는 `257ea857126a1d4856bbfb7a125db28b9417dd16` 상태로 유지하고, 실험은 [패치](../benchmarks/results/json-entry-visitor-experiment.patch)로 보존한다.

## 실험 범위

`packages/core/src/json.ts`의 `readJson`이 `JsonEntry[]` 대신 방문 콜백을 받아 `void`로 끝나게 했다. 항목을 임시 배열에 쌓지 않고 만나는 즉시 넘긴다. 개별 entry 객체와 정규식 match는 계속 생성하므로 할당 완전제거나 메모리 감소는 주장하지 않는다.

`JSON.parse`의 엄격한 검증과 문자열·decoded 중복 ID 검사는 유지한다. 중복을 찾으면 콜백은 멈추지만 scanner는 계속 돌아, 뒤따르는 문자열 외 값이 `DUPLICATE_ID`보다 `INVALID_CATALOG`로 우선 반환되는 의미를 지킨다. `catalog.ts`는 콜백으로 메시지를 처리하고 `INVALID_ID`·ICU·`ARGUMENT_CONFLICT`를 모아 reader가 끝난 뒤 검사하므로 JSON 오류가 우선한다. 위치 색인은 최초 `positionAt` 때 지연 생성해 잘못된 source type이 native `TypeError` 대신 기존 `INVALID_JSON`을 내게 했다. 공개 export·버전·wire 형식은 그대로다. 되돌린 파일은 제품 `json.ts`·`catalog.ts`와 `catalog.test.mjs`다.

## 측정 조건

Node v24.18.0, Windows x64에서 실행했다. cold는 2026-10-09T08:24:35.395Z, incremental은 2026-10-09T08:25:55.980Z에 기록됐다. 단순 메시지·ASCII 인자 10,000개에서 probe 하나만 매회 같은 길이로 바꾸고, 기준 커밋 `257ea85` 소스를 임시 디렉터리에서 빌드한 파서와 실험 파서를 같은 프로세스에서 순서를 번갈아 호출했다. cold는 warmup 5쌍·측정 20쌍, incremental은 warmup 50쌍·측정 100쌍이며 매쌍 결과 전체를 `assert.deepEqual`로 대조했다. 호출 wall time만 측정하고 stringify·동등성 검사·디스크·watcher·번역 검증·브라우저는 제외했다. p50·p95는 nearest-rank이고 쌍별 차이는 실험−기준이며, p95 합산이나 GC·clock 시간 차감은 하지 않는다. 재현은 기준 커밋 별도 checkout에 위 패치를 같은 경로로 복사해 `git apply`한 뒤 core를 빌드하고 `benchmarks/live-update/parse-compare.mjs`를 cold·incremental로 실행한다. 두 결과의 `baselineRevision`은 `257ea857126a1d4856bbfb7a125db28b9417dd16`이고 `currentCodeHashes`는 되돌리기 전 실험 dist를 가리키며 두 모드가 같다.

## 결과와 채택 판단

| 모드 | 기준 p50 | 실험 p50 | 기준 p95 | 실험 p95 | 쌍별 차이 중앙값 | 쌍별 차이 p95 | 빨라진 쌍 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 81.22 | 99.03 | 141.77 | 152.26 | +10.50 | +68.05 | 5/20 |
| incremental | 23.37 | 24.42 | 35.70 | 35.47 | +0.72 | +9.26 | 37/100 |

단위는 ms다. cold는 p50·p95가 모두 커지고 20쌍 중 5쌍만 빨랐다. incremental은 p50이 늘고 100쌍 중 37쌍만 빨랐으며 최대값이 40.86ms에서 56.63ms로 커졌고, 집계 p95만 35.70ms에서 35.47ms로 근소하게 낮아졌다. 이번 cold 비교에서 개선을 확인하지 못해 incremental p95의 근소한 감소만으로 채택하지 않고 제품 2개·테스트 변경을 되돌렸다. 단일 run의 부하·GC·스케줄링을 통제하지 않아 증가 원인이나 회귀를 코드로 확정하지 않는다. heap을 측정하지 않았고 실제 HMR·로케일 목표에서의 향상이나 기존 run 숫자와의 직접 인과도 주장하지 않는다.

## 검증과 보존 자료

실험 상태에서 core build, 선택 catalog/simple 테스트 32개, 전체 core 테스트 76개, consumer 타입 검사가 통과했다. 선택 32개는 전체 76개에 포함되므로 중첩 합산하지 않는다. 새 JSON 테스트는 ICU·ID·인자 충돌 오류보다 뒤의 중복 키·문자열 외 값 오류가 우선하는지, 이스케이프한 중복 키와 덮어쓴 문자열 외 값, 두 중복 오류의 순서·offset을 확인한다. 기존 Unicode·ICU 위치·동일 메시지 참조 재사용·깊은 불변성 테스트도 통과했고 cold 25쌍·incremental 150쌍 모두 카탈로그 전체 deepEqual이 성공했다. 상세 `parser-probe`는 실험 중 경계가 바뀌어 실행하지 않았고 비교 도구는 상세 계측을 끈 상태였다.

3파일을 원복한 뒤 core build와 `parser-probe.test.mjs`를 통과했다. 제품·계측 경로의 diff가 없고 두 run의 코드 해시가 같은지 확인했다. 재빌드한 catalog·JSON 해시는 실험본과 다르고 나머지 세 모듈은 같았다. 원시 쌍의 개수·차이·nearest-rank 요약과 `git apply --check`로 보존 패치의 재적용 가능 여부를 검사했다. 임시 parser 디렉터리는 정리됐다.

- [cold 비교와 원시 쌍](../benchmarks/results/parse-compare-json-visitor-cold.json)
- [incremental 비교와 원시 쌍](../benchmarks/results/parse-compare-json-visitor-incremental.json)
- [되돌린 실험 패치](../benchmarks/results/json-entry-visitor-experiment.patch)

버전 변경·push·publish·deploy는 없다. 다음 작업은 새 실험을 무리하게 확정하지 않고 다른 구조적 병목 후보 검토로 둔다.
