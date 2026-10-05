# 06. 검증과 로드맵

이 문서는 성능 목표와 측정 정의, 인수 사례, 빌드 순서, 개발 로드맵을 정한다.

## 성능 목표

아래 수치는 목표다. 로컬 벤치마크로 일부를 측정했고, 결과와 한계는 아래 실측 기록에 남겼다. request-scoped patch 적용 뒤 small은 재실행에서 p95 목표 안에 들어왔지만 같은 코드의 첫 run은 넘었고, large는 어느 run에서도 p95 목표를 넘었다. 어느 시나리오도 안정적 달성을 주장하지 않는다.

| 항목 | 목표 | 조건 |
| --- | --- | --- |
| 개발 중 카탈로그 문자열 수정 반영 | p95 ≤ 100ms | warmed 상태, 로컬 기준 환경 |
| 로케일 추가 후 목록 표시 | p95 ≤ 250ms | 대표 fixture. 새 로케일 최초 번역의 DOM 반영 시간은 별도 보고 |

### 측정 정의

- 측정 시작점은 파일 저장이 끝나고 harness가 그 저장을 관측한 시점이다. 저장 시작 시점을 기준으로 삼지 않는다.
- 종단 간 측정은 하나의 Node monotonic clock으로 한다. 파일 관측부터 브라우저의 DOM commit 확인 응답(ack)까지를 같은 clock으로 잰다. 이 값에는 ack 전달 비용이 들어가므로 그 비용을 함께 표시한다.
- 브라우저 내부의 수신→commit 시간은 별도로 기록한다. 서버 단계와 브라우저 단계를 분리해야 병목이 드러난다.
- 단계별 p95를 더해 종단 간 p95로 쓰지 않는다. 단계 값은 참고로만 병기한다.
- 개발 서버와 브라우저의 `performance.now`는 서로 다른 clock이므로 두 값을 직접 빼지 않는다. 같은 프로세스에서 도는 제어 harness로 한 clock에서 재거나, 동기화 추정 오차를 수치와 함께 명시한다.
- warm은 앱과 변경하지 않은 메시지의 formatter가 준비된 상태를 말한다. 수정된 메시지 자체의 formatter는 warm 조건에 넣지 않는다. 그 메시지는 새 내용이므로 편집 비용에 포함한다.
- 로케일 추가는 두 완료 지점을 구분해 잰다. 첫째는 로케일이 선택 가능한 목록에 나타나는 시점, 둘째는 그 로케일로 전환해 최초 번역이 DOM에 반영되는 시점이다. 파일 수, 총 바이트, namespace 수와 함께 정의해야 비교할 수 있다.
- 수정 반영과 로케일 추가는 p50과 p95를 함께 보고한다.
- 작은 규모에서만 돌린 벤치마크로 일반화하지 않는다. 규모를 나눠 측정한다. 예: 메시지 1k/10k, 로케일 3/20.
- typegen 비용과 cold startup은 수정 반영 수치에서 분리해 별도로 잰다.
- CI에서 광범위한 매트릭스로 비용을 부풀리지 않는다. 필요한 조합만 돌린다.

### 실측 기록 (로컬)

`npm run bench:live`로 측정했다. 결과 요약은 [live-update.json](../benchmarks/results/live-update.json)(최적화 전), [live-update-optimized.json](../benchmarks/results/live-update-optimized.json)(라이브 갱신 최적화 후), [live-update-patch.json](../benchmarks/results/live-update-patch.json)와 [live-update-patch-repeat.json](../benchmarks/results/live-update-patch-repeat.json)(request-scoped patch 적용 후 첫 run·재실행)에 남겼다. 시나리오별 raw sample은 각 파일이 가리키는 `live-update.<case>.samples.json`에 따로 둔다. 방법·조건·재실행 옵션은 [benchmarks/live-update/README.md](../benchmarks/live-update/README.md)에 있다.

조건은 warmup 5회를 뺀 50 샘플, control 왕복 25회다. namespace 1, 렌더 메시지 2(바뀐 키 1 + 바뀌지 않은 키 1), loaded base `ko` + target `en`, `en` 본문 키 1개 수정이다. Chromium headless, React 개발 모드, paint 계측 없음. 환경은 Windows x64, Node v24.18.0, Vite 8.3.2, AMD Ryzen 5 7430U, logical CPU 12, memory 31.3GiB다.

### 최적화 전 (2026-10-06 KST, gitRevision 143215f)

| 시나리오 | 카탈로그 | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | control 왕복 p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 로케일 | 3 파일, 110,292 B | 161.54ms | 191.25ms | 132.68ms | 21.10ms | 10.51ms |
| 10k×20 로케일 | 20 파일, 7,755,280 B | 1180.27ms | 1693.98ms | 722.26ms | 299.90ms | 39.69ms |

