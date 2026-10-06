# 16. compact 개발 카탈로그 전송

lazy 개발 경로의 전체 present 카탈로그 응답을 `status: "compact"`, `encoding: "saylo-catalog-v1"` compact 인코딩으로 바꿨다. 개발 소켓에서만 쓰는 전송이며 공개 API의 카탈로그 형식은 그대로다. wire 계약의 단일 출처는 [08-update-protocol.md](08-update-protocol.md)이고, 이 문서는 구현 형태와 검증 기록을 담는다.

## 범위

- 바뀐 것은 lazy `saylo:catalog`의 full present 응답 하나다. missing·failed·request-scoped patch는 기존 형식이고, eager snapshot, 초기 boot, production chunk loader, SSR boot wire도 그대로다.
- 서버는 `registry.loadDelta` 결과가 present일 때만 인코딩한다. 세션·pair version·schema stamp 검사와 클라이언트의 `immutable`·`matches` 적용 경로는 바꾸지 않는다.
- 실제 타입은 `packages/vite/src/catalog-wire.ts`이고, 인코딩은 `index.ts`의 catalog 요청 응답, 디코딩은 `catalog-source.ts`의 응답 처리에 연결한다.
- 이 변경은 로컬 checkout에만 있고 npm `0.1.0-alpha.1`에는 포함되지 않는다.

## 인코딩

envelope는 sessionId·key·catalogVersion·namespaceSchemaFingerprint를 매 응답 현재값으로 실어 보낸다. catalog payload는 `{ sourceName, schemas, messages }`다.

- messages 항목은 `[id, source, offset, line, column, ast, schemaIndex]`다.
- literal·argument 노드는 위치가 없으면 `[type, value]`, 있으면 `[type, value, startOffset, startLine, startColumn, endOffset, endLine, endColumn]`로 쓴다.
- number·date·time·skeleton·plural·select·selectordinal·중첩처럼 복잡한 ICU 노드는 기존 AST 형태를 그대로 싣는다. 클라이언트가 ICU를 다시 파싱하지 않는다.
- 같은 arguments JSON을 쓰는 메시지는 catalog.schemas의 한 항목을 schemaIndex로 공유한다.
- catalog는 불변 객체이므로 변하지 않는 동안 WeakMap에 payload를 캐시한다. session·pair version·schema stamp는 캐시하지 않고 매 응답 현재값을 쓴다.

## 디코딩과 적용

클라이언트는 decode 뒤 결과를 기존 immutable 처리와 manifest `matches` 검사에 넘긴다. core가 받는 값은 인코딩 전과 같은 present outcome이다.

- encoding 이름, envelope stamp, message tuple 길이, node tuple, 위치 정수 범위, schemaIndex 범위, 중복 ID를 검사한다. 어긋나면 `Invalid compact catalog reply.`로 거부한다.
- 거부된 full 응답은 해당 요청을 실패시키고 이전 정상 UI를 유지한다. 이후 별도의 새 요청으로 회복할 수 있다. 기존 timeout 안의 full 재요청은 깨진 patch에만 적용한다.
- patch 재요청 조건은 기존 request-scoped patch에만 적용한다. compact full 자체는 깨졌을 때 patch 재요청으로 흐르지 않는다.

## 검증

로케일 추가 측정은 다음 명령으로 실행했다. Node 24.18.0·Windows x64·Vite 8.3.2·React 19.3.0·HeadlessChrome 154에서 실행했으며, [원시 12회 sample](../benchmarks/results/locale-add-compact-server-files.10k-20-locales.samples.json) 중 warmup 2회를 요약에서 제외한다.

```sh
node benchmarks/live-update/run.mjs --mode locale-add --server-file-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-compact-server-files.json
```

- Vite 77개 테스트 통과(이전 72 + 새 codec 4 + 통합 1). codec 테스트는 round-trip, schema 공유와 stamp 최신성, malformed 거부, 단순 fixture 크기 절반 미만을 확인한다. 통합 1개는 깨진 compact full이 UI를 바꾸지 않고 후속 요청으로 회복하는지 확인한다.
- `npm run build --workspace=@0disoft/saylo-vite`와 `npm run typecheck:consumers --workspace=@0disoft/saylo-vite` 통과. 실제 Vite production build·SSR 검증은 이 77개 테스트에 포함한다. Vite 패키지의 npm pack dry-run에서 새 내부 `dist/catalog-wire.js`·`.d.ts`가 포함됨을 확인했다. 외부 소비자의 실제 tarball 설치와 npm 게시는 실행하지 않았다.
- 실제 브라우저 로케일 추가 10회(warmup 2·control 10, [locale-add-compact-server-files.json](../benchmarks/results/locale-add-compact-server-files.json)과 그 sample)에서 선택 전 target 응답 0개, 선택 후 fresh full 1개(총 10회)를 확인했다. full 응답 JSON p95는 1,241,402 B로 같은 조건의 이전 [15](15-simple-message-parser.md) run 4,421,174 B보다 약 71.92% 작았고 입력 JSON p95는 387,783 B다. 선택 준비→첫 번역 ack p50 280.21ms·p95 400.42ms(이전 p95 471.79ms), 브라우저 선택→commit p50 276.80ms·p95 384.90ms, 저장→목록 p50 513.70ms·p95 1,128.04ms(이전 p95 514.47ms), 카탈로그 파싱 p95 788.80ms(이전 331.29ms), control 왕복 p95 3.70ms, 파일 쓰기 p95 60.48ms다. 입력값·입력 노드·component state는 유지됐고 reload는 없었으며 생성 `.d.ts`의 mtime·size도 그대로였고 fixture·browser profile·프로세스는 정리됐다.
- 작은 edit browser smoke([live-update-compact-edit-smoke.json](../benchmarks/results/live-update-compact-edit-smoke.json), warmup 1·측정 2·control 2)는 compact 전송에서도 응답이 patch로 유지되고 상태가 보존되는지 확인하는 용도다. 표본이 작아 p95 성능 주장에 쓰지 않는다.

## 한계

- 크기 감소는 필드 정리와 schema 공유의 효과다. 지연 개선이나 퇴행의 원인은 run 간 부하 차이와 GC를 분리하지 않아 단정하지 않는다.
- 목록 p95가 올라간 것은 full encoder가 목록 ack 이후에 실행되므로 직접 비용으로 귀속할 근거가 없다.
- 목록 표시 250ms 목표는 여전히 미달이며 파싱 병목이 남아 있다.
- WeakMap은 원 catalog가 살아 있는 동안 encoded 배열을 추가로 붙들므로 메모리 overhead는 아직 측정하지 않았다.
- 10회 p95는 최댓값이고, 단계 p95를 더하거나 Node·browser clock을 서로 빼지 않는다.
- 응답 크기는 서버가 전송한 응답 객체의 JSON UTF-8 바이트다. WS header·압축·manifest를 포함한 물리 네트워크 총량은 아니다. 결과의 codeHashes와 원시 sample·p50·p95를 대조해 일치함을 확인했다.
