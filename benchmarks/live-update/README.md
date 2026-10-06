# 라이브 갱신 벤치마크

개발 중 카탈로그 문구를 수정했을 때 화면에 반영되기까지의 latency를 잰다. 대상은 실제 Vite watcher와 실제 브라우저 DOM commit이다.

## 실행

저장소 루트에서 실행한다. workspace를 먼저 build한 뒤 Node harness가 돈다.

```sh
npm run bench:live
```

설치된 Chrome 또는 Edge를 headless로 쓰고 임시 user-data 프로필을 따로 만든다. 추가 npm 의존성은 없다. 브라우저를 찾지 못하면 `--browser <executable>`로 실행 파일을 지정한다.

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `--scenario` | `all` | `1k-3-locales`, `10k-20-locales`, `all` 중 하나 |
| `--samples` | `50` | 시나리오별 측정 샘플 수 |
| `--warmup` | `5` | 측정에서 제외하고 버리는 warmup 수 |
| `--calibrations` | `25` | control 왕복 측정 횟수 |
| `--browser` | 자동 탐색 | Chrome/Edge 실행 파일 경로 |
| `--out` | `benchmarks/results/live-update.json` | 결과 JSON 경로 |
| `--no-typegen` | 꺼짐 | typegen을 끄고 실행 |
| `--cpu-profile` | 꺼짐 | `node:inspector`로 측정 구간 edit loop의 CPU profile을 켜고 결과에 `cpuProfile`을 넣는다 |
| `--browser-stages` | 꺼짐 | benchmark 전용 Vite transform으로 브라우저 patch·freeze·snapshot·translator·signature 시간을 따로 잰다 |
| `--timeout-ms` | `30000` | 단계별 대기 timeout |

## 픽스처와 측정

- `1k-3-locales`는 로케일당 메시지 1,000개 × 로케일 3개, `10k-20-locales`는 로케일당 10,000개 × 20개다. namespace는 1개다.
- 앱은 loaded base `ko` + target `en`을 싣고 `en`의 `bench` namespace에서 바뀐 키 1개와 바뀌지 않은 키 1개를 렌더한다. 매 저장마다 `en` 본문 키 1개만 수정한다.
- warm은 변경하지 않은 메시지의 formatter가 준비된 상태다. 수정된 메시지의 formatter 비용은 편집 비용에 포함한다.
- 종단 간 값은 하나의 Node `performance.now` clock으로 잰다. `writeFile` 완료 시점부터 브라우저가 DOM commit 뒤 보낸 HTTP ack body를 받은 시점까지다. 서버가 manifest를 broadcast한 시점과 브라우저가 카탈로그를 받아 commit한 시점은 별도 단계로 기록한다.
- 서버 단계는 manifest의 `ws.send` 호출 직전까지다. 브라우저 단계는 Vite가 JSON을 decode한 뒤 `saylo:catalog` 콜백을 호출한 시점부터 `useLayoutEffect`의 DOM 확인까지다. 문자열화·전송·Vite JSON decode 비용은 종단 간 값에는 포함되지만 두 단계 값에는 포함되지 않는다.
- ack 전달 비용은 종단 간 값에 포함한다. 단계별 p95를 더하거나 서버·브라우저 clock을 서로 빼서 종단 간 값을 만들지 않는다.
- no-op control 왕복도 따로 기록하며 전체 latency에서 빼지 않는다.
- 통계는 정렬 후 nearest-rank `ceil(n * p) - 1`이다.
- 문구만 수정한 편집 뒤에도 생성 `.d.ts`의 mtime과 size가 그대로인지 확인한다. 기본값에서 typegen은 켜져 있고 초기 `generated.d.ts`를 만든다.
- 서버가 `client.send`에 넘긴 catalog 응답 객체를 캡처해 ack clock을 잡은 뒤 `JSON.stringify` UTF-8 크기로 `wire.catalogReplyBytes`를 계산한다. ack 뒤에 계산하므로 latency에 넣지 않는다. 이 값은 catalog 응답 JSON이고 WS 헤더·압축·manifest 패킷은 포함하지 않으며 실제 물리 네트워크 전체 바이트가 아니다. `wire.patchReplies`·`wire.fullReplies`는 응답 종류이고, `wire.maxChangedMessages`는 patch의 upsert 수(전체 응답이면 메시지 수), `wire.maxPositionUpdates`는 positionShift면 `messageCount - upsert` 수 아니면 positions 수다.
- 실행이 끝나면 임시 fixture·프로필을 지우고 브라우저 프로세스와 그 자식, Vite를 함께 종료한다.

