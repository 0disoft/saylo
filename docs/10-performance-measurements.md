# 10. 성능 측정 기록

성능 목표와 측정 정의는 [06-validation-and-roadmap.md](06-validation-and-roadmap.md)를 따른다. 아래에는 기존 로컬 벤치마크의 조건·결과·한계를 보존한다.

## 실측 기록 (로컬)

`npm run bench:live`로 측정했다. 결과 요약은 [live-update.json](../benchmarks/results/live-update.json)(최적화 전), [live-update-optimized.json](../benchmarks/results/live-update-optimized.json)(라이브 갱신 최적화 후), [live-update-patch.json](../benchmarks/results/live-update-patch.json)와 [live-update-patch-repeat.json](../benchmarks/results/live-update-patch-repeat.json)(request-scoped patch 적용 후 첫 run·재실행)에 남겼다. 시나리오별 raw sample은 각 파일이 가리키는 `live-update.<case>.samples.json`에 따로 둔다. 방법·조건·재실행 옵션은 [benchmarks/live-update/README.md](../benchmarks/live-update/README.md)에 있다.

조건은 warmup 5회를 뺀 50 샘플, control 왕복 25회다. namespace 1, 렌더 메시지 2(바뀐 키 1 + 바뀌지 않은 키 1), loaded base `ko` + target `en`, `en` 본문 키 1개 수정이다. Chromium headless, React 개발 모드, paint 계측 없음. 환경은 Windows x64, Node v24.18.0, Vite 8.3.2, AMD Ryzen 5 7430U, logical CPU 12, memory 31.3GiB다.

## 최적화 전 (2026-10-06 KST, gitRevision 143215f)

| 시나리오 | 카탈로그 | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | control 왕복 p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 로케일 | 3 파일, 110,292 B | 161.54ms | 191.25ms | 132.68ms | 21.10ms | 10.51ms |
| 10k×20 로케일 | 20 파일, 7,755,280 B | 1180.27ms | 1693.98ms | 722.26ms | 299.90ms | 39.69ms |

최적화 전 두 시나리오 모두 save→DOM ack p95가 목표 p95 ≤ 100ms를 넘었다. 파일 쓰기 p95는 small 9.26ms, large 9.56ms다.

## 최적화 후 (2026-10-06 KST, gitRevision 98a3ced)

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

## request-scoped patch 적용 후 (2026-10-06 KST, gitRevision 793d94f, 첫 run)

같은 fixture와 옵션(warmup 5, 샘플 50, control 25)으로 돌린 첫 run이다.

| 시나리오 | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | fileWrite p95 | control 왕복 p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 로케일 | 77.58ms | 224.31ms | 199.82ms | 8.50ms | 61.51ms | 10.37ms |
| 10k×20 로케일 | 177.00ms | 229.43ms | 147.25ms | 47.40ms | 10.56ms | 5.68ms |

## request-scoped patch 적용 후 재실행 (2026-10-06 KST, gitRevision 793d94f, repeat)

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

## 원인 프로파일과 최적화

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

## wire 크기 재구성

manifest frame 크기는 별도 재구성 도구 [manifest-size.mjs](../benchmarks/live-update/manifest-size.mjs)로 비교했다. 기존 v1과 현재 v2의 update envelope JSON을 재구성해 UTF-8 바이트만 비교한 값이고 실제 네트워크 전송 계측이 아니다. 결과는 [live-update-wire-sizes.json](../benchmarks/results/live-update-wire-sizes.json)에 있다. small(1k×3) 162,256 B → 871 B, large(10k×20) 10,980,273 B → 4,373 B이고, fingerprint 문자열은 45,886자 → 87자, 468,886자 → 87자다. 실행은 `node benchmarks/live-update/manifest-size.mjs`다.

## parser 최적화와 프로파일 (2026-10-06)

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

## 남은 병목과 다음 작업

