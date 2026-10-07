# 08. 갱신 프로토콜

이 문서는 Saylo의 개발 갱신과 부팅 wire 프로토콜의 단일 출처다. patch, snapshot, boot 인코딩, 적용과 resync 규칙을 정한다. [03-catalog-and-api.md](03-catalog-and-api.md)의 공개 타입과 [04-live-update-and-types.md](04-live-update-and-types.md)의 정책은 이 문서를 참조한다. 검증 전 제안이다.

## 현재 eager 구현 (2026-10-05)

현재 `@0disoft/saylo-vite`는 registry 전체를 교체한다. 실제 타입은 `packages/vite/src/types.ts`, 조정 로직은 `dev-sync.ts`에 있다.

| 이벤트 | 내용 |
| --- | --- |
| `saylo:request-eager-snapshot` | `scope: 'eager'`, 고유 `requestId`, 클라이언트 `generation`, 현재 `locale`·`namespaces` |
| `saylo:eager-snapshot` / `kind: 'snapshot'` | 요청을 echo하고 서버 `sessionId`·`revision`·`baseLocale`·전체 `catalogs` 반환 |
| `saylo:eager-snapshot` / `kind: 'update'` | 서버 `baseRevision`·`revision`과 전체 registry 반환 |
| `saylo:eager-diagnostic` | 파일 오류는 broadcast, 요청 진단은 요청 정보를 붙여 해당 client에만 반환 |

서버 revision과 클라이언트 요청 generation은 독립적이다. listener 등록 뒤 처음 요청하고, gap·새 세션·재연결은 snapshot으로 복구한다. 유효 요청은 하나이며 복구 중 update는 최신 session·revision 정보 하나로 합친다. 과거 요청과 관측 revision보다 낮은 응답은 게시하지 않는다. 기본 timeout은 요청당 5초, 최대 3회 시도이며 실패 시 마지막 정상 상태를 유지한다. 다음 update·연결 이벤트에서 다시 시도할 수 있다. disconnect·해제·dispose는 요청과 timer를 무효화한다.

요청의 locale·namespace는 현재 상태를 설명하고 `scope: 'eager'` 응답은 전체를 교체한다. pair별 outcome·version·tombstone과 request-scoped 부분 delta는 지연 로딩 경로에서 연결했고, 아래 push wire 초안은 아직 미구현이다. Vite 서버 재시작의 실제 브라우저 경로는 페이지 새로고침을 포함하며 그 경우 DOM 보존을 요구하지 않는다.

## wire 타입

현재 lazy 경로는 manifest 조회와 pair 조회를 분리한다. 전체 present 응답은 compact 인코딩으로 보내고 missing/failed는 기존 outcome이다. 직전 baseline이 맞으면 request-scoped 메시지 delta patch가 된다. 아래 push wire 설계 초안(`kind: "patch"`, 파일 단위 replacements/deletions, `SerializedCatalog`)은 아직 구현 전이며 지금의 delta patch와 다른 계약이다.

| 이벤트 | 현재 lazy 전송 |
| --- | --- |
| `saylo:request-manifest` | eager handshake의 요청 ID·generation을 사용해 전체 metadata 요청 |
| `saylo:manifest` | snapshot 응답 또는 `baseRevision`을 가진 update. 전체 목록·pair version·schema fingerprint·missing tombstone이며 AST 없음 |
| `saylo:request-catalog` | 고유 요청 ID·generation과 locale·namespace 한 pair. 직전에 받은 present pair가 있으면 선택적 `known { sessionId, catalogVersion }`을 함께 보낸다 |
| `saylo:catalog` | 요청 echo와 결과. baseline이 맞으면 `status: "patch"` delta, 전체 present는 `status: "compact"`, `encoding: "saylo-catalog-v1"`로 보낸다. missing/failed는 기존 outcome이다 |

`virtual:saylo/lazy`는 초기 범위의 base+target outcome만 싣고 source handle을 내보낸다. 기존 설계의 push patch와 달리 서버가 patch를 밀어주지 않는다. manifest 응답을 적용한 뒤 core의 `refresh`가 현재 desired scope를 다시 준비하면 `catalogSource`가 pair마다 직전 baseline을 기준으로 조회한다. 미로드·비활성 pair의 AST는 받지 않는다. 조회 응답은 요청 identity·session·pair version·schema를 검사하고 재연결은 identity를 무효화한 뒤 현재 manifest로 재요청한다. 여러 instance는 source를 공유하며 자신의 연결·구독만 해제한다. 기존 eager 전체 갱신은 eager snapshot을 요청한 Vite client에만 보낸다.