## 서버 단계 계측

`profile.mjs`는 benchmark 전용 prototype wrapper다. 라이브러리에 clock이나 profiling API가 없으므로, run 중 `LiveRegistry.prototype`의 `enqueue`·`drain`·`prepareTranslations`·`validate`와 `CatalogRegistry.prototype`의 `replace`·`loadDelta`를 임시로 감싸 stage 시간을 모으고 끝나면 원래 메서드로 되돌린다. 결과의 `serverStages`가 이 값이다.

- `queueToDrainMs`는 첫 파일 이벤트부터 drain 직전까지다. quiet window를 포함한다.
- `readAndCandidateMs`는 drain 호출부터 `prepareTranslations` 진입까지로, 경로 검증·파일 읽기·파싱, candidate 정리, base stat, 직렬화된 drain 대기를 함께 담는다. read와 parse를 따로 뗀 값이 아니다.
- `translationPreparationMs`는 `LiveRegistry.prepareTranslations`의 schema 조회·번역 검증·격리 준비 시간이다. 정상 문구 수정에서는 실제로 부적합 번역을 격리하지 않으므로 격리 오류 처리 성능을 측정하는 값이 아니다.
- `validationMs`는 준비 뒤 active catalog의 최종 `LiveRegistry.validate`, `registryReplaceMs`는 `CatalogRegistry.replace`, `catalogDeltaMs`는 `CatalogRegistry.loadDelta` 시간이다.
- 격리 구현 전 결과의 `readAndCandidateMs`는 `validate` 진입까지였고 `translationPreparationMs`는 없었다. 그 당시 번역 검증은 `validationMs`에 들어갔다. 새 구간 수치와 과거 구간 수치를 직접 비교하지 않는다. save→DOM ack의 clock·구간 정의는 그대로다.
- stage p95는 서로 더하거나 종단 간 값으로 환산하지 않는다.

## 브라우저 구간 계측

`--browser-stages`는 `browser-profile.mjs`의 Vite transform으로 client 모듈의 `applyCatalogPatch`, `freezeCatalogs`, `createLoadedSnapshot`, `createBoundTranslator`와 signature 생성식을 감싼다. 라이브러리 source·dist는 수정하지 않는다. `browser-probe.mjs`는 편집 직전부터 DOM commit까지 각 함수의 동기 시간을 합산하고 호출 수를 기록한다. sample마다 모든 구간이 관측되어야 하며, 변환된 모듈 4개를 확인한다. startup·초기 boot·control 왕복은 구간 집계에서 제외한다.

snapshot 시간 안에는 translator와 signature가 포함된다. 중첩 값이나 구간별 p95를 더하지 않는다. receive→commit에는 함수 밖의 비동기 조정·React commit도 들어간다. 이 계측은 browser CPU profiler가 아니며 clock 호출 비용을 포함한다.

변환이 Vite 의존성 prebundle 안에 숨지 않도록 이 옵션에서는 Saylo core·React adapter·Vite client의 prebundle을 끈다. React·ReactDOM은 계속 prebundle한다. 따라서 기존 옵션 없는 run과 직접 전후 비교하지 않고, **같은 옵션의 before·after**를 비교한다. 일반 개발 설정에서의 종단 간 변화는 옵션 없는 run으로 따로 확인한다.

```sh
node benchmarks/live-update/run.mjs --browser-stages --out benchmarks/results/live-update-browser-before.json
```

기준 측정은 [../results/live-update-browser-before.json](../results/live-update-browser-before.json), immutable signature 재사용 후 같은 옵션의 측정은 [../results/live-update-browser-after.json](../results/live-update-browser-after.json)에 있다. prebundle을 사용하는 일반 설정의 최적화 후 결과는 [../results/live-update-signature.json](../results/live-update-signature.json)이고 `node benchmarks/live-update/run.mjs --out benchmarks/results/live-update-signature.json`로 실행했다. 각 run은 warmup 5·측정 50·control 25, CPU profiler 끔 조건이다. 실행 시점의 부하가 다르므로 종단 간 감소 전체를 signature 변경 효과로 보지 않는다.

