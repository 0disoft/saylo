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

## 키 디코딩 실험 — 적용하지 않음

다음 조건 분기로 escape가 없는 key의 중복 JSON.parse를 피하는 실험을 했다.

```js
const token = key[0];
const id = token.includes('\\') ? JSON.parse(token) : token.slice(1, -1);
```

구간 측정은 [parser-stages-key-after.json](../benchmarks/results/parser-stages-key-after.json)에 보존했다. 1만 메시지 token scan p95는 29.06→22.60ms였지만 1천 메시지 파서 전체 p95는 4.80→12.57ms로 높아졌다. 별도 run의 부하 차이가 있어 이 비교만으로 효과를 판정하지 않았다.

`node benchmarks/live-update/parse-compare.mjs d64199c benchmarks/results/parse-compare-key.json`로 baseline과 trial을 같은 프로세스에서 번갈아 호출했다. warmup 50·측정 100 pair, 1만 메시지, 동일 길이 문구 1개 수정 조건이며 입력 stringify·동등성 검사·디스크·watcher·브라우저는 timing에서 제외한다. 모든 pair의 전체 parsed catalog가 동일했다. [parse-compare-key.json](../benchmarks/results/parse-compare-key.json)의 p50은 41.28→37.60ms, p95는 56.46→67.12ms였다. pair별 차이 median은 -2.64ms이고 100 pair 중 65 pair가 빨라졌지만 p95 개선 근거는 없었다.

실제 watcher·브라우저 trial은 [live-update-key.json](../benchmarks/results/live-update-key.json)에 있다. warmup 5·측정 50·control 25, 서버 파일 계측 켬·브라우저 상세 계측과 CPU profiler 끔 조건에서 small p95 131.13ms·large 367.88ms였다. fileWrite p95도 49.44ms·40.49ms로 높았고 control 왕복 p95는 13.05ms·15.18ms였다. 이 값은 코드 변경의 회귀를 재현한 것으로 보지 않지만, tail latency 개선이 확인되지 않아 조건 분기는 **되돌렸다**. trial 결과는 변경된 json.js hash를 가진 실험 기록이며 최종 runtime 결과와 구분한다.

## 줄 위치 색인 최적화 — 로컬 적용

`diagnostics.ts`의 `createPositionLocator`가 모든 UTF-16 문자를 한 글자씩 검사하던 loop를 `source.indexOf('\n')`로 LF 위치만 찾는 loop로 바꿨다. lineStarts 배열과 이분 탐색 조회 방식은 유지했다. JSON 파서·ICU·중복 key 검사·메시지 재사용·동결 방식은 변경하지 않았다.

`node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-position-after.json`의 [parser-stages-position-after.json](../benchmarks/results/parser-stages-position-after.json)은 같은 fixture·옵션의 별도 run이다. 기준 revision d64199c 위의 최종 변경은 `workingTreeStatus`·`codeHashes`로 식별한다.

| 파서 내부 p95 | 1천 전 | 1천 후 | 1만 전 | 1만 후 |
| --- | --- | --- | --- | --- |
| 줄 위치 색인 생성 | 0.291ms | 0.014ms | 3.449ms | 0.087ms |
| JSON 전체 | 2.86ms | 2.76ms | 38.08ms | 29.94ms |
| 메시지 loop | 1.12ms | 1.11ms | 10.40ms | 6.68ms |
| 최종 동결 | 0.70ms | 0.83ms | 13.01ms | 9.26ms |
| 파서 전체 | 4.80ms | 4.69ms | 60.20ms | 41.79ms |

전체 파서와 변경하지 않은 JSON·메시지 loop·동결 구간도 달라졌으므로 전체 감소를 위치 색인 변경 효과로 귀속하지 않는다. 이 값은 parser-only의 동기 호출 elapsed time이고, 화면 반영이나 CPU 시간으로 환산하지 않는다.

core build와 카탈로그·patch 테스트 25개가 통과했다. LF·CRLF·빈 source·연속/마지막 LF·astral Unicode의 UTF-16 열 번호를 모든 offset에서 확인했고, JSON 문자열 안의 escaped newline과 실제 LF를 구분했다. escaped key·decoded 중복 ID, ICU 오류 위치, 같은 문구의 AST 재사용, source 재정렬·길이 변경, uniform position shift·삭제 키·full 복구도 검증했다.

최종 runtime으로 실제 갱신도 `node benchmarks/live-update/run.mjs --server-file-stages --out benchmarks/results/live-update-position.json`로 재측정했다. [live-update-position.json](../benchmarks/results/live-update-position.json)의 조건은 warmup 5·측정 50·control 25, 서버 파일 계측 켬, 브라우저 상세 계측·CPU profiler 끔이다. 기준 revision d64199c 위의 final diagnostics.js hash로 실행 코드를 구분한다. JSON 파서 hash는 기준 측정과 같아 키 디코딩 trial이 최종 코드에 남지 않았음을 확인했다.

| 시나리오 | save→DOM ack p50 | save→DOM ack p95 | read p95 | parse p95 | receive→commit p95 | control 왕복 p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 로케일 | 64.32ms | 72.66ms | 1.13ms | 5.21ms | 4.90ms | 7.29ms |
| 10k×20 로케일 | 153.44ms | 165.94ms | 1.31ms | 41.89ms | 34.10ms | 4.98ms |

위치 색인 변경 전 같은 서버 파일 계측 옵션의 run은 small p95 71.85ms·large 180.93ms였다. control 왕복도 10.26→7.29ms·7.18→4.98ms로 낮아져 종단 간 감소 전체를 최적화 효과로 보지 않는다. 대규모 목표 p95 ≤ 100ms는 여전히 미달이다.

최종 parser-only raw sample은 각각 60개(측정 50개), 실제 갱신 raw sample은 각각 55개(측정 50개)이며 timing·서버·파일 구간·control 요약과 실제 source hash를 대조했다. 모든 실제 갱신 측정은 patch 1개 메시지·position 갱신 0개·full 응답 0회였고 입력 노드·값과 컴포넌트 state가 유지됐으며 타입 파일은 다시 쓰이지 않았다. 임시 fixture·browser profile·baseline compile 폴더와 해당 브라우저 프로세스도 정리됐다.

다음 병목 후보는 JSON token scan과 최종 동결·메시지 맵 구성이다. 이전의 key 디코딩 생략을 안정적 개선으로 재채택하지 않고, 파싱 때 만드는 임시 entry 배열·정규식 match 객체나 바뀌지 않은 위치/메시지의 할당을 줄이는 방향을 검토한다. 오류 위치·decoded 중복 ID·schema 변경과 full resync 계약을 유지하며, 남은 로케일 추가 지연과 다른 도구 비교도 별도 작업이다. 이 변경은 로컬 구현이며 npm `0.1.0-alpha.1`에 아직 없다.
