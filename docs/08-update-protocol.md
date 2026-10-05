# 08. 갱신 프로토콜

이 문서는 Saylo의 개발 갱신과 부팅 wire 프로토콜의 단일 출처다. patch, snapshot, boot 인코딩, 적용과 resync 규칙을 정한다. [03-catalog-and-api.md](03-catalog-and-api.md)의 공개 타입과 [04-live-update-and-types.md](04-live-update-and-types.md)의 정책은 이 문서를 참조한다. 검증 전 제안이다.

## wire 타입

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

- `BootSnapshot`([03-catalog-and-api.md](03-catalog-and-api.md))은 wire로 직렬화한다. `Map`은 배열로 명시적으로 인코딩·디코딩한다. `JSON.stringify(Map)`에 의존하지 않는다.
- boot에는 locale, baseLocale, resolved timeZone, available manifest, 현재 로드한 namespace, base schema와 카탈로그 record의 version·provenance, loadedNamespaces의 base+target pair 전부에 대한 present/missing 판정과 version이 들어간다. 데이터 누락을 정상 부재로 추정하지 않는다.
- 개발에서 초기 transport 정보(개발 세션, registry snapshot)는 별도의 고정 opaque handle로 주고받는다. handle은 안정적이며 dev metadata 조회에만 쓴다.
- `CatalogSource`의 metadata 경로에서 dev session과 registry snapshot을 받아 boot를 decode하고, 그 결과로 core의 `UiSnapshot`을 만든다.
- 부팅 예(짧게):

```ts
// virtual:saylo가 내보내는 값
import { initialSnapshot, catalogSource } from "virtual:saylo";
// initialSnapshot: BootSnapshot (wire에서 decode된 값)
// catalogSource: CatalogSource (개발은 범용 loadCatalog, 운영은 static map)
const i18n = createI18n({ initialSnapshot, catalogSource, timeZone: "UTC" });
```