최적화 전 두 시나리오 모두 save→DOM ack p95가 목표 p95 ≤ 100ms를 넘었다. 파일 쓰기 p95는 small 9.26ms, large 9.56ms다.

### 최적화 후 (2026-10-06 KST, gitRevision 98a3ced)

| 시나리오 | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | control 왕복 p95 |
| --- | --- | --- | --- | --- | --- |
| 1k×3 로케일 | 98.81ms | 131.27ms | 65.59ms | 25.50ms | 6.21ms |
| 10k×20 로케일 | 472.51ms | 819.55ms | 176.41ms | 260.60ms | 11.53ms |

최적화 후에도 두 시나리오의 save→DOM ack p95가 목표를 넘었다. 파일 쓰기 p95는 small 10.79ms, large 9.35ms, receive→commit p95는 small 21.10→25.50ms, large 299.90→260.60ms다.

| 시나리오 | 최적화 전 p95 | 최적화 후 p95 | 감소 |
| --- | --- | --- | --- |
| 1k×3 로케일 | 191.25ms | 131.27ms | 약 31% |
| 10k×20 로케일 | 1693.98ms | 819.55ms | 약 52% |

전후 값은 같은 fixture와 옵션(warmup 5, 샘플 50, control 25)으로 따로 돌린 단일 run이다. 장비 부하가 run마다 다르므로 감소분 전체를 코드 변경으로 볼 수 없다. control 왕복 p95도 small 10.51→6.21ms, large 39.69→11.53ms로 낮아진 점을 함께 본다. 두 값 모두 일반 보장이 아니다.

단계별 p95를 더해 종단 간 값으로 쓰지 않고, control 왕복도 전체 latency에서 빼거나 더하지 않고 참고로만 병기한다. 서버·브라우저 clock을 서로 빼지 않는다.

### request-scoped patch 적용 후 (2026-10-06 KST, gitRevision 793d94f, 첫 run)

같은 fixture와 옵션(warmup 5, 샘플 50, control 25)으로 돌린 첫 run이다.

| 시나리오 | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | fileWrite p95 | control 왕복 p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 로케일 | 77.58ms | 224.31ms | 199.82ms | 8.50ms | 61.51ms | 10.37ms |
| 10k×20 로케일 | 177.00ms | 229.43ms | 147.25ms | 47.40ms | 10.56ms | 5.68ms |

### request-scoped patch 적용 후 재실행 (2026-10-06 KST, gitRevision 793d94f, repeat)

같은 코드·fixture로 한 번 더 돌린 run이다. 두 run 결과를 나눠 보존했다.

| 시나리오 | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | fileWrite p95 | control 왕복 p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 로케일 | 65.24ms | 76.65ms | 64.99ms | 5.30ms | 8.92ms | 9.34ms |
| 10k×20 로케일 | 191.45ms | 241.18ms | 170.84ms | 48.20ms | 9.71ms | 3.72ms |

- small(1k×3)은 첫 run p95 224.31ms로 최적화 후 131.27ms보다 나빠졌고, 재실행은 76.65ms로 목표 p95 ≤ 100ms 안에 들어왔다. 두 run이 다르므로 small의 안정적 목표 달성을 주장하지 않는다.
- large(10k×20)는 두 run 모두 p95 229.43ms와 241.18ms로 목표를 넘었다. p50은 177.00ms와 191.45ms이고, receive→commit p95는 47.40ms와 48.20ms로 이전 260.60ms에서 크게 줄었다.
- 첫 run의 fileWrite p95 61.51ms와 broadcast p95 199.82ms는 재실행의 8.92ms와 64.99ms보다 컸다. 독립 부하 프로파일 측정이 없어 원인을 단정하지 않고, 관측된 파일 쓰기와 서버 단계 지연만 기록한다.
- 두 run 모두 각 시나리오 50회 편집이 patch 응답이었고 full 응답은 0회였다. upsert는 최대 1개, position 갱신은 0개다. 측정 구간에서는 토큰 길이가 같아 `positionShift`는 warmup에서만 발생했다.
- catalog 응답 크기는 서버가 `client.send`에 넘긴 응답 객체를 캡처해 ack clock을 잡은 뒤 `JSON.stringify` UTF-8 크기로 계산했다. p95는 small 931B, large 936B다. 이 값은 catalog 응답 JSON이고 WS 헤더·압축·manifest 패킷은 포함하지 않으며 실제 물리 네트워크 전체 바이트가 아니다. [live-update-wire-sizes.json](../benchmarks/results/live-update-wire-sizes.json)의 재구성 크기와도 다른 값이다.
- 모든 ack에서 입력 노드 identity·값과 컴포넌트 state가 유지됐고 생성 `.d.ts`는 다시 쓰이지 않았다. 두 run의 4개 case 모두 raw sample 55개(측정 50개)이고 5개 timing metric summary가 nearest-rank 값과 일치했다. 임시 benchmark fixture·profile 폴더와 해당 브라우저 프로세스는 run 뒤 0개였다.

