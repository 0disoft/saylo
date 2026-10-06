# 11. 파서 내부 측정

전체 갱신과 서버 파일 구간 측정은 [10-performance-measurements.md](10-performance-measurements.md)를 따른다. 이 문서는 파서 내부 비용과 작은 최적화의 검증을 별도로 기록한다.

## 기준 측정 (2026-10-07 KST)

`node benchmarks/live-update/parser-stages.mjs`로 [parser-stages-before.json](../benchmarks/results/parser-stages-before.json)에 기록했다. 기준 revision은 102a7c7이고 그 위의 benchmark-only 변경은 `workingTreeStatus`·`codeHashes`로 식별한다. Node v24.18.0, 로케일 en·namespace bench, 파일당 1천·1만 메시지, 고정 길이 probe 문구 1개 수정, 이전 immutable catalog 재사용 조건이다. warmup 10회 뒤 50회를 측정했다. 입력 stringify·디스크·watcher·번역 검증·브라우저는 제외했다.

Node module hook이 실제 core dist를 메모리에서만 감싸며 source·dist 파일은 바꾸지 않는다. JSON 처리와 위치 색인 생성, 전체 메시지 처리 loop, 최종 동결에 clock을 둔다. 메시지 loop에는 ICU 처리·재사용과 위치 조회·맵 구성이 함께 들어가며, 메시지마다 clock을 호출하지 않는다. token scan에는 decoded key 처리·중복 검사·entry 생성이 들어간다. strict JSON과 token scan은 전체 JSON 시간에 포함되므로 중첩 구간이나 p95를 더하지 않는다. 수치는 CPU profiler가 아닌 동기 호출 elapsed time이며 clock·GC·OS 스케줄링 영향을 포함한다.

| p95 | 1천 메시지 | 1만 메시지 |
| --- | --- | --- |
| 파서 전체 | 4.80ms | 60.20ms |
| JSON 전체 | 2.86ms | 38.08ms |
| strict JSON.parse(JSON 안) | 1.09ms | 13.90ms |
| token scan(JSON 안) | 1.90ms | 29.06ms |
| 줄 위치 색인 생성 | 0.29ms | 3.45ms |
| 메시지 loop | 1.12ms | 10.40ms |
| 최종 동결 | 0.70ms | 13.01ms |

1만 메시지의 p50은 전체 41.42ms, token scan 18.39ms였다. 이 단일 run에서는 token scan이 큰 구간이므로 첫 최적화 후보로 선택했다. 현재 `readJson`은 초기 strict parse 뒤 모든 key token을 다시 JSON.parse한다. JSON.parse로 전체 입력 문법이 이미 확인된 조건에서 backslash가 없는 key는 따옴표 제거만 하고, escape가 있는 key는 기존 JSON.parse를 유지하는 작은 변경을 검토한다. decoded 중복 ID와 literal prototype ID, 오류 위치 계약은 유지한다. 이 microbenchmark 결과를 화면 반영 p95로 환산하지 않는다.