- 현재 프로파일에서 CPU 비용은 `parseCatalog` self가 가장 크고, `readAndCandidateMs` 구간(경로 검증·읽기·파싱·candidate 정리·base stat·drain 대기)도 크게 나온다. read와 parse를 분리한 측정이 없어 어느 쪽이 얼마인지는 나눠 확정하지 않았고, strict JSON 파싱 단독 원인으로도 단정하지 않는다.
- patch 응답 생성(`createCatalogPatch`)과 `validateTranslation`도 CPU에서 큰 몫을 차지한다.
- full 응답에서 namespace 전체 AST를 전송하고 브라우저에서 검증·동결하는 비용이 남는다.
- 파일 이벤트를 묶는 40ms quiet window가 하한으로 남는다.

같은 프로세스 parser 비교로 메시지 1만 파일 1개 수정의 중앙 파싱 비용이 약 13.3% 줄어든 것은 확인했다. 다만 profiler를 켠 after run의 종단 간 p95는 1074.94ms로 크게 나왔고, profiler를 끈 parser run의 small p95 69.82ms·large p95 200.63ms는 단일 run이므로 목표 p95 ≤ 100ms의 안정적 달성을 주장하지 않는다. 큰 지연의 원인도 확정하지 않았다. 운영 pack 소비 검증은 `npm run verify:pack`으로 완료했고, 첫 배포 준비는 별도로 남아 있다.

기록한 run에서 문구만 수정한 50회 편집 뒤에도 생성 `.d.ts`의 mtime과 size는 바뀌지 않았고, 모든 ack에서 입력 노드 identity·값과 컴포넌트 state가 유지됐다. 임시 fixture 디렉터리와 browser profile은 run 뒤 남지 않았고 추가 브라우저 프로세스도 종료됐다. 로케일 추가·삭제와 paint는 아직 측정하지 않았고, 이 라이브 갱신 run에서는 번들 크기를 재지 않았다. parser 런타임 제거 fixture의 unminified JS 청크 합(168,462→117,385 B)은 [06-validation-and-roadmap.md](06-validation-and-roadmap.md)에 있고, 실제 데모의 minify·gzip 측정은 다음 기록으로 구분한다.

## 실제 데모의 운영 JS 번들 (2026-10-07 KST)

`npm run build` 후 `node benchmarks/bundle-size/run.mjs`로 vanilla와 React 데모를 각각 `astRuntime:false`/`true`로 빌드했다. 원본 결과는 [demo-bundle-size.json](../benchmarks/results/demo-bundle-size.json), 재실행과 크기 정의는 [benchmarks/bundle-size/README.md](../benchmarks/bundle-size/README.md)에 있다. 환경은 Windows x64, Node v24.18.0, Vite 8.3.2, React 19.3.0이다. 기준 revision은 46ee8d7이고, 그 위의 config factory·측정 스크립트 변경은 결과의 `workingTreeStatus`·`codeHashes`로 구분한다.

기존 config를 재사용해 기본 minify를 적용하고 `write:false`로 메모리에서 결과를 받았다. vanilla는 eager `virtual:saylo`, React는 `virtual:saylo/lazy`와 `initialNamespaces:['demo']`를 쓴다. 두 앱 모두 한국어(`ko`)로 시작하고 같은 ko·en 번역 파일(namespace demo)을 쓴다. 초기 JS는 HTML 진입 청크와 재귀적인 정적 JS import 합이고, 지연 JS는 그 밖의 emitted JS 청크 합이다. 원본은 minify된 JS의 UTF-8 바이트, gzip은 청크마다 level 9로 압축한 크기의 합이며 단위는 B다.

| 앱 | astRuntime | 초기 JS 원본 | 초기 JS gzip | 지연 JS 원본 | 지연 JS gzip |
| --- | --- | --- | --- | --- | --- |
| vanilla eager | false | 63,263 | 19,656 | 0 | 0 |
| vanilla eager | true | 37,664 | 12,796 | 0 | 0 |
| React lazy | false | 298,571 | 92,241 | 3,774 | 958 |
| React lazy | true | 272,950 | 85,139 | 3,774 | 957 |