### 원인 프로파일과 최적화

`node --cpu-prof`로 짧은 10 샘플의 large 시나리오를 돌려 startup 뒤 채널 첫 handler 이후 샘플을 검사했다. 반복되는 freeze, `parseCatalog`, WebSocket stringify 비용이 확인됐다. 이 비용을 줄이도록 다음을 적용했다.

- core의 깊은 동결 자기 검증을 WeakSet 조회로 바꿔 이미 동결된 객체를 다시 확인하지 않는다.
- 카탈로그마다 `Intl.Locale` 객체를 하나만 만든다.
- 깊게 동결된 카탈로그의 schema를 WeakMap으로 재사용한다.
- schema fingerprint를 v1의 전체 정규화 문자열에서 87자 고정 길이 v2 digest로 바꾼다.
- `parseCatalog`에 이전 `ParsedCatalog`를 넘겨 문구가 그대로인 메시지의 AST와 인자를 재사용한다.

이후 request-scoped patch 라운드에서 다음을 추가로 적용했다.

- 깊게 동결한 번역 인자 스키마와 기준 메시지의 인자 스키마가 이전 검증 때와 같은 객체이고 ID도 같으면 `validateTranslation` 결과를 재사용하고, mutable 입력이나 계약·키가 바뀌면 다시 검증한다.
- 서버의 pair version 판정은 정렬·stringify 없이 key·source·position을 직접 비교한다.
- 위치가 일괄 이동하면 위치 목록 대신 `positionShift` 하나로 압축한다.

### wire 크기 재구성

manifest frame 크기는 별도 재구성 도구 [manifest-size.mjs](../benchmarks/live-update/manifest-size.mjs)로 비교했다. 기존 v1과 현재 v2의 update envelope JSON을 재구성해 UTF-8 바이트만 비교한 값이고 실제 네트워크 전송 계측이 아니다. 결과는 [live-update-wire-sizes.json](../benchmarks/results/live-update-wire-sizes.json)에 있다. small(1k×3) 162,256 B → 871 B, large(10k×20) 10,980,273 B → 4,373 B이고, fingerprint 문자열은 45,886자 → 87자, 468,886자 → 87자다. 실행은 `node benchmarks/live-update/manifest-size.mjs`다.

### parser 최적화와 프로파일 (2026-10-06)

작업 트리의 uncommitted parser 최적화를 측정했다. 네 run 모두 `gitRevision`은 기준 커밋 4d1f6fc이고, before는 커밋된 그 runtime, context-trial·after·parser는 그 위의 uncommitted 변경을 실행했다. [live-update-profile-after.json](../benchmarks/results/live-update-profile-after.json)와 [live-update-parser.json](../benchmarks/results/live-update-parser.json)는 `codeHashes`로 core·vite `dist` 파일과 harness를 식별하고, 두 파일의 hash가 서로 같아 같은 runtime을 쟀다. before·context-trial은 codeHashes 추가 이전 측정이라 revision과 변경 내용으로 구분한다.

| run | 조건 | 결과 파일 |
| --- | --- | --- |
| before | 원래 HEAD runtime | [live-update-profile-before.json](../benchmarks/results/live-update-profile-before.json) |
| context-trial | diagnostics context spread만 변경 | [live-update-profile-context-trial.json](../benchmarks/results/live-update-profile-context-trial.json) |
| after | 최종 parser, `--cpu-profile` 켬 | [live-update-profile-after.json](../benchmarks/results/live-update-profile-after.json) |
| parser | 최종 parser, profiler 끔, 두 시나리오 | [live-update-parser.json](../benchmarks/results/live-update-parser.json) |

before·context-trial·after는 large(10k×20)만, parser run은 small(1k×3)과 large(10k×20)를 warmup 5, 샘플 50, control 25로 돌렸다. 단계 값은 benchmark 전용 wrapper가 잰 참고값이고 서로 더하거나 종단 간 값으로 환산하지 않는다.

`readAndCandidateMs`에는 경로 검증·파일 읽기·파싱, candidate 정리, base stat, 직렬화된 drain 대기가 함께 들어간다. read와 parse를 분리한 값이 아니므로 이 구간이 크다는 관측만으로 읽기·파싱 비용 구성을 확정하지 않는다.