namespace schema fingerprint는 정규화한 namespace·키·인자 acceptedTypes JSON의 UTF-8 SHA-256(`saylo-schema-v2:sha256:` + 64자리 16진수)이다. 로케일·pair마다 큰 스키마 문자열을 반복 전송하지 않도록 고정 길이 digest로 바꿨고, `saylo-schema-v1:` 형식으로 저장된 기존 boot·chunk는 재생성해야 한다.

### 현행 compact 전체 카탈로그 (2026-10-07)

실제 타입은 `packages/vite/src/catalog-wire.ts`에 있다. lazy 개발 소켓의 full present 응답만 compact로 인코딩하며, 클라이언트는 decode 뒤 기존 manifest 검사와 immutable 처리를 거쳐 core에 일반 present outcome을 넘긴다. 구현·측정 기록은 [16-compact-catalog-transport.md](16-compact-catalog-transport.md)에 있다.

- envelope는 `status: "compact"`, `encoding: "saylo-catalog-v1"`과 현재 `sessionId`, `key`, `catalogVersion`, `namespaceSchemaFingerprint`를 담는다.
- catalog payload는 `{ sourceName, schemas, messages }`다. 메시지는 `[id, source, offset, line, column, ast, schemaIndex]`이며 같은 arguments JSON은 `schemas`의 항목을 공유한다.
- AST의 top-level literal·argument 노드는 위치가 없으면 `[type, value]`, 있으면 `[type, value, startOffset, startLine, startColumn, endOffset, endLine, endColumn]`로 보낸다. 복잡한 ICU 노드와 그 중첩 내용은 기존 AST 형태를 유지한다. 파일 위치·AST 위치의 offset/line/column 값은 바꾸지 않으며 클라이언트 ICU 재파싱은 없다.
- encoding·stamp·tuple·위치·schema 참조·중복 ID 검사 실패는 해당 요청을 거절하고 마지막 정상 UI를 유지한다. 이후 별도의 새 요청으로 회복할 수 있다. 깨진 patch에 대한 기존 timeout 안의 full 재요청 규칙과 구분한다.
- missing·failed·patch, eager snapshot, 초기 boot, production chunk와 SSR boot wire는 기존 형식이다. 클라이언트는 기존 일반 present 응답도 받는다. 새 compact 응답을 보내는 plugin과 dev client는 같은 패키지 구현을 사용해야 한다.

### 현행 request-scoped delta patch (2026-10-06)

실제 타입은 `packages/vite/src/catalog-patch.ts`, 서버 판정은 `catalog-registry.ts`의 `loadDelta`에 있다.

```ts
interface CatalogStamp { readonly sessionId: string; readonly catalogVersion: number; }
interface PositionShift { readonly offsetDelta: number; readonly lineDelta: number; readonly columnDelta: number; }

interface CatalogPatch extends CatalogStamp {
  readonly status: "patch";
  readonly key: CatalogKey;
  readonly namespaceSchemaFingerprint: string;
  readonly base: CatalogStamp;                                         // 적용 조건: 현재 baseline과 같아야 함
  readonly sourceName: string;
  readonly messageCount: number;                                       // 적용 후 메시지 수. 다르면 거절한다
  readonly upsert: readonly (readonly [string, ParsedMessage])[];       // [ID, ParsedMessage]
  readonly remove: readonly string[];                                   // [ID]
  readonly positions: readonly (readonly [string, SourcePosition])[];   // [ID, SourcePosition]
  readonly positionShift?: PositionShift;                              // 일괄 이동. positions가 개별 ID를 덮는다
}
```

