# 52. read/candidate 잔여 구간과 GC·타이머 지연 계측

[51](51-owned-message-map-comparison.md)은 종단 간 tail 증가를 확인했지만 그 원인이 read/candidate 잔여 구간인지, GC·이벤트 루프 지연인지는 가르지 못했다. 이 문서는 그 구간만 좁게 보기 위해 선택적 벤치 하네스를 확장한 기록이다. 커밋 `6403fab`에서 `--server-file-stages` 옆에 `--runtime-stages` 옵션을 추가해, 같은 표본에서 서버 런타임 window와 GC·타이머 지연 window를 함께 수집한다. 제품 dist와 공개 API는 바꾸지 않았고 일반 prebundle·typegen 설정도 그대로 둔다.

## 조건과 방법

2026-10-10 KST, Node v24.18.0, Windows x64(10.0.26300), Ryzen 5 7430U, Vite 8.3.2, React 19.3.0 개발 모드, HeadlessChrome 154.0.0.0이다. scenario는 `10k-20-locales`이고 run당 measured 25·warmup 5·calibrations 10이다. mode는 `edit`와 `locale-add` 두 가지이며 edit → locale-add 순서로 각 mode를 단일 run으로 실행했다. GC를 강제하거나 부하를 통제하지 않았다.

```sh
node benchmarks/live-update/run.mjs --mode edit --scenario 10k-20-locales --server-file-stages --runtime-stages --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/runtime-tail-edit-2026-10-10.json
node benchmarks/live-update/run.mjs --mode locale-add --scenario 10k-20-locales --server-file-stages --runtime-stages --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/runtime-tail-locale-2026-10-10.json
```

두 명령의 결과 aggregate는 편집 [runtime-tail-edit-2026-10-10.json](../benchmarks/results/runtime-tail-edit-2026-10-10.json)과 로케일 [runtime-tail-locale-2026-10-10.json](../benchmarks/results/runtime-tail-locale-2026-10-10.json)이고, raw 표본은 각각 [편집 samples](../benchmarks/results/runtime-tail-edit-2026-10-10.10k-20-locales.samples.json), [로케일 samples](../benchmarks/results/runtime-tail-locale-2026-10-10.10k-20-locales.samples.json)이다.

## 런타임 구간

`runtimeWindows`는 `readAndCandidate`, `pathCheck`, `fileRead`, `catalogParse`, `baseStat`, `candidateOther`를 기록한다. 표본 window(`sample`)는 stage begin이 write 전인 시점부터 stage finish가 ack 수신 뒤인 시점까지이다. 로케일은 목록 ack까지만이라 선택·리셋·삭제 구간은 넣지 않는다. `baseStat`는 `candidateOther` 안에 들어가는 기준 카탈로그 존재 확인 `Promise.all(stat)` 구간이다.

## GC와 타이머 지연

`PerformanceObserver`로 GC 이벤트의 `kind`·`flags`와 시작·끝 시각을 기록하고, 10ms로 재예약하는 타이머의 expected→observed 지연 구간을 함께 기록한다. 이벤트와 서버 window의 타임스탬프 교집합을 계산하고, union으로 겹친 시간을 한 번만 세며 구간 경계에서 clip한다. GC 전달이 비동기이므로 마지막 ack 뒤 저장된 window 밖에서 10ms 대기와 두 번의 `setImmediate` 양보를 거쳐 `takeRecords`로 남은 항목을 수집한다.