| 단계 p95 (large) | before | context-trial | after |
| --- | --- | --- | --- |
| readAndCandidateMs | 65.23ms | 129.06ms | 154.00ms |
| validationMs | 25.23ms | 51.42ms | 381.20ms |
| registryReplaceMs | 8.15ms | 18.30ms | 12.40ms |
| catalogDeltaMs | 18.78ms | 28.52ms | 23.54ms |

profiler를 켠 after run에서는 큰 지연이 관측됐다. save→DOM ack p95 1074.94ms(max 4094.26ms), save→manifest broadcast p95 577.88ms, readAndCandidate max 3321.71ms, catalogDelta max 1478.81ms다. 같은 코드에서 profiler를 끈 parser run은 large save→DOM ack p50 181.06ms·p95 200.63ms, readAndCandidate max 60.54ms, catalogDelta max 20.91ms였고, small은 save→DOM ack p50 62.63ms·p95 69.82ms, readAndCandidate max 9.59ms였다. 이 큰 지연이 profiler overhead·OS 스케줄링 지연과 어떻게 얽혔는지는 확정하지 않는다.

parser run(profiler 끔)의 단계 p95와 browser 단계는 다음과 같다. 두 시나리오 모두 patch 응답 50회·full 응답 0회였고, 입력 노드 identity·값과 컴포넌트 state 검사가 유지됐으며 생성 `.d.ts`는 다시 쓰이지 않았다.

| p95 (parser run) | small(1k×3) | large(10k×20) |
| --- | --- | --- |
| readAndCandidateMs | 6.95ms | 56.77ms |
| validationMs | 1.83ms | 26.88ms |
| registryReplaceMs | 0.57ms | 8.08ms |
| catalogDeltaMs | 1.51ms | 19.46ms |
| receive→commit(browser) | 5.50ms | 47.90ms |

`--cpu-profile`은 Node inspector로 측정 구간의 edit loop만 profile한다. startup·calibration·warmup은 제외하고 fixture 준비·HTTP·대기는 포함하며 browser CPU가 아니다. profiler control overhead(`node:inspector:post`)와 OS 스케줄링 지연이 요약에 섞이므로 run 간 profiler 수치를 그대로 비교하거나 sample의 inclusive 값을 더해 총합으로 쓰지 않는다.

- before busy 5802.10ms 중 `parseCatalog` self 1242.92ms(21.42%), `createCatalogPatch` self 609.05ms, `validateTranslation` self 641.37ms, `freeze` self 430.06ms, `readJson` self 323.14ms.
- after busy 14654.57ms 중 `parseCatalog` self 5557.23ms(37.92%), `createCatalogPatch` self 2236.90ms, `validateTranslation` self 2170.70ms, `freeze` self 1141.69ms, `isDeepFrozen` self 589.31ms, `readJson` self 469.60ms.

현재 프로파일에서 `parseCatalog` self가 가장 큰 단일 CPU frame이고 `createCatalogPatch`·`validateTranslation`이 뒤를 잇는다. 절대값은 run마다 다르므로 순위 정도만 본다.

parser 자체 비용은 같은 프로세스에서 baseline 4d1f6fc와 최종 parser를 교차 호출해 따로 비교했다. 같은 길이의 값 1개를 수정하고 `JSON.stringify`·동등성 검사·디스크·watcher·검증·browser는 제외했으며, warmup 50, 측정 100 pair다. 결과는 [parse-compare.json](../benchmarks/results/parse-compare.json)에 있다.

| 항목 | baseline | 최종 parser |
| --- | --- | --- |
| p50 | 29.34ms | 25.45ms |
| p95 | 55.43ms | 55.42ms |

pair별 차이 median은 -3.92ms이고 100 pair 중 85 pair가 개선됐다. p50 기준 약 13.3% 줄었고 p95는 거의 같다. 이 측정이 말하는 범위는 메시지 1만 파일 1개를 수정했을 때의 중앙 파싱 비용 감소이고, 종단 간 전체 지연이나 p95 개선으로 확장하지 않는다.

적용한 parser 변경은 다음과 같다.

- `core/src/catalog.ts`: 재사용 가능한 immutable 메시지에는 diagnostics context spread를 생략하고 진단이 필요한 항목에만 만든다. invalid ID는 진단을 남기고 다음 항목으로 넘어간다.
- `core/src/json.ts`: 최초 strict `JSON.parse`가 이미 decode한 값을 entry에 재사용하고, separator를 sticky regex로 매칭해 suffix slice를 없앴으며, 진단이 없으면 position locator를 만들지 않는다. duplicate decoded key·non-string·malformed strict 검사는 그대로 둔다.