## CPU 프로파일

`--cpu-profile`을 주면 `node:inspector` Session으로 측정 구간의 edit loop만 profile해 결과에 `cpuProfile`을 넣는다. startup·calibration·warmup은 제외하고 fixture 준비·HTTP·대기는 포함하며 browser CPU가 아니다. `topSelf`는 self 시간, `sayloInclusive`는 `packages/core|vite|typegen/dist` frame의 inclusive 시간이다.

요약에는 profiler control overhead(`node:inspector:post`)와 OS 스케줄링 지연이 섞이고, 같은 코드라도 run마다 절대값이 달라진다. run 간 profiler 수치를 그대로 비교하지 않는다. `inclusiveMs`는 중첩 frame에서 겹쳐 합산되므로 더해서 총합으로 쓰지 않는다.

## 파서 비용 비교

`parse-compare.mjs`는 한 프로세스에서 baseline parser와 현재 parser를 교차 호출해 파서 자체 비용만 비교한다. baseline의 `packages/core/src`를 git에서 임시 디렉터리로 꺼내 `tsc`로 compile하므로 현재 `packages/core/dist` build가 있어야 한다. 같은 길이의 값 1개를 수정한 뒤 두 parser를 번갈아 호출하고 `JSON.stringify`·동등성 검사·디스크·watcher·검증·browser는 측정에서 뺀다. 끝나면 임시 디렉터리를 지운다.

```sh
node benchmarks/live-update/parse-compare.mjs 4d1f6fc benchmarks/results/parse-compare.json
```

첫 인자는 baseline revision, 둘째는 결과 경로다. 결과는 warmup 뒤 pair별 `beforeMs`·`afterMs`·`afterMinusBeforeMs`, `before`·`after` 요약, `pairedDifference`, `currentCodeHashes`를 담는다.

## 결과

결과는 기본 경로 [../results/live-update.json](../results/live-update.json)에 남고 `--out`으로 경로를 바꿀 수 있다. 최적화 후 재측정은 [../results/live-update-optimized.json](../results/live-update-optimized.json)에 있다. request-scoped patch 적용 후 첫 run과 같은 코드·fixture 재실행은 [../results/live-update-patch.json](../results/live-update-patch.json)와 [../results/live-update-patch-repeat.json](../results/live-update-patch-repeat.json)에 있다. 두 run 결과를 모두 보존한다. patch 결과의 `gitRevision` 793d94f는 측정 대상 core·Vite 코드 변경을 가리키고, patch wire 관측 계측기(app.jsx·channel.mjs·run.mjs)와 raw 결과는 별도 measurement 커밋에 함께 들어간다. 각 파일은 환경(Node·OS·CPU·memory·Vite·React·브라우저 UA), git revision, UTC `measuredAt`, 시나리오 차원과 파일 바이트, 시나리오별 summary와 control 왕복 raw 값을 담는다. 시나리오별 raw sample(기본값은 warmup 포함 55개)은 결과 파일이 `samplesFile`로 가리키는 `live-update.<case>.samples.json`에 따로 둔다.

parser 최적화 측정은 [../results/live-update-profile-before.json](../results/live-update-profile-before.json), [../results/live-update-profile-context-trial.json](../results/live-update-profile-context-trial.json), [../results/live-update-profile-after.json](../results/live-update-profile-after.json)(profiler 켬)와 [../results/live-update-parser.json](../results/live-update-parser.json)(profiler 끔, 두 시나리오)에 있다. 파서 자체 비교는 [../results/parse-compare.json](../results/parse-compare.json)에 있다.

격리 구현 후 현재 코드의 재측정은 [../results/live-update-quarantine.json](../results/live-update-quarantine.json)에 있다. `npm run bench:live -- --out benchmarks/results/live-update-quarantine.json`로 두 시나리오를 기본 옵션(warmup 5·측정 50·control 25, CPU profiler 끔)으로 실행했다. 새 서버 구간 경계는 위 계측 정의를 따른다. 정상 문구만 수정했으므로 실제 격리·복원 처리 지연은 측정하지 않았다.