`gcOverlapMs`와 `timerDelayOverlapMs`는 서로 겹칠 수 있고 parent·child 구간도 겹친다. 그래서 두 값을 더하거나 wall에서 빼거나 CPU 시간·순수 OS 스케줄러 시간·인과 증명으로 쓰면 안 된다. 타이머 지연에는 동기 JS, GC, I/O 콜백, OS 스케줄링이 섞이고 계측 자체 overhead도 포함된다. 관측 API 정의는 Node 문서의 [`PerformanceObserver`](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html#class-performanceobserver)를 따른다.

## 해석 범위

이 기록은 계측 지점을 추가한 진단용이다. [51](51-owned-message-map-comparison.md)의 종단 간 수치와 직접 성능 비교하거나 홍보 근거로 쓰지 않는다.

## 결과·검증·다음 후보

단위는 ms이며 아래 p50/p95는 각 mode의 measured 25개에서 계산했다. sample window는 파일 쓰기를 포함하므로 저장 완료→ack와 경계가 다르다.

| 종단 간 진단 값 | p50 / p95 | 최대 | 목표 이내 표본 |
| --- | ---: | ---: | --- |
| 편집 저장→DOM ack | 148.39 / 168.50 | 174.41 | ≤100ms: 0/25 |
| 로케일 저장→목록 ack | 267.34 / 479.67 | 526.16 | ≤250ms: 7/25 |

| mode·runtime window | wall p50 / p95 | GC 교집합 p95 | 타이머 지연 교집합 p95 |
| --- | ---: | ---: | ---: |
| 편집 catalogParse | 30.55 / 38.94 | 0 | 30.53 |
| 편집 fileRead | 0.97 / 1.43 | 0 | 0 |
| 편집 baseStat | 0.22 / 11.56 | 11.20 | 1.55 |
| 편집 candidateOther | 0.48 / 12.28 | 11.20 | 2.14 |
| 로케일 catalogParse | 152.08 / 377.88 | 15.36 | 370.96 |
| 로케일 fileRead | 1.70 / 12.54 | 0 | 2.76 |
| 로케일 baseStat | 0.60 / 20.10 | 19.33 | 10.03 |
| 로케일 candidateOther | 0.87 / 20.42 | 19.33 | 10.14 |

이번 편집은 최대 174.41ms로 [51](51-owned-message-map-comparison.md)의 300~400ms 긴 표본을 재현하지 못했다. 로케일 fileRead도 최대 18.26ms로 이전 실행의 100ms 이상 읽기 지연은 재현되지 않았다. 이전 tail의 원인을 소급 확정하지 않는다.

로케일 최장 표본 `10k-20-locales:36`은 목록 ack 526.16ms, 파싱 window 378.45ms, 파싱과 겹친 타이머 지연 376.15ms이며 수집된 GC 교집합은 0이다. 다음 긴 표본 `:34`도 목록 ack 479.67ms·파싱 233.26ms·파싱 GC 교집합 0이다. 따라서 이번 긴 표본을 GC 하나로 설명할 근거는 없다. 동기 파싱과 타이머 지연이 겹쳤다는 관찰이며 파싱의 순수 CPU 비용과 OS 스케줄링 비중은 구분하지 못한다.

GC가 겹친 기준 파일 대기도 있다. 로케일 `:22`의 baseStat window 23.08ms 중 GC 교집합은 22.28ms이고, 편집 `:18`은 13.80ms 중 13.10ms다. 이 값만으로 파일시스템 자체가 느리다고 판단하지 않는다. 측정 표본 중 파싱 GC 교집합이 있는 표본은 편집 0/25·로케일 4/25, baseStat는 3/25·4/25다.

- 관련 테스트 4개와 enabled 편집 두 시나리오·enabled 로케일 small·disabled 편집 small 브라우저 스모크가 통과했다. 스모크 수치는 성능 결과에 넣지 않았다.
- raw 60개(measured 50·warmup 10)와 control 20개를 확인했다. 기존·신규 timing 요약 89개를 원시에서 재계산했고 420개 runtime 관찰을 별도 교집합·구간 합집합 계산으로 대조해 일치했다.
- 모든 표본의 path·read·parse·baseStat window는 각 1개이고 drain은 1회다. baseStat의 candidateOther 포함 관계와 파일 세 구간·잔여 구간의 readAndCandidate 분할도 확인했다.
- 37개 unique 하네스·dist hash가 현재 파일과 일치하고 두 mode의 공통 hash도 같다. 제품 dist hash는 51의 변경 후 스냅샷과 그대로다.
- 하네스가 입력 노드·입력값·React state·번역 DOM을 확인했고 `.d.ts` mtime·size는 유지했다. 측정 편집은 한 메시지 patch·position 갱신 0, 로케일은 선택 전 응답 0·선택 후 compact full 1개이며 복귀·삭제·목록 제거도 마쳤다. 임시 디렉터리·전용 브라우저 프로세스는 남지 않았다.
- 제품 입력이 그대로이므로 전체 제품 테스트·pack·release는 반복하지 않았다. 버전 변경·push·publish·deploy는 없다.

다음은 기존 `parser-cpu.mjs`의 `cold` 모드로 신규 파싱 내부 호출을 좁게 프로파일링해 개선 후보 하나를 고르는 것이다. 이번 관찰만으로 기준 파일 존재 검사를 생략하거나 최적화를 자동 원복하지 않는다.