`npm run check`가 exit 0으로 통과했다. core 58·React 9·typegen 5·Vite 68로 총 140개가 한 번에 통과했고, JS/TS 소비 검사와 React TS 검사도 통과했다.

### 남은 병목과 다음 작업

- 현재 프로파일에서 CPU 비용은 `parseCatalog` self가 가장 크고, `readAndCandidateMs` 구간(경로 검증·읽기·파싱·candidate 정리·base stat·drain 대기)도 크게 나온다. read와 parse를 분리한 측정이 없어 어느 쪽이 얼마인지는 나눠 확정하지 않았고, strict JSON 파싱 단독 원인으로도 단정하지 않는다.
- patch 응답 생성(`createCatalogPatch`)과 `validateTranslation`도 CPU에서 큰 몫을 차지한다.
- full 응답에서 namespace 전체 AST를 전송하고 브라우저에서 검증·동결하는 비용이 남는다.
- 파일 이벤트를 묶는 40ms quiet window가 하한으로 남는다.

같은 프로세스 parser 비교로 메시지 1만 파일 1개 수정의 중앙 파싱 비용이 약 13.3% 줄어든 것은 확인했다. 다만 profiler를 켠 after run의 종단 간 p95는 1074.94ms로 크게 나왔고, profiler를 끈 parser run의 small p95 69.82ms·large p95 200.63ms는 단일 run이므로 목표 p95 ≤ 100ms의 안정적 달성을 주장하지 않는다. 큰 지연의 원인도 확정하지 않았다. 운영 pack 소비 검증과 첫 배포 준비는 별도로 남아 있다.

기록한 run에서 문구만 수정한 50회 편집 뒤에도 생성 `.d.ts`의 mtime과 size는 바뀌지 않았고, 모든 ack에서 입력 노드 identity·값과 컴포넌트 state가 유지됐다. 임시 fixture 디렉터리와 browser profile은 run 뒤 남지 않았고 추가 브라우저 프로세스도 종료됐다. 로케일 추가·삭제와 paint, 번들 크기는 아직 측정하지 않았다.

## 인수 사례

초기 구현이 만족해야 할 핵심 사례다. 아직 통과를 주장하지 않는다.

2026-10-05 로컬 구현은 8단계까지 진행했다. 코어 33개, Vite 어댑터 28개, React 어댑터 5개, typegen 5개 테스트와 JS/TS 소비 타입 검사, React 데모 TS 검사가 통과했다. vanilla와 React production 빌드가 통과했다. 개발 브라우저에서 한국어·영어 파일 저장 후 문구 갱신, 입력값·포커스·커서·스크롤·열린 모달 유지, 잘못된 JSON의 마지막 정상 상태 유지와 수정 후 복구를 확인했다. vanilla에서 일본어 로케일·namespace 추가, 임시 파일 교체 저장, 현재 로케일 삭제 후 기준 언어 전환도 실제 watcher로 확인했다. React StrictMode에서 controlled input과 수량·모달 상태 보존, JSON 오류 복구와 언어 전환을 확인했다. 새 기준 키 추가로 `.d.ts`가 갱신되는 동안에도 React 상태가 유지되고, 문구만 수정하면 선언 파일의 수정 시간이 바뀌지 않는 것을 확인했다. typegen 검사는 초기 readiness, snapshot 우선 게시, generation 취소·최신 결과 수렴, 동일 내용의 쓰기 생략, 실패 후 선언 유지·재시도, 생성 파일 watch 제외와 생성된 타입의 TS/checkJs 소비를 확인한다. 성능 측정·부분 전송·SSR은 미완료다.

9단계의 eager handshake를 추가했다. Vite 어댑터 38개 테스트로 초기 연결, 요청 범위 echo, 중복·과거 응답, revision gap, 새 세션, 재연결 generation 무효화, 여러 store의 요청 분리, 제한된 재시도와 timer 정리를 검증했다. 전체 81개 테스트와 소비 타입 검사가 통과했다. React 개발 브라우저에서 문구 저장 후 입력·포커스·열린 모달 유지, 서버 중단·재기동 후 페이지 새로고침과 최신 카탈로그 복구를 확인했다. 부분 전송·pair별 version은 10단계에서 연결한다.

10a의 지연 로딩 코어를 추가했다. `createI18n`의 교차 의도 완료, 실제 언어 선택 대체, missing 폴백, 실패·timeout, pair별 version과 세션 검증, tombstone 유지, manifest 추가·삭제, dispose와 subscriber 오류를 16개 테스트로 검증했다. 전체 check와 JS/checkJs·TS 소비 검사, `npm run demo:lazy`가 통과했다. 코어 49개, React 5개, typegen 5개, Vite 38개로 총 97개 테스트가 통과했다. Vite 범용 loader·부분 전송과 React lazy 데모는 10b에서 연결한다.

