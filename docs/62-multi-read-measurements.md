# 62. 다중 읽기 구간 계측과 batch 소유권

## 배경

`c19ca34`와 [61](61-superseded-parse-reuse.md)은 새 카탈로그 경로에서 읽기가 두 번 일어나는 상황을 다뤘다. 다만 v1 계측은 drain을 시작할 때 `this.running` callback과 `prepareTranslations`의 소유 batch를 각각의 drain 시작값으로 덮어썼다. 두 번째 drain이 시작되면 첫 batch의 콜백이 새 batch의 창에 섞였고, read·parse가 한 번만 일어난다는 단정(single path·read 1회·parse 1회)이 두 읽기 때문에 중단됐다.

이번 수정은 benchmark 전용이다. 제품 소스는 `c19ca34` 그대로이고 커밋 `a0e47d5`는 `benchmarks/live-update`의 profile·run·server-file-profile과 그 테스트만 바꾼다. 출고 package·dist 코드는 바뀌지 않고 clock 개입도 없다.

## v2 계측 방식

- `AsyncLocalStorage`로 각 drain의 `this.running` callback과 `prepareTranslations`를 자기 batch에 묶는다. 한 drain이 연 창은 그 batch의 콜백만 담는다.
- batch 창은 drain 시작부터 그 batch의 `prepareTranslations`까지다. superseded·error로 끝난 창은 running promise가 정산되는 시점까지로 늘린다.
- 겹치는 대기창은 union으로 합쳐 `readAndCandidateMs`를 만든다. 각 file metric도 완료된 operation interval의 union으로 계산한다.
- `candidateOther`는 parent union에서 모든 file operation union을 뺀 구간 길이다.

## batch 경계 정의

| 경계 | 시작 | 끝 |
| --- | --- | --- |
| queue | 갱신 이벤트 도착 | drain 시작 |
| running | drain 시작 | 그 batch의 `prepareTranslations` |
| superseded·error | drain 시작 | running promise 정산 |

## child 기록 규칙

- child가 parent 밖이거나 ops가 없거나 끝나지 않았거나 개수가 맞지 않거나 성공 파싱이 없으면 오류로 남긴다.
- path·read·parse가 여러 번 일어나는 것과 실패한 path 재시도는 허용한다. 기록은 그대로 유지한다.
- `queueToDrainMs`는 첫 batch의 queue wait이다. 각 wait는 `drainWaitMs` 원시값으로 따로 보관한다.
- `boundaryVersion` 2를 summary와 samples에 기록한다.
- union 도입 때문에 v1의 candidate·queue 값과 직접 비교하지 않는다.

## 검증

- `server-file-profile.test` 3개와 `runtime-profile.test` 2개가 통과했다.
- 직렬 superseded 읽기를 2회 실행했다. 두 실행 모두 publication 1, parent 창 2, operation 2/2/2이고 interval partition 검증이 통과했으며 dist 해시는 그대로다.

## 이번 run 측정

상세 계측과 runtime observer 10ms 타이머를 켠 조건이다. typegen ON·sample 25·warmup 5·control 10이다.

| 항목 | p50 | p95 | 최대 |
| --- | --- | --- | --- |
| 목록 반영 | 97.87ms | 115.88ms | 265.87ms |
| 후보 구간 | 62.64ms | 78.92ms | 226.87ms |
| 파서 구간 | 59.95ms | 70.32ms | 212.93ms |

- 목록은 250ms 이내 24/25이고 최대 265.87ms 표본이 하나 있다.
- 두 번 읽은 표본은 measured 3/25다. 각각 path·read·parse 2회이고 두 번째 파싱의 `hasPrevious`가 `true`다. 세 표본의 두 번째 파싱 구간은 각각 0.2549ms·0.1291ms·0.1360ms다.
- runtime parser의 GC 이벤트는 0, observer overlap은 0ms, late timer 최대는 204.64ms다.
- 가장 긴 표본은 목록 265.87ms와 parser clock 212.93ms다.

## 해석의 한계

- GC가 관측되지 않았다는 뜻이고 GC가 불가능하다는 증명이 아니다.
- timer lateness는 동기 JS·GC·JIT·OS 지연을 모두 포함하므로 원인을 확정하지 않는다.
- 이 run은 상세 계측 조건이다. 일반 조건에서 115ms 개선이나 안정 달성을 주장하지 않는다.
- [61](61-superseded-parse-reuse.md)의 일반 조건 기록(small p95 279.47ms·large p95 247.25ms)은 역사값으로 보존한다.

## 기록 확인

- warmup 5를 포함한 전체 30개 표본의 interval partition이 통과했다.
- 코드 hash 지문·summary·전체 30 candidate/file interval·child contained·remainder 계산을 결과 파일에서 확인했다.

## 재현

```sh
node benchmarks/live-update/run.mjs --scenario 10k-20-locales --mode locale-add --samples 25 --warmup 5 --calibrations 10 --server-file-stages --runtime-stages --out benchmarks/results/multi-read-stages-2026-10-11.json
```

원시 결과는 [summary](../benchmarks/results/multi-read-stages-2026-10-11.json)와 [samples](../benchmarks/results/multi-read-stages-2026-10-11.10k-20-locales.samples.json)에 있다.

## 남은 목표

성능 안정성 목표, owned map·fast additions의 잠정 판정, thin-layer 전체 계약·lazy·SSR·production·timezone·perf 평가, 릴리스 전달 결정이 남아 있다. 이번 run은 다중 읽기 계측 하나를 닫을 뿐 전체 완료가 아니다. 공개 API·의존성·버전은 그대로이고 push·publish는 없다.
