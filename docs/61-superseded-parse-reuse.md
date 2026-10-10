# 61. superseded 파싱 재사용과 다중 읽기 재현

이 문서는 [60-next-turn-additions.md](60-next-turn-additions.md)의 single-read 단정이 실제로 실패한 사례와, 그 실패를 재현하면서 넣은 superseded 파싱 재사용을 기록한다. 새 경로의 성공 파싱을 generation mismatch에서 폐기하던 동작이 같은 파일의 중복 cold parse를 만들었고, 이를 파일별 map으로 넘겨 최신 읽기에서 재사용하도록 바꿨다. 초기 cold parse 자체를 빠르게 만든 최적화는 아니다.

## 재현 (직전 60의 단정 실패)

[실패 trace](../benchmarks/results/new-additions-read-trace-2026-10-11.log)와 [메타데이터](../benchmarks/results/new-additions-read-trace-metadata-2026-10-11.json) 기준이다.

| 항목 | 값 |
| --- | --- |
| watcher 이벤트 | 2 |
| drain | 2 |
| pathcheck | 2 |
| read | 2 |
| parse | 2 |
| sourceLength | 두 읽기 모두 387783 |
| parse 결과 | 두 번 모두 정상 |
| hasPrevious | 두 읽기 모두 `false` |

- 60의 파일 계측은 after가 1회만 읽는다고 가정했다. 실제로는 2회 읽고 2회 파싱했다.
- 표본 시작점 기준 첫 parse 구간은 34.4474→151.0838 = 116.6364ms다.
- 둘째 parse 구간은 154.1388→284.511 = 130.3722ms다. 즉 117ms와 130ms 두 경계가 실제로 관측됐다.

## 원인

새 파일 처리 중 후속 이벤트가 들어오면 최신 generation이 아닌 첫 읽기의 결과는 게시되지 않는다. 성공한 파싱 결과도 버려져 다음 읽기에 전달할 이전 카탈로그가 없었다. 이 trace에서는 정상·동일 길이의 입력을 두 번 모두 이전 카탈로그 없이 파싱했다.

- 최초 파싱 비용은 남는다. 이번 변경은 폐기된 성공 파싱을 다음 읽기의 재사용 후보로 전달한다.
- 동일 길이와 정상 파싱만으로 텍스트 동일성을 판정하지 않는다. 실제 재사용은 최신 source와 이전 성공 파싱의 provenance를 대조한 결과에 따른다.

## 제품 변경 (`c19ca34`)

- `pendingParses` map에 superseded된 성공 `ParsedCatalog`만 파일별로 저장한다.
- 다음 읽기 전에 꺼내고 map에서 제거한다.
- 최신 파일 텍스트를 반드시 다시 읽어 `parseCatalog(source, options, previous)`에 넘긴다.
- 최신 source·정규화된 context가 이전 성공 파싱의 provenance와 정확히 일치할 때만 core provenance fastpath를 쓴다.
- 텍스트가 바뀌면 ICU/JSON과 translation 스키마 검증을 기존대로 수행한다.
- 캐시된 결과가 직접 accepted/publish로 들어가지 않는다. 최신 읽기와 스키마 검증을 거쳐야 한다.
- `.accepted` 게시는 최신 generation에서만 일어난다. stop은 map을 비운다.
- 새 읽기가 invalid이면 superseded된 구버전 결과를 게시하지 않는다.
- 테스트는 동일 내용의 객체 identity 재사용, 변경된 최신 내용 반영, invalid JSON의 last-good 유지, 동일 schema-invalid 내용의 unknown argument 거부 네 경우를 확인한다.

## 검증

- 제품 `c19ca34`에서 루트 `npm run check`가 통과했다. 총 223개다.
- 내역은 core 81, React 14, Svelte 14, typegen 9, Vite 100, script 5다.
- 소비 타입 검사와 React 예제 타입 검사도 함께 수행했다.
- 루트 `npm run check` 이후 tests-only schema 케이스를 추가한 plugin 48개가 통과했다. 추가 뒤 전체 루트 파이프라인은 반복하지 않았고 제품 소스는 동일하다.
- [native after trace](../benchmarks/results/superseded-parses-read-trace-2026-10-11.log)([metadata](../benchmarks/results/superseded-parses-read-trace-metadata-2026-10-11.json))도 여전히 2 read 2 parse다. first `hasPrevious` `false` 약 139.71ms, second `true` 0.3935ms다.
- 두 trace 모두 single-read 단정 조건 때문에 exit 1이다. 집계 p95는 없고 스키마 검증 실패가 아니다.
- assertion은 완화하지 않고 실패 자료를 그대로 보존한다.
- [정상 벤치](../benchmarks/results/superseded-parses-locale-add-2026-10-11.json)(sample 25·warmup 5·control 10·typegen ON) 결과다.

| 조건 | p50 | p95 | 250ms 이내 | 최대 |
| --- | --- | --- | --- | --- |
| small | 93.54ms | 279.47ms | 20/25 | 352.05ms |
| large | 126.09ms | 247.25ms | 24/25 | 271.94ms |

- 이번에는 large 조건만 250ms 목표에 들어오고 small은 미달이다. 두 조건의 안정적 달성은 미확인이다.
- before/after 독립 trace의 wall ms로 인과나 전체 p95 속도 개선을 주장하지 않는다.
- native Vite SSR 복구 5/5 `true`([원본](../benchmarks/results/superseded-parses-recovery-2026-10-11.json)), thin-layer prototype browser-smoke gap 0·8 PASS([원본](../benchmarks/results/superseded-parses-browser-2026-10-11.json))다.
- browser-smoke는 prototype 범위라 Saylo 어댑터 전체 검증으로 확대하지 않는다.
- 채택 근거는 최신 reader 텍스트와 스키마를 확인하면서 중복 cold parse를 줄인 것이고, 초기 cold parse 최적화가 아니다.
- 공개 API·의존성·버전은 그대로이고 커밋만 로컬이며 push·publish는 없다.

## 재현

```sh
npm run build
node benchmarks/live-update/run.mjs --scenario all --mode locale-add --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/superseded-parses-locale-add-2026-10-11.json
```

단일 읽기 조건이 실패하면 JSON 집계는 생성하지 않는다. stdout·stderr를 남기는 진단 명령은 다음과 같다.

```sh
node benchmarks/live-update/run.mjs --scenario 10k-20-locales --mode locale-add --samples 25 --warmup 5 --calibrations 10 --server-file-stages --out benchmarks/results/superseded-parses-read-trace-2026-10-11.json > benchmarks/results/superseded-parses-read-trace-2026-10-11.log 2>&1
```

## 남은 목표

다음 명시 목표는 성능 안정성이다. stage 다중 읽기 지원과 정확한 계측, owned map·fast additions의 잠정 선택 판정, thin-layer 전체 계약·lazy·SSR·production·timezone·perf 평가, 릴리스 전달 결정이 남아 있다. 장기 목표는 완료가 아니다.