10b의 Vite 범용 조회·부분 전송과 React 연결을 완료했다. 코어 49개, Vite 49개, React 6개, typegen 5개로 총 109개 테스트, 전체 check·JS/TS 소비 검사와 두 production 데모 빌드가 통과했다. 실제 브라우저 WebSocket에서 영어 선택의 `en/demo` 단독 조회, loaded pair 수정, 신규 namespace의 명시 로드 전 AST 미전송·로드 시 base+target 두 pair 조회를 확인했다. 폼 입력·포커스·모달 유지, JSON 오류 복구, 부팅 뒤 로케일 추가·선택, namespace 삭제와 현재 로케일 삭제 후 기준 언어 전환도 확인했다. 이 시점 운영 fallback은 전체 bundle이었고 정적 chunk loader는 11단계로 남아 있었다.

11단계의 운영 정적 로더를 구현하고 실제 결과로 검증했다. `virtual:saylo/lazy`가 전체 metadata manifest와 base+initial locale의 initialNamespaces pair만 inline으로 싣고, 나머지 present pair는 generated virtual module의 literal `import()` loader entry로 분리한다. `createStaticCatalogSource(initialManifest, initialCatalogs, entries)`가 on-demand import·cache·dedupe를 처리하고, 실패나 session·version·fingerprint/key 불일치는 캐시에 반영하지 않으며 missing tombstone은 import 없이 반환한다. dev source와 eager `virtual:saylo`는 기존과 같다. 새 테스트 4개가 실제 Vite production build의 분리된 dynamic chunk 3개, emitted module 실행(locale+namespace fallback), fresh invalid disk build 실패, 정적 source dedupe·cache·retry·missing을 확인하고 기존 lazy test는 fallback에서 chunk 계약 검사로 교체했다. `npm run check`가 통과했고 core 49·Vite 53·React 6·typegen 5로 총 113개, JS/TS 소비 검사와 두 데모 production build가 통과했다. React 운영 브라우저 CDP에서 초기 요청은 HTML·main JS·CSS뿐이었고 영어 선택 시 demo dynamic chunk 하나만 요청됐으며 한국어/영어 재전환에는 추가 요청이 없었다. 폼 입력·포커스와 열린 모달·모달 입력이 유지됐고 WebSocket 연결과 console error/warn은 0이었다. 성능 수치·parser elimination·SSR은 미완료다.

12단계의 SSR serializer와 hydration을 구현하고 로컬 검증을 진행했다. `createBootSnapshot`·`serializeBootSnapshot`·`decodeBootSnapshot`을 공개했고, boot wire는 parsed catalog의 sourceName·locale·AST·인자를 배열로 싣는다. 직렬화는 모든 `<`를 `\u003c`로, U+2028·U+2029를 escape한다. loaded base+target pair의 present/missing outcome을 빠짐없이 명시하고 누락·중복 outcome과 stamp·schema 불일치는 `INVALID_BOOT`로 거부하며, boot timeZone은 config와 일치해야 한다. `createServerI18n`은 async scope를 준비해 `getServerSnapshot`이 생성 시점 snapshot이 되는 문제를 피하고, `createHydrationAdapter`는 boot S1을 유지하면서 이후 snapshot을 최신 하나로 buffer해 `finishHydration()`에서 한 번 publish한다. SSR fixture는 `examples/ssr/{app,entry-server,client,config,server,demo}.mjs`로 추가했고, `npm run demo:ssr`가 ko/en 동시 요청 renderToString과 boot locale 검사를 수행한 뒤 종료하며 `npm run dev:ssr`는 127.0.0.1:5190/?locale=en에서 실제 서버·client hydrateRoot(StrictMode)·live connectDev를 확인한다. 이미 실행한 검사는 core의 html-safe roundtrip·timeZone·metadata 거부·요청 간 격리, React의 renderToString+hydrateRoot boot S1 `t` 고정·S2/S3 buffer 1회 적용·DOM·입력·포커스·state 보존, Vite SSR의 개발 watcher 다음 요청 최신 문구와 production SSR bundle 동적 import·요청별 ko/en 분리다. 전체 `npm run check`, JS/TS 소비 검사와 두 production 데모 빌드가 통과했다. core 53·React 9·Vite 55·typegen 5로 총 122개 테스트가 통과했다. 실제 SSR 브라우저에서 영어 첫 화면의 hydration과 클릭·입력 동작, 파일 수정 뒤 입력·수량 상태 유지, 다음 서버 응답의 최신 문구 반영을 확인했고 콘솔 경고·오류는 없었다. 카탈로그 요청의 초기 generation이 서버 검증을 만족하도록 수정하고 lazy fixture에도 실제 서버 검증기를 연결했다. 패키지 공개 배포는 미완료다.

