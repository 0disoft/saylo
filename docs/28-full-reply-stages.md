# 28. 기본 prebundle에서 full 응답 준비와 수신 이후 계측

[27번 일반 설정 재측정](27-shared-freeze-locale-add.md)에 이어 full 응답 준비와 수신 이벤트 이후 구간을 나눠 계측했다. 대규모 50회 모두 수신 이후→DOM 시간이 수신 전보다 컸다. 수신 이후 p50/p95는 143.10/557.80ms로 다음 계측 대상이다. 제품 source·dist는 바꾸지 않았다.

## 구현과 경계

- `--reply-stages`는 locale-add에만 붙는다. `--browser-stages`는 거부해 정상 prebundling을 유지한다.
- Node registerHooks가 `packages/vite/dist/index.js`의 `requestCatalog`를 import 전에 메모리에서 감싼다. `registry.loadDelta`와 `encodeCatalogResult`를 분리해 재고, 요청 검증·반환 동작과 cleanup의 콜백 참조는 유지한다.
- 채널은 원래 `client.send` 호출을 잰다. Vite의 JSON.stringify와 WebSocket `socket.send`의 enqueue 비용을 포함하며 전송 완료 시간은 측정하지 않는다. 제품 파일에 계측을 저장하지 않는다.
- 브라우저 가상 헬퍼는 제품 코드를 변형하지 않고 optimizer도 설정하지 않는다. hot listener는 createI18n/connectDev/소스 연결 전에 등록한다. 타임스탬프는 Vite WS JSON.parse **이후**, 동기 Saylo 처리 **이전**이며 cleanup에서 제거한다.
- 샘플은 선택 이후 en-GB/bench만 노린다. boot/list/reset/removal은 제외하고, 누락/중복/재시도 full 요청은 실패로 본다.
- `--reply-stages`가 없으면 replyStages를 내보내지 않고 listener/서버 변형도 설치하지 않는다.

Node 지표:

- selectionToRequestMs: 제어에서 "선택 요청 수신" → 대상 요청 핸들러 시작(HTTP 제어 반환/브라우저 스케줄링/요청 전달 포함).
- lookupMs: `registry.loadDelta`가 메모리의 기존 승인 카탈로그를 조회해 outcome을 만드는 호출이다. 파일 읽기·파싱은 포함하지 않는다.
- encodeMs: compact 스키마 시그니처/AST 튜플 생성.
- requestToSendMs: 핸들러 시작 → send 래퍼 시작(lookup/encode/검사/구성). 중첩 값이다.
- sendMs: JSON 직렬화와 socket enqueue 호출.
- handlerMs: full 요청 콜백 전체. handlerOtherMs: 샘플당 handler에서 lookup/encode/send를 뺀 나머지.
- 모든 동기 wall 값은 일시정지/프로브 오버헤드를 포함하며 순수 CPU가 아니다.

브라우저 지표:

- selectToReceiveMs: setLocale 이전 → hot listener. listener가 Vite JSON.parse 이후라, 수신 전 서버/전송/수신 전처리 구간이지 순수 네트워크가 아니다.
- receiveToCommitMs: listener → useLayoutEffect가 프로브 DOM/선택 확정. Saylo 디코딩/검사/freezing/코어 수락/스냅샷/번역기/React 커밋이 들어간다.
- 두 값이 선택 총합을 나눈다. 프로세스 시계/제어/GC를 빼지 않고 중첩 p95를 더하지 않는다.

## 실행

```sh
node benchmarks/live-update/run.mjs --mode locale-add --reply-stages --scenario 10k-20-locales --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/locale-add-reply-stages.json
```

- 2026-10-07 KST, 리비전 9ce720d(JSON 전체값 `9ce720d0e7b4cc553464c3712d140de2cf9dc1ed`), 작업 트리 하네스 해시는 JSON에 기록.
- 기본 prebundle/typegen ON, CPU/브라우저/서버 파일 프로파일링 OFF.
- Node 24.18.0, Windows, Ryzen 5 7430U, Vite 8.3.2, React 19.3.0, HeadlessChrome 154. raw 55 → 50 measured + 5 warmup, control 25, nearest-rank p95 = 정렬 48번째.
- 시나리오: 10k 메시지 × 20 로케일/파일, 초기 카탈로그 JSON 7,755,280 B, namespace bench 1, 라운드마다 새 en-GB JSON 387,783 B.
- 기존 앱/포매터는 warm, 새 카탈로그/프로브 포매터는 첫 사용. 입력 DOM node/value, React state, `.d.ts` mtime/size 유지, reload 없음, reset/en/removal 포함.