같은 앱의 초기 JS를 비교하면 vanilla는 원본 25,599 B·gzip 6,860 B(34.9%) 감소, React는 원본 25,621 B·gzip 7,102 B(7.7%) 감소다. React의 en/demo 동적 import 청크는 두 빌드에서 모두 유지됐고 원본 크기는 3,774 B로 같았다. 모든 빌드에서 초기 JS는 1청크였고, vanilla는 지연 청크 0개, React는 1개였다. parser 오류 표식 `EXPECT_ARGUMENT_CLOSING_BRACE`는 각 앱의 false 초기 JS에 존재하고 true에서는 모든 JS에서 사라졌다. 측정 입력과 React 생성 타입의 hash도 빌드 전후 같았다.

React 수치에는 React·ReactDOM·데모 UI가 포함되므로 위 합계를 Saylo 단독 런타임 크기로 쓰거나 vanilla 합계와 단순 비교하지 않는다. HTML·CSS·source map·HTTP 헤더·Brotli·SSR·로드 시간은 제외했다. 빌드별 session UUID가 무작위여서 gzip과 output hash는 재실행 때 조금 달라질 수 있고, 지연 청크의 1 B 차이를 최적화 효과로 보지 않는다. 이 결과는 실제 저장소 데모의 한 번 측정이며 일반 앱·다른 데이터 규모·다른 bundler로 확대하지 않는다. parser 제거는 로컬 구현으로, 게시된 `0.1.0-alpha.1`에는 없다. 라이브 갱신 지연 목표와 Paraglide 비교는 별도 측정으로 남아 있다.

## 격리 구현 후 라이브 반영 재측정 (2026-10-07 KST)

`npm run bench:live -- --out benchmarks/results/live-update-quarantine.json`로 현재 runtime을 빌드한 뒤 측정했다. 기준 revision은 58999f2이고, 그 위의 benchmark `profile.mjs`·`run.mjs` 변경은 결과의 `workingTreeStatus`·`codeHashes`로 식별한다. 라이브러리 코드는 이 측정에서 바꾸지 않았다. 원본 결과는 [live-update-quarantine.json](../benchmarks/results/live-update-quarantine.json), raw sample은 그 파일이 가리키는 시나리오별 `.samples.json`에 있다.

기존 parser run과 같은 warmup 5회·측정 50회·control 25회, CPU profiler 끔 조건이다. namespace 1개, loaded ko+en, 바뀐 메시지 1개·바뀌지 않은 메시지 1개를 렌더하고 en의 probe 키 1개만 수정한다. 환경은 Windows x64, Node v24.18.0, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, AMD Ryzen 5 7430U, logical CPU 12, memory 31.3GiB다. 정상 문구 수정이므로 격리·복원의 오류 경로, 로케일 추가·삭제, paint는 이 run에서 재지 않았다.

| 시나리오 | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | fileWrite p95 | control 왕복 p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1k×3 로케일 | 63.02ms | 72.26ms | 60.57ms | 5.60ms | 8.96ms | 5.09ms |
| 10k×20 로케일 | 176.48ms | 209.23ms | 142.61ms | 47.20ms | 10.44ms | 6.68ms |

직전 profiler 없는 parser run의 p95는 small 69.82ms·large 200.63ms였고 이번에는 각각 2.45ms·8.60ms 높았다. p50은 small 62.63→63.02ms, large 181.06→176.48ms다. control 왕복 p95는 small 5.23→5.09ms, large 5.34→6.68ms이고 두 결과는 별도 시점의 단일 run이다. 이 차이를 격리 구현으로 인한 회귀나 개선으로 단정하지 않는다. small은 이번 run에서 100ms 목표 안에 들었고 large는 여전히 넘었다.

이번 계측은 `prepareTranslations` 진입에서 읽기·candidate 구간을 끝내고 번역 준비를 따로 잰다. 과거에는 `validate` 진입에서 끝났다. 격리 구현 뒤 번역 검증의 대부분은 준비 과정으로 옮겨졌으므로 과거 `validationMs`와 이번 최종 검증 시간을 직접 비교하지 않는다. save→DOM ack의 clock과 구간 정의는 그대로다.