라이브 갱신 최적화 라운드를 진행했다. `node --cpu-prof`로 병목을 확인하고 core 동결·schema·fingerprint·이전 AST 재사용을 손봤다. `npm run check`의 126개 테스트와 추가 Vite 통합 테스트 1개가 통과했다(core 57, Vite 56, React 9, typegen 5, 합 127). JS/TS 소비 검사와 vanilla·React production 빌드도 통과했다. 같은 fixture로 벤치마크를 다시 돌려 전후 값을 [live-update-optimized.json](../benchmarks/results/live-update-optimized.json)에 남겼고, raw sample summary가 nearest-rank 집계와 일치했다. 두 시나리오 모두 입력 상태가 유지되고 문구만 수정했을 때 `.d.ts`의 mtime과 size가 바뀌지 않았다. 성능 수치는 결과 파일 기준이며, 패키지 공개 배포는 미완료다.

13단계의 request-scoped message patch를 구현했다. pair 응답이 직전 baseline과 맞으면 바뀐 메시지 delta가 되고, 아니면 full로 돌아간다. 서버는 pair마다 직전 present version 하나만 보관하고, 클라이언트는 요청마다 immutable baseline을 고정한다. `validateTranslation`은 깊게 동결한 번역·기준 인자 스키마가 이전 검증 때와 같은 객체이고 ID도 같으면 결과를 재사용하고, 서버 version 판정은 정렬·stringify를 없앴다. core 58·React 9·typegen 5·Vite 68로 총 140개 테스트가 통과했다. 전체 스위트는 140개 중 139개가 한 번에 통과했고, typegen background Windows rename EPERM으로 실패한 1개는 그 테스트만 단독 재실행해 통과했다. JS/TS 소비 검사와 React TS 검사도 따로 통과했다. 거부된 delta가 부분 mutation을 남기지 않는지, messageCount와 위치 유효성 검사, 클라이언트의 full 재요청을 테스트로 확인했다. 두 production 데모 빌드가 통과했다. 같은 fixture로 첫 run과 재실행 두 번 측정해 각각 [live-update-patch.json](../benchmarks/results/live-update-patch.json)와 [live-update-patch-repeat.json](../benchmarks/results/live-update-patch-repeat.json)에 보존했다. 운영 pack 소비 검증과 첫 배포 준비는 아직 미완료다.

| # | 사례 | 확인 내용 |
| --- | --- | --- |
| 1 | 상태 보존 | 문구 수정 후 입력값·모달·스크롤 위치가 유지된다 |
| 2 | 추가·수정·삭제 | 키 추가, 값 수정, 키 삭제가 각각 수렴한다 |
| 3 | 파싱 복구 | 깨진 JSON/ICU를 넣어도 마지막 정상값이 유지되고 진단이 나온다 |
| 4 | 재연결·갭 | 새 세션·revision gap에서 full snapshot으로 복구하고, 중복·오래된 patch는 discard한다. Vite 재시작 후 DOM 보존은 요구하지 않는다 |
| 5 | 비동기 타입 schema | baseline schema 변경 시 quarantine과 fallback이 동작한다. 키 삭제·필수 인자 추가 후 기존 호출 오류는 진단하며 DOM 보존을 요구하지 않는다 |
| 6 | 포맷 일치 | 변수, number/date/time, plural/select가 같은 Intl locale data·런타임에서 dev/prod 동일 출력을 낸다(고정 timeZone, 고정 시각 입력) |
| 7 | SSR 동시성 | 요청 간 로케일·카탈로그가 섞이지 않는다 |
| 8 | JS/TS 소비 | JS 프로젝트와 TS 프로젝트에서 모두 설치·소비가 된다(스모크) |
| 9 | union t 타입 | union 키는 먼저 좁혀야 하고, 잘못된 인자와 인자 누락이 거부된다 |
| 10 | checkJs 소비 | JSDoc typed JS에서 같은 인자 오류를 잡는다 |
| 11 | 신규 namespace 로더 | 부팅 뒤 추가된 namespace를 범용 `loadCatalog`가 로드한다 |
| 12 | locales 전체 목록 | `availableLocales`가 매번 전체 목록으로 교체된다 |
| 13 | desired generation 교차 완료 | `setLocale`와 `loadNamespace`가 교차 완료해도 최신 desired state로 수렴한다 |
| 14 | snapshot-bound hydration | hydration 동안 t가 S1을 읽고, S2는 barrier 뒤 한 번만 적용된다 |
| 15 | JS 런타임 인자 검증 | JS에서도 base required arg 검증이 `InvalidArgumentError`로 동작한다 |