- 서버는 pair마다 직전 present version 한 개만 보관한다(삭제·재생성 이력 없음). 요청의 `known`이 현재 version이나 그 직전 version과 맞을 때만 patch를 만든다.
- patch는 현재 `sessionId`·`key`·`catalogVersion`·`namespaceSchemaFingerprint`·`sourceName`·`messageCount`와 `base` stamp를 담는다. 메시지 `source`가 바뀌면 upsert, 없어진 ID는 remove, 위치만 바뀌면 positions다.
- unchanged-source 메시지의 delta(offset·line·column)가 모두 같고 실제로 움직인 위치가 2개 이상일 때 `positions` 목록 대신 `positionShift` 하나로 압축한다. 일부는 이동 0이고 다른 일부만 이동했거나 delta가 다르면 압축하지 않고 `positions` 목록을 그대로 보낸다. `positions`에 있는 ID는 개별 위치로 덮어쓴다.
- 적용 시 `messageCount`와 위치값 유효성(정수, offset ≥ 0, line·column ≥ 1)을 검사한다. 메시지 수가 다르거나 위치값이 유효하지 않으면 거절하고 이전 정상 상태를 유지한다.
- schema fingerprint만 바뀌어 pair version이 같아도 새 fingerprint를 담은 0메시지 patch가 될 수 있다. 위치만 바뀌는 포매터 JSON 재배치는 version을 올려 baseline을 정확히 맞추고, UI 의미가 같으면 core는 렌더를 건너뛴다.
- 클라이언트는 요청마다 immutable baseline을 고정해 복수 instance의 역순 응답도 안전하다. 새 전체 `CatalogOutcome`만 core에 넘기고 base+target을 한 commit으로 게시한다. cache는 현재 세션 present pair마다 stale baseline 하나를 두고, `getCatalogs`는 현재 metadata와 맞는 pair만 노출한다.
- 과거 version gap, 새 세션, 밀집 변경, 삭제·재생성, `known` 없음은 전체 present/missing으로 돌아간다. 깨진 patch는 기존 timeout 안에서 새 `requestId`로 `known` 없는 full을 한 번 재요청하고, 그마저 patch면 거절하고 이전 정상 UI를 유지한다.
- 기존 eager 전체 snapshot, production chunk loader, SSR boot wire는 그대로 유지한다.

core는 ID가 기준에 있는지 먼저 확인한 뒤, 깊게 동결한 번역 인자 스키마와 기준 메시지의 인자 스키마가 이전에 검증에 성공한 객체 쌍이면 `validateTranslation` 결과를 재사용한다. 한 번역 스키마에 복수 기준 계약의 성공 기록을 둘 수 있고, mutable 입력·새 계약은 다시 검증한다. 파싱 호출 내 동일 인자 스키마 공유와 검증 기록의 범위는 [18](18-shared-argument-schemas.md)를 따른다. 서버는 pair version 판정에서 정렬·stringify 없이 key·source·position을 직접 비교한다.

### 설계 초안: push wire

아래 TS는 최종 push wire 설계 초안이다. 현행 lazy delta(`status: "patch"`, 메시지 단위 upsert/remove/positions)와 달리 전역 revision·`kind: "patch"`·파일 단위 `replacements`/`deletions`·`SerializedCatalog`를 쓴다. 아직 구현 전이다.

```ts
type SessionId = string;
type RequestId = string;
type Revision = number;
type Generation = number;
type NamespaceSchemaFingerprint = string;

interface CatalogKey { readonly locale: string; readonly namespace: string; }

// FormatJS AST 요소 배열. 형태는 FormatJS 파서 출력 계약을 따른다.
type SerializedMessageAst = ReadonlyArray<unknown>;

interface SerializedCatalog {
  catalogVersion: Revision;                     // 이 catalog key 자체의 version. tombstone도 증가한다
  namespaceSchemaFingerprint: NamespaceSchemaFingerprint;
  formatLocale: string;                         // 메시지 출처 locale
  messages: Record<string, SerializedMessageAst>;
  messageFingerprints: Record<string, string>;
}

// SerializedBaseSchema는 [03-catalog-and-api.md](03-catalog-and-api.md)에 정의가 있다.

interface CatalogPatch {
  kind: "patch";
  sessionId: SessionId;
  baseRevision: Revision;                       // 적용 조건: 현재 적용 revision과 같아야 함
  revision: Revision;                           // 적용 후 registry revision
  availableLocales: readonly string[];          // 전체 목록(replacement). added/delta가 아니다
  availableNamespaces: readonly string[];       // 전체 목록(replacement)
  changedNamespaceSchemas: Array<{ namespace: string; schema: SerializedBaseSchema | null }>;  // 삭제는 null tombstone
  replacements: Array<{ key: CatalogKey; catalog: SerializedCatalog }>;
  deletions: Array<{ key: CatalogKey; catalogVersion: Revision }>;   // tombstone version을 함께 보낸다
}

interface SnapshotRequest {
  requestId: RequestId;
  generation: Generation;
  locale: string;                               // 현재 desired locale. 초기 config가 아니다
  namespaces: readonly string[];                // 현재 원하는 namespace
}

interface CatalogSnapshot {
  kind: "snapshot";
  sessionId: SessionId;
  requestId: RequestId;                         // 요청을 되돌려준다. 늦은 응답 판정에 쓴다
  revision: Revision;                           // 응답 시점의 전역 revision
  baseLocale: string;
  requestedLocale: string;
  requestedNamespaces: readonly string[];
  availableLocales: readonly string[];
  availableNamespaces: readonly string[];
  schemas: SerializedBaseSchema[];              // 로드된 namespace의 전체 base schema
  catalogs: Array<{ key: CatalogKey; catalog: SerializedCatalog }>;
  outcomes: Array<{ key: CatalogKey; outcome: "present" | "missing"; catalogVersion: Revision }>;  // 요청한 base+target pair 전부의 판정
  tombstones: Array<{ key: CatalogKey; catalogVersion: Revision }>;  // 이후 늦은 load를 검증할 scoped version
}

type DevEvent = CatalogPatch | CatalogSnapshot;
```

