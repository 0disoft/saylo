# 58. 꼬리 디스크 재확인

## 배경

`463083e` 이전에는 짧은 시간 안의 두 번째 변경이 watcher에 전달되지 않아 invalid JSON 진단 직후의 valid 저장이 복구되지 않았다. 무간격 로컬 실험에서 복구가 실패했고([rapid-recovery-2026-10-11.json](../benchmarks/results/rapid-recovery-2026-10-11.json)), 그 기록은 시점 기록으로 유지한다. 설치된 Vite bundle에는 change 이벤트 50ms throttle이 관측되지만, native OS coalescing 같은 다른 원인은 대조하지 않았으므로 인과를 단정하지 않는다.

## 변경 내용

디스크 재확인(`packages/vite/src/disk-rechecks.ts`)이 첫 게시 뒤 metadata를 한 번 더 본다.

- 읽기 전 stat 1회로 stamp를 남긴다. stamp는 `dev:ino:size:mtimeNs:ctimeNs`다(`diskStamp`).
- 첫 guarded drain은 기존처럼 다음 이벤트 루프 턴에 0ms 타이머로 예약한다. 게시까지는 경로 검사·stat·읽기·파싱 시간이 든다.
- 완료 60ms 뒤(`RECHECK_MS`) metadata를 1회 확인한다.
- 값이 그대로면 재파싱·재게시 없이 끝낸다.
- stamp가 바뀌었으면 reader를 포함한 enqueue로 바로 재읽기한다. add/unlink와 읽기 중 ENOENT에는 기존 40ms settle(`QUIET_MS`)을 유지한다.
- 후속 read마다 check를 1회 두고, 최신 enqueue가 이전 token을 취소하며 stop이 타이머를 정리한다. 지속 polling이나 전체 scan은 없다.

## 관측 결과

final source(`8f25416`)의 fresh Vite SSR 5개 케이스가 모두 `recovered: true`다.

| 케이스 | gap(ms) | source | revision |
| --- | ---: | --- | ---: |
| json-0-a | 0 | Recovered | 1 |
| json-60 | 60 | Recovered | 1 |
| json-0-b | 0 | Recovered | 1 |
| schema-0 | 0 | Recovered | 1 |
| valid-0 | 0 | Recovered | 2 |

`463083e` 이전 기록은 gap 0 두 run이 복구 실패(`false`), gap 60만 `true`였다. final은 JSON 0/60/0·schema 0·valid→valid 0이 모두 복구된다. 브라우저 프로토타입 소스도 `--gap-ms 0` 8개 시나리오 PASS(input value, DOM identity/focus, dialog, counter 8, old snapshot, base plural 0 rows)를 유지한다.

## 비용과 한계

- 일반 저장에도 읽기 전 stat이 1회 늘었고, 60ms 뒤 추가 stat이 든다. 이벤트가 누락된 저장은 이 확인 뒤 다시 읽으므로 반영이 늦어질 수 있다. atomic save의 ENOENT 재시도에는 40ms 안정화 시간도 든다.
- final same-condition large 10k×20 편집 single run(`samples 25`+`warmup 5`+`calibrations 10`, normal typegen)은 p50 96.82ms·p95 133.63ms이고 100ms 이내 표본은 25개 중 17개다. 100ms 목표에는 아직 미달이다. 계측은 save→HTTP DOM ack 수신(no paint)이다.
- same-condition large 10k×20 로케일 추가 single run(`samples 25`+`warmup 5`+`calibrations 10`, normal typegen)은 list saveToListAck p50 171.24ms·p95 322.35ms이고 250ms 이내 표본은 25개 중 21개다. 250ms 목표에는 아직 미달이다. 54의 두 run 193.56·184.78ms 통과는 다른 source 시점 기록이다.
- 같은 편집 run의 queueToDrain p50 2.64ms·p95 4.32ms(최대 134.43ms 1건)이고, 첫 metadata 재확인 변형은 p95 48.39ms였다. control round trip p50 4.54ms·p95 6.99ms, maxFileEvents 2·maxDrains 3이다. 변형 간 인과는 확정하지 않는다.
- 첫 버전 기록 82.18ms/148.50ms는 시점이 다른 역사로 유지하며, 독립 single run끼리 인과나 개선을 확정하지 않는다.
- 관측 파일·코드 hash로 실제 5 SSR·8 browser·93 tests를 검증했다. metadata helper가 모든 플랫폼에서 이벤트 신뢰성을 보장하지는 않는다.

## 검증 범위

- final Vite 93개 테스트와 build PASS. Vite 소비자 typecheck는 private callback 추가 전 코드로 PASS(공개 API 변경 없음)라 재반복하지 않았다.
- 전체 root `check`·`release:pack`은 이번 Vite 경로 한정이라 돌리지 않았다.
- 공개 API·의존성·버전은 바꾸지 않았고, 로컬 커밋만 했으며 push·publish는 없다.

## 원본과 재현

final raw는 [rapid-recovery-fast-read-2026-10-11.json](../benchmarks/results/rapid-recovery-fast-read-2026-10-11.json), [thin-layer-browser-fast-read-2026-10-11.json](../benchmarks/results/thin-layer-browser-fast-read-2026-10-11.json), [disk-rechecks-fast-read-edit-2026-10-11.json](../benchmarks/results/disk-rechecks-fast-read-edit-2026-10-11.json)([samples](../benchmarks/results/disk-rechecks-fast-read-edit-2026-10-11.10k-20-locales.samples.json)), [disk-rechecks-fast-read-locale-add-2026-10-11.json](../benchmarks/results/disk-rechecks-fast-read-locale-add-2026-10-11.json)([samples](../benchmarks/results/disk-rechecks-fast-read-locale-add-2026-10-11.10k-20-locales.samples.json))이다. 첫 버전은 rapid-recovery-fixed·thin-layer-browser-rapid·disk-rechecks-edit-current다. browser·rapid의 기본 outfile은 `current.json`이라 과거 파일은 덮어쓰지 않는다.

```sh
node benchmarks/thin-layer/rapid-recovery.mjs --assert-recovered --out benchmarks/results/rapid-recovery-fast-read-2026-10-11.json
node benchmarks/thin-layer/browser-smoke.mjs --gap-ms 0 --out benchmarks/results/thin-layer-browser-fast-read-2026-10-11.json
node benchmarks/live-update/run.mjs --scenario 10k-20-locales --mode edit --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/disk-rechecks-fast-read-edit-2026-10-11.json
node benchmarks/live-update/run.mjs --scenario 10k-20-locales --mode locale-add --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/disk-rechecks-fast-read-locale-add-2026-10-11.json
```