날짜·시간을 다루는 검사는 timeZone을 고정하고 고정 시각 입력을 쓴다. 런타임에서 현재 시각(`Date.now`/`currentTime`)을 호출하지 않는다. 네이티브 ICU 지원은 OS·브라우저마다 다르므로 parity는 같은 Intl 데이터·런타임 매트릭스 아래에서만 의미가 있다.

## 빌드 순서

순서는 typegen(generate) → tsc(consumer 타입 체크) → build(Vite)다. Vite build 자체는 consumer TS 타입 체크를 하지 않으므로 tsc를 build 앞에 둔다. 별도 package/version 설정 파일 구현은 이번 범위 밖이다.

## 검증 방식

- 문서와 구현을 함께 갱신한다. 공개 타입 선언과 소비 fixture 검사, 실제 production build·정적 loader 검증을 수행하고, Markdown 링크·JSON 예제·코드 블록·파일 크기도 확인한다. 현재 구현의 결과는 이 문서의 단계별 검증 기록에 남긴다. 문서 설계 리뷰는 [리뷰 반영 기록](../review/feedback-resolution.ko.md)을 참고한다.
- 실행하지 않은 검사는 pass가 아니다. 문서 링크 확인도 항목별로 남긴다.
- 검증하지 않은 항목은 미검증으로 유지한다. 성능은 로컬 실측 기록과 목표를 구분해 적는다.

## 로드맵

작은 커밋 단위로 나눠 순차 진행한다. 각 단계는 그 자체로 쓸 수 있는 데모를 남기는 것을 목표로 한다. 처음에는 작은 fixture를 eager로 실어 상태 보존을 보여주고, 이후 같은 API 아래에서 전송을 세분화한다. 현재 13단계 request-scoped patch까지 로컬 구현을 진행했다.

| 순서 | 커밋의 한 가지 책임 | 완료 기준 |
| --- | --- | --- |
| 1 | 계약 수정과 타입 fixture | union 키 반례를 막고, snapshot·locale 목록·fallback 의미를 확정한다 |
| 2 | JSON/ICU 파싱과 baseline schema 추출 | 중복 ID·문법 오류·인자 호환성을 작은 fixture로 판정한다 |
| 3 | AST 포맷과 순수 snapshot 조회 | 고정 locale·timeZone에서 t와 fallback이 동작한다 |
| 4 | immutable store와 vanilla 폼 데모 | eager snapshot 교체만으로 텍스트가 바뀌고 입력 DOM은 유지된다 |
| 5 | Vite change 연결 | 관리 카탈로그 수정이 앱 모듈 교체 없이 데모에 반영된다. 첫 핵심 데모다 |
| 6 | add/unlink와 listener 정리 | locale·namespace 추가, atomic save, 해제 후 재연결을 처리한다 |
| 7 | React typed context와 snapshot-bound hook | 타입을 유지하면서 같은 상태 보존 데모가 React에서 동작한다 |
| 8 | baseline typegen | 초기 readiness, 배경 생성, generation 취소, 내용이 바뀔 때만 `.d.ts` 쓰기를 구현한다 |
| 9 | 세션·snapshot handshake와 resync | 범위가 있는 snapshot 요청, 중복·gap·늦은 응답을 처리한다 |
| 10a | 지연 로딩 코어와 전환 조정 | desired locale·namespace 준비 상태, missing·failure·stale 결과를 처리한다. 로컬 구현 완료 |
| 10b | Vite 범용 로더와 부분 전송 | boot 이후 새 namespace 조회, pair별 version·tombstone, loaded scope 갱신과 React 데모를 연결한다. 로컬 구현 완료 |
| 11 | fresh production build | 현재 디스크 검증 → typegen → consumer 검사 → AST·정적 loader 산출을 연결한다. 로컬 구현 완료 |
| 12 | SSR serializer와 hydration fixture | 요청별 snapshot, boot escape, hydration 직전 갱신을 검증한다. 로컬 구현 완료 |
| 13 | 변경 메시지별 patch 전송 | 바뀐 메시지만 보내고 상태 보존·수렴을 유지한다. wire 크기와 브라우저 검증·동결 비용이 줄어든다. 로컬 구현 완료 |

1–8단계에서는 작은 fixture를 eager로 실어도 된다. 9–10단계에서 부분 전송과 미로드 상태가 들어올 때 카탈로그별 버전 계약을 적용한다.