- `availableLocales`와 `availableNamespaces`는 매번 전체 목록(replacement)이다. 변경분이 아니다. 로케일 하나만 바뀐 patch에서도 전체 목록을 담아 보낸다.
- `changedNamespaceSchemas`는 이 patch에서 바뀐 namespace의 `SerializedBaseSchema` 전체를 담는다. fingerprint만으로는 클라이언트가 JS 인자 검증을 할 수 없다. namespace 삭제는 schema를 null로 보낸다.
- namespace manifest 변경(목록의 증가·감소)은 별도 이벤트가 아니라 patch envelope의 `availableLocales`/`availableNamespaces`가 담당한다. 같은 revision을 두 번 진행시키는 독립 mutation을 만들지 않는다.
- `catalogVersion`은 catalog key마다 증가한다. 삭제를 나타내는 tombstone도 version을 갖는다.
- schema 버전은 namespace 단위 fingerprint다. 전역 schemaRevision은 공개 API와 wire에 두지 않는다.
- 전역 registry counter는 모든 client envelope 수신으로 진행한다. payload 적용 가능 여부와는 별개다.

## 적용 규칙

- payload는 이미 로드된 (locale, namespace) pair에만 적용한다. 미로드 pair는 dirty로 표시하고 그 key의 알려진 catalogVersion만 기록한 뒤 payload는 버린다.
- UI 게시는 하나의 atomic candidate 계산으로 한다. schema는 새것이고 catalog는 옛것인 중간 상태를 구독자에게 노출하지 않는다.
- metadata 변경과 payload 적용은 같은 commit 안에서 처리하고, 알림은 commit이 끝날 때 한 번만 낸다.
- 같은 세션이고 이미 적용한 revision 이하인 patch는 버린다.
- `baseRevision`이 현재 적용 revision과 같고 `revision`이 더 크면 적용한다.
- 더 미래의 `baseRevision`이거나 적용할 수 없는 겹침이면 gap으로 보고 resync한다. 역순이라는 이유만으로 무조건 버리지 않는다.

## snapshot 요청과 resync

- snapshot 요청에는 현재 desired locale과 원하는 namespace, `requestId`, `generation`을 담는다. 초기 config를 쓰지 않는다.
- 응답은 `requestId`, `sessionId`, 응답 시점의 전역 revision, 요청한 base+target pair 전부의 outcome(present/missing)과 version, present 카탈로그, 전체 base schema, tombstone을 하나의 immutable registry 상태에서 만든다. 부분 응답은 게시하지 않는다. 판정·조회가 실패하면 snapshot 요청을 실패시키고 이전 UI를 유지한다. present outcome에는 같은 버전의 record가 반드시 있어야 하며, 처음부터 없는 pair의 missing version은 0이다.
- resync 사유는 처음 연결, revision gap, 재연결, 서버가 새 session을 알린 경우다.
- 재연결은 진행 중인 모든 load와 `requestGeneration`을 무효화한다. 무효화 뒤 새 요청으로 다시 맞춘다.
- listener는 먼저 등록해 buffer에 담는다. 초기 snapshot이 오면 그 revision에 맞는 patch만 순서대로 적용한다.
- snapshot 적용 시 요청 범위의 이전 schema·record·missing 판정을 완전히 교체한다. deleted namespace와 missing pair의 오래된 record는 제거한다. 버퍼에서 같은 세션의 snapshot revision 이하 patch는 버리고, 남은 patch는 baseRevision이 맞는 순서로 적용한다. 새 session의 응답이면 이전 session 버퍼·version·tombstone을 폐기하고, 이어지는 gap은 다시 resync한다.
- 오래된(이전에 보낸) 요청의 응답은 무시한다. 늦게 도착한 resync 응답이 최신 상태를 덮어쓰지 않게 한다. 동시에 여러 snapshot 요청을 보내지 않고 `requestId`와 `generation`으로 늦은 응답을 판정한다.
- resync 응답이 준 outcome, schema, tombstone은 이후 도착한 늦은 load를 검증할 scoped known version으로 쓴다.
- queue가 폭주하면 bounded buffer로 정리한다. 너무 많거나 obsolete한 항목을 버리고 resync한다.