| 서버 구간 p95 | small(1k×3) | large(10k×20) |
| --- | --- | --- |
| queueToDrainMs(quiet window 포함) | 53.37ms | 54.12ms |
| readAndCandidateMs(prepareTranslations 진입까지) | 9.29ms | 64.39ms |
| translationPreparationMs(schema 조회·번역 검증·격리 준비) | 2.29ms | 25.75ms |
| validationMs(최종 active catalog 검증) | 0.01ms | 0.03ms |
| registryReplaceMs | 0.64ms | 8.11ms |
| catalogDeltaMs | 1.88ms | 20.35ms |

각 sample에서 file event와 drain은 1회였다. 두 시나리오 모두 patch 50회·full 0회, 최대 changed message 1개·position 갱신 0개였고, catalog 응답 JSON p95는 small 930 B·large 936 B였다. warmup은 위 집계에서 제외했다. 이 바이트는 서버가 `client.send`에 넘긴 catalog 응답 객체의 JSON이며 manifest·WS 헤더·압축은 포함하지 않는다. 모든 ack에서 입력 노드 identity·값과 컴포넌트 state가 유지됐고 생성 `.d.ts`의 mtime·size는 바뀌지 않았다. 두 raw 파일은 각각 55개(측정 50개)이며 5개 timing metric·6개 서버 구간·control 요약과 기록된 code hash를 확인했다. 종료 후 임시 fixture·browser profile 디렉터리와 해당 브라우저 프로세스는 남지 않았다.

다음 최적화 후보는 브라우저의 patch 적용·snapshot 생성에서 전체 메시지를 반복 처리하는 부분이다. `catalog-patch.ts`는 메시지 하나가 바뀌어도 전체 메시지 맵을 복사하고 개수를 센다. `loading-registry.ts`의 `createLoadedSnapshot`은 loaded catalog 전체 키를 정렬하고 source를 직렬화해 signature를 만든다. 실제 브라우저 receive→commit p95는 large 47.20ms지만, 이 run에서는 patch 적용·freeze·검증·signature·React commit을 각각 나누지 않았으므로 어느 코드가 얼마를 차지하는지는 아직 확정하지 않는다. 다음 작은 작업은 이 비용을 분리해 확인하고, 변하지 않은 immutable catalog의 정렬·직렬화 재사용을 검토하는 것이다. no-op 갱신의 snapshot 동일성, schema 변경, full resync 동작은 유지한다.

서버 readAndCandidate p95 64.39ms도 남아 있지만 읽기와 파싱은 아직 합쳐진 값이다. 서버 quiet window는 40ms 설정이고 이번 queue p95는 약 54ms였다. 이 구간들을 더해 종단 간 p95로 쓰거나 control 왕복을 빼지 않는다. 로케일 추가 지연과 Paraglide 동일 조건 비교는 후속이며, 현재 수치로 대규모 목표 달성이나 다른 라이브러리 대비 우위를 주장하지 않는다.

## 브라우저 구간 기준 측정 (2026-10-07 KST)

`node benchmarks/live-update/run.mjs --browser-stages --out benchmarks/results/live-update-browser-before.json`로 warmup 5·측정 50·control 25, CPU profiler 끔 조건을 실행했다. 결과는 [live-update-browser-before.json](../benchmarks/results/live-update-browser-before.json)과 시나리오별 raw sample에 있다. 기준 revision은 3d4fa5b이며 그 위의 계측기 변경은 `workingTreeStatus`·`codeHashes`로 식별한다. runtime은 격리 구현 후 재측정과 같고, 환경·fixture도 동일하다.