결과 파일은 `codeHashes`로 측정에 관련된 선택 파일을 식별한다. `measuredFiles`의 core·vite·typegen `dist`와 `profile.mjs`·`channel.mjs`·`run.mjs`의 sha256을 담는다. 격리 구현 후 재측정부터 `translation-quarantine.js`·`app.jsx`·fixture·통계 함수·lockfile과 `workingTreeStatus`도 기록한다. 최적화 trial은 대개 같은 `gitRevision` 위의 uncommitted 변경이라 revision만으로 어느 runtime을 쟀는지 구분되지 않는다. `codeHashes`가 그 구분을 남기고, [../results/live-update-profile-after.json](../results/live-update-profile-after.json)과 [../results/live-update-parser.json](../results/live-update-parser.json)은 hash가 같아 같은 runtime이다. `codeHashes`가 없는 이전 결과는 `gitRevision`과 변경 내용으로 구분한다.

## wire 크기 재구성

manifest frame 크기는 [manifest-size.mjs](manifest-size.mjs)로 비교한다. 기존 v1과 현재 v2의 update envelope JSON을 재구성해 UTF-8 바이트만 재는 값이며 실제 네트워크 계측이 아니다. 이 재구성 값은 run에서 캡처한 `wire.catalogReplyBytes`와 다른 값이다. 결과는 [../results/live-update-wire-sizes.json](../results/live-update-wire-sizes.json)에 남는다. small(1k×3) 162,256 B → 871 B, large(10k×20) 10,980,273 B → 4,373 B이고, fingerprint 문자열은 45,886자 → 87자, 468,886자 → 87자다. 실행은 `node benchmarks/live-update/manifest-size.mjs`다.

## 한계

- 수치는 warm 상태의 로컬 단일 실행이 만든 headless Chromium/Edge 개발 모드 값이다. 일반 보장이 아니며 장비·부하에 따라 달라진다.
- 기록된 run 대부분에서 두 시나리오의 save→DOM ack p95가 목표 p95 ≤ 100ms를 넘었다. 최적화 전 small(1k×3) p95 191.25ms, large(10k×20) p95 1693.98ms이고, 최적화 후에는 131.27ms와 819.55ms로 둘 다 목표를 넘었다. request-scoped patch 적용 후 첫 run은 small 224.31ms·large 229.43ms, 재실행은 small 76.65ms·large 241.18ms다. profiler를 끈 parser run은 small 69.82ms·large 200.63ms였다. small이 목표 안에 들어온 run이 있지만 같은 코드의 run마다 값이 다르므로 안정적 달성을 주장하지 않고, large는 기록된 run 모두 목표를 넘는다.
- 전후 값은 같은 fixture와 옵션(warmup 5, 샘플 50, control 25)으로 따로 돌린 단일 run이다. control 왕복 p95도 small 10.51ms→6.21ms, large 39.69ms→11.53ms로 낮아졌으므로 감소분 전체를 코드 변경으로 볼 수 없고 일반 보장도 아니다.
- request-scoped patch 첫 run은 재실행보다 fileWrite p95(61.51ms 대 8.92ms)와 서버 broadcast p95(199.82ms 대 64.99ms)가 컸다. 독립 부하 프로파일 측정이 없어 원인을 단정하지 않는다.
- CPU profiler를 켠 run은 overhead와 OS 스케줄링 지연이 섞이고 큰 지연이 낄 수 있다. [../results/live-update-profile-after.json](../results/live-update-profile-after.json)의 save→DOM ack p95 1074.94ms는 profiler를 끈 같은 코드의 [../results/live-update-parser.json](../results/live-update-parser.json)(large p95 200.63ms)과 다르며, 큰 지연의 원인을 단정하지 않는다.
- `serverStages`의 `readAndCandidateMs`는 읽기와 파싱이 합쳐진 값이다. 두 비용을 나눠 확정하지 않는다.
- `parse-compare.json`은 메시지 1만 파일 1개 수정의 파서 비용만 비교한다. 종단 간 지연이나 p95 개선으로 확장하지 않는다.
- startup은 Vite 서버 boot와 브라우저 boot를 따로 잰다. paint timing은 계측하지 않는다.
- 로케일 추가·삭제 latency, paint, 가상화 비교, 다른 라이브러리 비교, 번들 크기 측정은 이번 범위가 아니다.
