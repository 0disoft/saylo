# 34. 메시지 동결 내부 구간 계측

[33](33-owned-message-freeze-trial.md)의 실험을 되돌린 제품 코드로 메시지 동결 내부 비용을 나눴다. 10k 측정 20회 중 AST 동결이 하위 구간 중 가장 큰 경우는 18회였다. 절대 위치 생성은 메시지 동결 전체의 표본별 비중 p50이 1.86%였다. 다음 후보는 AST 동결 함수의 호출별 내부 헬퍼 생성 제거이며 아직 제품에 적용하지 않았다.

## 조건과 경계

```sh
node --test benchmarks/live-update/parser-probe.test.mjs
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-message-freeze-split-cold.json cold
```

gitRevision은 `eae473eb87f0313507b8c08631c5768c5b37a3fe`, measuredAt은 `2026-10-07T14:15:27.226Z`이다. Node 24.18.0, Windows x64, Ryzen 5 7430U에서 실행했다. 규모별 한 파일에 일반 텍스트·ASCII `{name}` 메시지 1k/10k를 두고 이전 카탈로그 없이 warmup 5회·측정 20회를 수집했다. 입력은 각각 36,772/387,772 B이고 매회 같은 길이의 probe 하나를 바꿨다. namespace는 bench, locale은 en-GB이다. 강제 GC는 사용하지 않았다.

변환은 core dist를 읽는 Node load hook의 메모리 안에서만 일어난다. 제품 source·dist는 바꾸지 않았다. 결과 형식은 `saylo-parser-stages-v3`이다. 기존 cold 상세 프로브에 세 경계와 표본별 잔여를 추가했다.

| 필드 | 포함하는 작업 |
| --- | --- |
| messagePositionMs | `positionAt(entry.valueOffset)`의 절대 좌표 조회와 위치 객체 생성. 위치 객체 동결은 제외 |
| messageAstFreezeMs | `freezeMessageAst(ast)` 전체. 노드·배열 동결, core WeakSet 조회·등록, 필요한 위치 동결과 내부 헬퍼 생성 포함 |
| messageRecordFreezeMs | 이미 만든 메시지 레코드에 대한 일반 `freeze` 호출. 위치 객체의 재귀 동결, AST·인자 캐시 확인, 레코드 동결·등록 포함 |
| messageFreezeOtherMs | 부모 messageFreeze에서 위 세 구간을 표본별로 뺀 잔여. 레코드 생성·맵 대입·프로브 기록과 구간 사이 작업 포함 |

위치 생성→AST 동결 순서를 제품의 원래 인자 평가 순서에 맞췄다. 과거 v2 상세 프로브는 AST 동결을 먼저 실행했다. 구간 수·순서·타이머 비용이 달라 과거 total과 전후 최적화 비교를 하지 않는다. record 생성은 recordFreeze 타이머 밖이지만 부모 messageFreeze 안이다. AST와 arguments 추론은 별도 형제 구간이며 기존 argumentFreeze는 arguments의 자식이다.

입력 stringify·heapUsed 읽기·assertion·디스크·watcher·번역 검증·브라우저는 측정 밖이다. 각 구간은 프로브 비용·GC·스케줄링을 포함한 동기 wall time이다. p50·p95는 nearest-rank이다. 중첩 p95를 합산하지 않고 GC·control을 차감하지 않으며 Node·Browser clock을 섞지 않는다.

## 결과

| 구간 | 1k p50 | 1k p95 | 10k p50 | 10k p95 |
| --- | --- | --- | --- | --- |
| total | 25.66 | 61.23 | 172.09 | 277.32 |
| messageFreeze 부모 | 11.76 | 46.20 | 81.89 | 202.42 |
| 절대 위치 생성 | 0.29 | 0.45 | 1.52 | 1.98 |
| AST 동결 | 5.04 | 39.77 | 36.24 | 166.01 |
| 레코드 동결 | 4.51 | 6.17 | 31.93 | 38.93 |
| 부모 잔여 | 1.62 | 5.25 | 9.39 | 12.08 |

단위는 ms이다. 표본별 네 하위 구간 비교에서 1k는 AST 18회·잔여 2회, 10k는 AST 18회·레코드 1회·잔여 1회가 가장 컸다. AST가 레코드 동결보다 큰 표본은 각각 20/20·19/20회였다. 절대 위치 생성/부모 비중 p50은 2.38%·1.86%, p95는 2.93%·2.16%였다. 위치 동결은 레코드 구간이므로 이 비중으로 위치 관련 전체 비용을 설명하지 않는다.

GC timestamp가 전체 파싱 구간과 겹친 측정은 각각 9/20·11/20회였다. GC 겹침이 AST 동결 tail의 원인인지 분석하지 않았고 겹침 시간을 차감하지 않았다. 이 계측으로 실제 언어 목록 250ms 목표 달성이나 종단 간 개선을 주장하지 않는다.

## 검증과 다음 후보

새 프로브 검사는 별도 Node 프로세스에서 상세 켬·끔을 각각 실행한다. 일반·Unicode·CRLF·plural·number skeleton 결과, 잘못된 ICU·중복 JSON 키 진단을 원본 파서와 대조했다. 깊은 동결, 위치 이동 후 AST 재사용, 동일 파일의 메시지 참조 재사용, cold 하위 호출 수와 부모 시간 경계도 확인했다. 테스트 1개가 통과했다. dist 5개 hash가 전후 같았고 [33의 실험 전 스냅샷](../benchmarks/results/parser-stages-owned-message-before.json)과도 일치했다.

측정의 원시 25회씩에서 호출 수·시간 유한성·구간 잔여를 확인하고 측정 20회의 모든 요약을 재계산했다. core·하네스·lockfile hash를 현재 파일과 대조했다. 제품 변경이 없어 workspace 전체·build·consumer 타입·pack·브라우저·release 검사는 반복하지 않았다.

표본별 비교 분석도 원시에서 다시 대조했다. 변경한 Markdown 여섯 파일의 로컬 링크 182개·코드 fence·40KB 제한과 `git diff --check`가 통과했다.

다음 작은 제품 실험은 `freezeMessageAst`가 호출마다 만드는 `seal` 헬퍼를 모듈 범위의 공유 함수로 옮기는 것이다. 내부 WeakSet 신뢰와 FormatJS 복잡한 ICU의 일반 동결을 유지한다. 이번 측정은 헬퍼 생성만의 비용을 분리하지 않았으므로 효과는 미확인이다. cold/incremental 교차 비교로 채택 여부를 판단한다. 이미 되돌린 메시지 직접 동결 실험은 재적용하지 않는다.

## 자료

- [요약](../benchmarks/results/parser-stages-message-freeze-split-cold.json)
- [1k 원시](../benchmarks/results/parser-stages-message-freeze-split-cold.1000.samples.json)
- [10k 원시](../benchmarks/results/parser-stages-message-freeze-split-cold.10000.samples.json)
- [표본별 비교 분석](../benchmarks/results/parser-stages-message-freeze-split-cold-analysis.json)

버전 변경·push·publish·deploy는 없다.