benchmark 전용 Vite transform이 브라우저 함수의 동기 시간을 감싼다. 라이브러리 source·dist는 변경하지 않았다. 변환을 적용하기 위해 Saylo 패키지의 dependency prebundle을 끄고 React·ReactDOM은 유지했다. 따라서 이전 prebundle 사용 run의 수치와 직접 전후 비교하지 않는다. clock 호출 overhead도 들어가며 CPU profiler가 아니다. 방법은 [benchmarks/live-update/README.md](../benchmarks/live-update/README.md)를 따른다.

| 브라우저 구간 p95 | small(1k×3) | large(10k×20) |
| --- | --- | --- |
| patch 적용 | 1.40ms | 11.60ms |
| Vite catalog freeze | 0.60ms | 7.70ms |
| snapshot 생성 | 3.10ms | 28.60ms |
| translator 생성(snapshot 안) | 1.80ms | 13.90ms |
| signature 생성(snapshot 안) | 1.30ms | 16.90ms |
| receive→commit | 6.70ms | 56.00ms |
| save→DOM ack | 78.89ms | 257.51ms |

signature와 translator는 snapshot 시간에 포함된다. 위 구간별 p95를 더하지 않는다. 두 시나리오에서 각 구간은 편집마다 1회였고, 측정 50회 모두 patch 1개 메시지·position 갱신 0개였다. 입력 노드·값과 컴포넌트 state가 유지됐으며 타입 파일은 다시 쓰이지 않았다. 첫 최적화 대상은 signature 생성이다. 바뀌지 않은 깊게 동결한 카탈로그의 정렬·직렬화를 재사용하되, signature 문자열의 의미와 no-op snapshot 동일성은 유지하는 작은 변경으로 진행한다.

## Immutable catalog signature 재사용 후 (2026-10-07 KST)

`core/src/snapshot-signature.ts`로 signature 생성을 분리했다. core의 깊은 동결 검사로 확인한 카탈로그만 WeakMap에 canonical JSON fragment를 보관하고, 변하지 않은 카탈로그는 키 정렬·source 배열 생성·직렬화를 반복하지 않는다. scope 메타와 fragment를 결합한 문자열은 기존 전체 `JSON.stringify` 결과와 같게 유지한다. 새 translation catalog는 다시 계산하고 mutable·shallow-frozen 입력은 캐시하지 않는다. 캐시는 카탈로그 객체 생존 동안 직렬화 문자열을 추가로 보관하므로 메모리 비용은 있다. 공개 API·pair version·snapshot의 content 기반 no-op 판정은 변경하지 않았다.

최적화 후 `--browser-stages`를 유지해 [live-update-browser-after.json](../benchmarks/results/live-update-browser-after.json)에 기록했고, 계측을 끄고 Saylo prebundle을 쓰는 일반 설정은 [live-update-signature.json](../benchmarks/results/live-update-signature.json)에 따로 기록했다. 두 run 모두 기준 revision은 9d2ac96이며 그 위의 변경은 `workingTreeStatus`·`codeHashes`로 식별한다. `snapshot-signature.js`도 hash에 추가했다. 환경·fixture·warmup 5·측정 50·control 25·CPU profiler 끔 조건은 동일하다.

| 브라우저 구간 p95 | small 전 | small 후 | large 전 | large 후 |
| --- | --- | --- | --- | --- |
| patch 적용 | 1.40ms | 0.80ms | 11.60ms | 8.10ms |
| Vite catalog freeze | 0.60ms | 0.50ms | 7.70ms | 5.40ms |
| snapshot 생성 | 3.10ms | 2.00ms | 28.60ms | 16.00ms |
| translator 생성(snapshot 안) | 1.80ms | 1.40ms | 13.90ms | 11.10ms |
| signature 생성(snapshot 안) | 1.30ms | 0.60ms | 16.90ms | 6.20ms |
| receive→commit | 6.70ms | 5.00ms | 56.00ms | 36.70ms |
| save→DOM ack | 78.89ms | 73.51ms | 257.51ms | 186.03ms |