## 결과

시간의 단위는 ms이다. requestToSend는 handler 내부에 포함되고, handlerOther는 표본별 잔여를 먼저 계산한 뒤 요약한다.

| 구간 | p50 | p95 |
| --- | --- | --- |
| Node selectionToRequest | 1.71 | 3.33 |
| Node lookup | 0.04 | 0.08 |
| Node encode | 28.16 | 54.82 |
| Node requestToSend(중첩) | 28.27 | 55.08 |
| Node send | 15.28 | 26.71 |
| Node handler | 44.07 | 85.92 |
| Node handlerOther | 0.08 | 0.14 |
| Browser selectToReceive | 58.50 | 104.20 |
| Browser receiveToCommit | 143.10 | 557.80 |
| Browser selection total | 209.90 | 641.00 |
| list(saveToListAck) | 159.05 | 474.73 |
| control round trip | 2.87 | 4.87 |

- raw 카운트: handler/lookup/encode/send 각 1, receipt 1, reply-before-selection 0, compact 이후 full 1.
- 직렬화 JSON 프레임 p95 1,241,401 B. 실제 네트워크 바이트가 아니다.
- post-receipt > pre-receipt 50/50, Node encode > send 50/50.
- 목록 표시 250ms 이내는 44/50회였지만 p95는 474.73ms로 목표 미달이다. 로케일 첫 선택 시간에는 이 목록 목표를 적용하지 않는다.
- 최악 선택(10k-20-locales #50): 총 1,079.30 ms, 수신 전 50.10, 수신 후 1,029.20, Node handler 38.81 ms(별도 시계).
- 긴 샘플은 유지하고 GC 관측은 없다. 미계측 실행 대비 인과적 개선은 주장하지 않는다.
- Node의 lookup·encode·send 중 encode가 매회 send보다 컸다. 전체 선택에서 수신 이후 구간이 더 커 다음은 client 내부 경계를 나눈다. 이 값만으로 동결·React·GC 가운데 어느 항목이 원인인지 확정하지 않는다.

## 검증

- 테스트 10개 통과: reply 5 + 기존 browser 5.
- 유효·잘못된 요청의 핸들러 동작, 제외·중복·누락 요청, requestId/generation 일치, 유한 시간·호출 수·중첩 경계를 검증했다. dist 형태가 바뀌면 계측이 실패하고, browser product transform·optimizer 설정 변경이 없는 것도 확인했다.
- 실제 소형 reply 스모크 2 measured + 1 warmup, 기존 full browser stages 1, edit/patch stages 1, disabled locale 1.
- 메인 50개와 스모크 모두 count/raw 요약/residual/wire/hash 재확인.
- 제품 테스트/typecheck/build/release/pack은 변경 없는 제품 입력에 대해 재사용, 재실행 없음.
- 임시 fixture·profile과 benchmark browser가 남지 않았음을 확인했다. 문서의 로컬 링크·코드 블록·40KB 이하 크기와 `git diff --check`도 확인했다.
- bump/push/publish/deploy 없음.
- 산출물: [locale-add-reply-stages.json](../benchmarks/results/locale-add-reply-stages.json), [samples](../benchmarks/results/locale-add-reply-stages.10k-20-locales.samples.json), [smoke](../benchmarks/results/locale-add-reply-stages-smoke.json), [full browser regression](../benchmarks/results/reply-stages-full-browser-regression-smoke.json), [edit regression](../benchmarks/results/reply-stages-edit-regression-smoke.json), [disabled](../benchmarks/results/reply-stages-disabled-smoke.json).
- 제품 해시는 이전 locale-add-shared-freeze.json과 일치.

## 다음 작업

다음은 기본 prebundle 상태의 client 수신 이후 계측이다. 먼저 같은 core 모듈의 깊은 동결 신뢰가 prebundle 그래프에서도 공유되는지 확인한다. 이어 디코딩·검증·동결·core 수락·snapshot과 React 구간을 나눈다. 계측을 위해 prebundle을 끄면 실행 조건이 달라지므로 같은 설정을 유지한다. 이번 작업에서는 후속 제품 최적화를 적용하지 않았다.