## generation과 의도 대체

generation은 transport의 오래된 완료를 차단하는 값이다. generation이 바뀔 때마다 모든 호출자를 취소하지 않는다. 자세한 정책은 [04-live-update-and-types.md](04-live-update-and-types.md)의 desired-state 조정을 따른다.

- 진행 중인 의도는 pending waiter로 남긴다. 그 의도가 최신 desired state에 포함되어 있으면 준비가 끝날 때 resolve한다.
- `setLocale("en")` 진행 중 `loadNamespace("cart")`가 추가되어도 두 의도는 최신 desired state에 남으므로 둘 다 resolve한다.
- 앞선 locale 의도가 실제로 대체되었을 때만 `SupersededRequestError`로 reject한다. `dispose`는 별도 사유다.
- timeout이나 network 실패는 현재 의도를 reject하고 이전 UI를 유지한다.
- generation이 바뀐 obsolete network 응답은 직접 UI에 게시하지 않는다. version이 맞는 cache 재사용은 허용한다.

## boot 인코딩과 dev metadata

- `BootSnapshot`([03-catalog-and-api.md](03-catalog-and-api.md))은 wire로 직렬화한다. 현재 구현한 boot wire v1은 `format: 'saylo-boot-v1'`에 `manifest`, `locale`, `timeZone`, `stateRevision`, `loadedNamespaces`, `baseSchemas`(`CatalogSchema[]`), `catalogOutcomes`(`CatalogOutcome[]`)를 담는다. `catalogOutcome`은 parsed catalog의 sourceName·locale·AST·인자를 배열로 싣고 missing outcome도 명시한다. `Map`을 배열로 인코딩하는 모형은 초안이며 `JSON.stringify(Map)`에 의존하지 않는다.
- boot에는 locale, baseLocale, resolved timeZone, available manifest, 현재 로드한 namespace, base schema와 카탈로그 record의 version·provenance, loadedNamespaces의 base+target pair 전부에 대한 present/missing 판정과 version이 들어간다. 데이터 누락을 정상 부재로 추정하지 않는다.
- 개발에서 초기 transport 정보(개발 세션, registry snapshot)는 별도의 고정 opaque handle로 주고받는다. handle은 안정적이며 dev metadata 조회에만 쓴다.
- `CatalogSource`의 metadata 경로에서 dev session과 registry snapshot을 받아 boot를 decode하고, 그 결과로 core의 `UiSnapshot`을 만든다.
- 부팅 예(짧게):

```ts
// virtual:saylo/server (server-only)
import { serializeBootSnapshot } from '@0disoft/saylo-core';
import { createRequestI18n } from 'virtual:saylo/server';
const request = await createRequestI18n({ locale: 'en' });         // async scope 준비 후 요청별 instance
try {
  const boot = serializeBootSnapshot(request.getBootSnapshot()); // 서버 HTML과 함께 전달한다.
} finally { request.dispose(); }
```

```ts
// client: 서버 JSON으로 초기 스냅샷을 만들고 브라우저용 source를 연결한다.
import { createI18n, decodeBootSnapshot } from '@0disoft/saylo-core';
import { createHydrationAdapter } from '@0disoft/saylo-react';
import { catalogSource } from 'virtual:saylo/lazy';
const decoded = decodeBootSnapshot(script.textContent);
const client = createI18n({ initialSnapshot: decoded, catalogSource });
const adapter = createHydrationAdapter(client);                     // boot S1 유지, finishHydration 후 1회 publish
```