signature 생성 p95는 large에서 약 63.3% 낮게 관측됐다. 하지만 변경하지 않은 patch·freeze·translator 구간도 낮아졌고, control 왕복 p95도 small 7.61→4.23ms·large 11.48→4.52ms로 낮아졌다. 별도 시점의 단일 run들이므로 종단 간 감소 전체나 구간 변화 전체를 signature 변경으로 귀속하지 않는다. signature 재사용 자체는 변하지 않은 trusted catalog의 key enumeration이 두 번째 호출에서 발생하지 않는 테스트로 별도 확인했다. snapshot 안의 중첩 구간과 p95를 더하지 않는다.

일반 개발 설정의 결과는 다음과 같다. 직전 일반 설정의 격리 후 run(small p95 72.26ms·large 209.23ms)과 비교할 수 있으나 역시 별도 시점의 단일 run이다.

| 시나리오 | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | control 왕복 p95 |
| --- | --- | --- | --- | --- | --- |
| 1k×3 로케일 | 61.50ms | 68.00ms | 60.55ms | 4.80ms | 4.27ms |
| 10k×20 로케일 | 145.40ms | 185.87ms | 124.49ms | 37.90ms | 5.48ms |

최적화 후 두 run의 4개 case 모두 측정 50회가 patch 응답이며 full 0회, 최대 changed message 1개·position 갱신 0개였다. 입력 노드·값과 컴포넌트 state가 유지됐고 `.d.ts`는 다시 쓰이지 않았다. raw sample(각 55개)과 timing·서버·브라우저·control 요약, 기록된 code hash를 대조했다. 임시 fixture·browser profile과 해당 브라우저 프로세스는 모두 정리됐다.

core build와 관련 테스트 44개(core snapshot signature·lazy loading·SSR boot 24개, Vite lazy·patch 20개)가 통과했다. canonical 문자열 호환성, 빈 scope·이스케이프·prototype 같은 literal ID, immutable 캐시 재사용·mutable 입력 비캐시, 같은 문구의 새 pair version에서 snapshot 동일성, schema·문구 변경 시 정상 게시와 이전 translator 유지, malformed patch의 full 재요청·resync를 확인했다. 전체 release check·pack·재게시·푸시는 이번 범위에서 실행하지 않았다.

대규모 목표 p95 ≤ 100ms는 여전히 미달이다. 일반 run의 서버 readAndCandidate p95는 55.92ms로 읽기·파싱을 포함하며 다음 분리 계측 대상이다. 비동기 읽기와 drain 대기도 섞여 있으므로 CPU 비용으로 환산하지 않는다. 브라우저에서는 patch 전체 맵 복사, translator 검증 순회, 변경된 카탈로그의 signature 계산도 남는다. 로케일 추가 지연·paint·Paraglide 비교도 아직 측정하지 않았다.

## 서버 파일 읽기·파싱 분리 계측 (2026-10-07 KST)

`node benchmarks/live-update/run.mjs --server-file-stages --out benchmarks/results/live-update-server-files.json`로 두 시나리오를 측정했다. 결과는 [live-update-server-files.json](../benchmarks/results/live-update-server-files.json)과 시나리오별 raw sample에 있다. 기준 revision은 f863e58이고, 그 위의 benchmark-only 계측기 변경은 `workingTreeStatus`·`codeHashes`에 기록했다. 제품 runtime hash는 직전 signature run과 같고 라이브러리 source·dist는 수정하지 않았다.

기존과 같은 warmup 5·측정 50·control 25, 정상 en 문구 1개 수정·loaded ko+en·namespace 1 조건이다. CPU profiler와 브라우저 상세 계측은 끄고 기존 Saylo dependency prebundle을 유지했다. 환경은 Windows x64, Node v24.18.0, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U, memory 31.3GiB다. 시작 때 Node module hook을 등록해 실제 `typegen/dist/catalog-files.js`의 `readCatalogFile`만 메모리에서 변환하고 끝나면 hook을 해제한다. source·dist 파일이나 제품 공개 API에는 계측기를 넣지 않았다.

| candidate 내부 구간 p95 | small(1k×3) | large(10k×20) |
| --- | --- | --- |
| 경로 검사(assertInside) | 1.17ms | 0.84ms |
| UTF-8 파일 읽기(read) | 0.90ms | 1.43ms |
| 카탈로그 파싱(parseCatalog 호출·인자 구성) | 4.60ms | 46.82ms |
| 나머지 candidate 처리(sample별 residual) | 0.87ms | 3.32ms |
| readAndCandidate 전체 | 6.65ms | 49.40ms |

경로 검사와 읽기는 비동기 wall time이다. 파싱은 JSON 처리·ICU·이전 메시지 재사용·위치 계산·동결을 포함한 동기 호출 elapsed time이고 CPU profiler 값은 아니다. residual은 각 원시 sample에서 전체 candidate 시간에서 세 구간의 시간을 뺀 뒤 집계한다. 이 표의 p95들을 더하거나 서로 빼서 단계·전체 시간을 만들지 않는다. clock·Promise wrapper overhead와 OS 스케줄링 영향이 들어간다.

이번 warm 정상 편집에서 large read p95는 1.43ms, parse p95는 46.82ms였다. 따라서 다음 최적화 대상은 파일 읽기 교체가 아니라 파서 내부의 JSON 처리·위치 계산·메시지 순회다. `catalog.ts`는 문구가 같은 메시지의 ICU AST를 이미 재사용하지만, `readJson`의 전체 token 스캔·decoded key 처리, 위치 계산, messages 맵 구성은 매 저장마다 수행한다. 이 run에서는 파서 내부 세부 구간을 나누지 않았으므로 JSON 스캔 하나가 단독 원인이라고 단정하지 않는다. 다음 작은 작업은 이 내부 비용을 나눠 확인하고 재사용 가능한 부분을 줄이는 것으로 잡는다. strict JSON, decoded 중복 ID, 오류 위치, 길이가 달라지는 문구·추가/삭제 키의 처리 계약은 유지한다.

| 시나리오 | save→DOM ack p50 | save→DOM ack p95 | save→manifest broadcast p95 | receive→commit p95 | control 왕복 p95 |
| --- | --- | --- | --- | --- | --- |
| 1k×3 로케일 | 62.95ms | 71.85ms | 62.32ms | 4.80ms | 10.26ms |
| 10k×20 로케일 | 151.45ms | 180.93ms | 125.13ms | 40.10ms | 7.18ms |

직전 계측 없는 일반 run의 p95는 68.00ms·185.87ms였다. 이번에는 runtime이 같고 계측·실행 시점만 달라졌으므로 이 차이를 성능 개선이나 회귀로 보지 않는다. 대규모 100ms 목표는 여전히 미달이다. cold disk, 로케일 추가·삭제, 부적합 번역 격리·복원, 여러 파일 동시 저장은 이번 측정 대상이 아니다.

두 시나리오 raw sample은 각각 55개(측정 50개)이며, 모든 sample에서 경로 검사·읽기·파싱이 각각 1회였다. 원시 residual 합과 candidate 전체, 5개 종단 timing·6개 서버·4개 파일 구간·control nearest-rank 요약, 기록된 code hash를 확인했다. 측정 50회 모두 patch 1개 메시지·position 갱신 0개였고 full 응답은 0회였다. 모든 ack에서 입력 노드·값과 컴포넌트 state가 유지됐으며 타입 파일은 다시 쓰이지 않았다. 임시 fixture·browser profile과 해당 브라우저 프로세스는 남지 않았다. 라이브러리 구현을 바꾸지 않아 기존 제품 테스트는 반복하지 않았다.

파서 내부 구간과 후속 최적화는 [11-parser-measurements.md](11-parser-measurements.md)로 분리했다. key 디코딩 trial은 tail latency 개선 근거가 없어 되돌렸고, 최종 변경은 LF 위치 색인을 `indexOf`로 생성하는 것이다. 최종 같은 서버 파일 계측 설정의 p95는 small 72.66ms·large 165.94ms이며 대규모 목표는 여전히 미달이다. 단일 run의 부하 차이와 parser-only 수치를 분리해 해석한다.
