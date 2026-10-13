# 03. 카탈로그와 API

이 문서는 카탈로그 파일 형식, ID·namespace 규칙, ICU 정책, argument 계약, 공개 API와 예제를 정한다. 갱신 프로토콜의 wire 타입과 적용 규칙은 [08-update-protocol.md](08-update-protocol.md)가 단일 출처다. 이 문서는 그 정의를 중복하지 않는다. 패키지 이름은 `@0disoft/saylo-core`·`@0disoft/saylo-react`·`@0disoft/saylo-typegen`·`@0disoft/saylo-vite`로 확정했고 2026-10-06 `0.1.0-alpha.1`(dist-tag `alpha`)로 게시했다. 이 문서의 API 시그니처 중 아직 구현하지 않은 부분은 설계 제안이다.

## 파일 레이아웃

```text
locales/
  ko/                # 기준 로케일 (config로 고정)
    common.json
    cart.json
  en/
    common.json
    cart.json
```

- 인코딩은 UTF-8이다.
- 로케일 디렉터리 이름은 BCP 47 태그다. 대소문자와 스크립트 표기를 정규화(canonicalization)한 뒤 중복을 검사한다. `ko-kr`과 `ko-KR`이 서로 다른 로케일로 취급되면 안 된다.
- 각 로케일은 같은 namespace 파일 이름을 쓴다. namespace는 파일 이름에서 `.json`을 뺀 값이고, 주소는 로케일과 무관하게 같다. namespace에 경로 구분자를 넣지 않는다.
- 파일 경로는 `locales/<locale>/<namespace>.json`로 해석하고, 결과 경로가 locales 루트를 벗어나지 않는지 검사한다. 심볼릭 링크가 루트 밖을 가리키면 거부한다.
- 값은 flat literal ID를 키로 갖는 JSON 객체다. 중첩 객체로 namespace를 흉내 내지 않는다.

## ID와 namespace 주소

카탈로그 안의 키는 literal ID다. 코드에서 참조할 때는 namespace를 붙인 주소를 쓴다.

| 표기 | 규칙 |
| --- | --- |
| literal ID | 파일 안의 키. 예: `welcome`, `cart.items` |
| 주소 | `<namespace>:<literal-id>`. 예: `common:welcome`, `cart:items` |
| 콜론 | namespace와 literal ID 안에 쓸 수 없다. 구분자 전용이다. |
| 점 | literal 문자다. 계층 구분이 아니다. ID로 `cart.items`를 쓰면 주소는 `cart:cart.items`다. |

- (namespace, id) 쌍의 중복과 namespace 구분자 모호성을 금지한다. 서로 다른 locale에서 같은 주소를 쓰는 것은 정상이다.
- JSON 안에 같은 ID가 두 번 나오면 거부한다. `JSON.parse`만으로는 중복 키를 감지하지 못하므로(마지막 값이 남는다) parser 전처리로 중복을 감지한다.

## ICU 정책

- 지원 범위는 선택한 FormatJS 버전이 지원하는 MessageFormat 1 문법이다. 전체 ICU 표준을 보장하지 않는다. 변수, `number`, `date`, `time`, `select`, `plural`, `selectordinal`, offset, 중첩 폼을 대상으로 한다. 문법 정의는 [FormatJS ICU 문법](https://formatjs.github.io/docs/core-concepts/icu-syntax/)을 따른다.
- `offset:n`은 plural 분기의 offset 지정이고, `#`은 plural 안에서 offset이 적용된 수를 출력하는 자리다.
- plural category 집합을 locale마다 같게 강요하지 않는다. `other`, 정확값 분기, `selectordinal`, `offset`, 중첩 구조를 각각 검증한다.
- parser와 formatter는 검증된 라이브러리를 재사용한다. 초기 구현 선택은 `@formatjs/icu-messageformat-parser`와 `intl-messageformat`이다. `IntlMessageFormat`은 직렬화된 AST를 입력으로 받고 tag/`ignoreTag` 옵션을 지원한다([FormatJS intl-messageformat](https://formatjs.github.io/docs/intl-messageformat/)). 문법을 새로 발명하지 않는다.
- 태그는 parser의 `ignoreTag`를 켜서 literal 텍스트로 처리한다. 초기 결정은 rich text 컴포넌트 보간을 MVP에서 제외하는 것이었다. 첫 rich text core API 슬라이스가 순수 텍스트 계약 위에 읽기 전용 parts 투영(`tParts`)을 더한다([78-rich-text-parts.md](78-rich-text-parts.md)). 인자로 컴포넌트를 넣는 보간과 자동 HTML 렌더는 여전히 비목표다.
- 임의 JavaScript 실행, `eval`, 자동 HTML 주입을 하지 않는다.
- AST는 언어 간에 같아야 하지 않는다. 번역마다 구조와 분기가 달라도 된다. 요구사항은 같은 로케일·같은 메시지·같은 argument에 대해 개발과 운영이 같은 출력, 같은 오류, 같은 fallback을 내는 것(dev/prod parity)이다. 같은 Intl locale data와 같은 런타임 매트릭스에서 비교한다.

## argument 계약 (초기 설계 결정)

기준 로케일이 키와 argument 스키마의 원본이다. argument의 타입은 오직 기준(base) 메시지 안에서 그 argument가 나타나는 모든 사용의 교집합으로 정한다. 번역은 이 계약을 바꾸지 않는다.

| 사용 형태 | 그 사용의 타입 |
| --- | --- |
| plain 변수 (`{name}`) | 문자열 또는 숫자 |
| `number`, `plural`, `selectordinal` | number |
| `date`, `time` | number 또는 Date |
| `select` | string |

- 기준 메시지 안에서 한 argument가 여러 형태로 쓰이면 각 사용 타입의 교집합을 최종 타입으로 삼는다. 예를 들어 기준에 `{count}`(plain)와 `{count, plural}`(number)가 함께 있으면 교집합은 number다. 교집합이 비면 오류다.
- 번역에서 사용하는 인자 이름은 기준 인자 이름의 부분집합이어야 한다. 번역이 새 인자를 추가하면 오류다.
- 각 인자에 대해 기준이 허용하는 값 타입은 번역이 받아들이는 타입의 부분집합이어야 한다. 번역이 기준보다 더 좁은 타입을 요구하면(기준 plain, 번역 plural) 오류다.
- 번역이 그 인자를 쓰지 않는 것은 허용한다. 이는 키 자체가 없는 것(폴백 대상)과 다른 경우다.
- 번역이 인자를 생략해도 호출 시 기준의 필수 인자 검증은 그대로 적용한다. TS뿐 아니라 JS를 포함한 모든 경로에서 accepted base schema를 기준으로 호출 인자를 검증하고, 어긋나면 `InvalidArgumentError`를 낸다.
- 기준 메시지에 나오는 모든 placeholder 이름의 합집합이 그 메시지의 필수 인자 이름 집합이다. 각 이름의 타입은 그 이름이 쓰인 사용 형태들의 교집합으로 정한다.

정상 예, 기준 `locales/ko/cart.json`:

```json
{
  "title": "장바구니",
  "items": "{count, plural, one {#개 상품} other {#개 상품}}",
  "total": "합계 {total, number}",
  "when": "{at, date, medium}"
}
```

여기서 `items`의 `count`는 plural 하나뿐이라 number다. `title`은 argument가 없다.

정상 예, 번역 `locales/en/cart.json`. 기준 타입을 그대로 받고 일부 키는 생략한다:

```json
{
  "title": "Cart",
  "items": "{count, plural, one {# item} other {# items}}"
}
```

`total`과 `when`은 번역에 없다. 이는 키 누락이라 접근 시 baseline 값으로 폴백한다. `items`는 plural이라 number 요구가 기준과 맞는다. 이 번역은 키만 생략했고 `items`의 `count`는 그대로 쓴다.

argument를 실제로 생략한 예, `locales/en/cart.json`의 `items`만 다르게 둔다:

```json
{
  "items": "Items in your cart"
}
```

이 번역은 메시지에서 `count`를 쓰지 않는다. 그래도 기준이 `count`를 필수로 정하므로 호출은 그대로 `t("cart:items", { count })`로 해야 한다. 메시지에서 인자를 생략해도 호출 계약은 accepted base schema를 따른다.

오류 예, 번역이 더 좁은 타입을 요구한다. 기준 `locales/ko/badge.json`:

```json
{
  "count": "총 {count}개"
}
```

기준 `count`는 plain이라 타입이 문자열 또는 숫자다. 번역 `locales/en/badge.json`이 아래처럼 plural(number)을 요구하면 오류다.

```json
{
  "count": "{count, plural, one {# item} other {# items}}"
}
```

이 진단은 단순히 번역 오류라고 끝내지 않는다. 기준에서 숫자 계약을 명시해야 한다는 수정 방향을 함께 알린다.

argument 없는 키는 그대로 호출한다. `t("cart:title")`.

## 포맷 캐시와 시간대

캐시를 두 층으로 나눈다.

| 캐시 | 키 | 무효화 |
| --- | --- | --- |
| 메시지 formatter | (namespace, id, message fingerprint, formatLocale, 정규화한 option, timeZone) | 그 메시지의 fingerprint나 formatLocale이 바뀔 때 |
| `Intl` formatter | (locale, 정규화한 Intl option, timeZone) | locale이나 option이 바뀔 때 |

- 카탈로그 revision이 바뀌어도 문구 내용이 그대로면 모든 `Intl` 캐시를 비우지 않는다. `Intl` 캐시는 문구 revision과 독립이다.
- full replacement에서도 AST fingerprint가 그대로인 메시지는 formatter를 재사용한다. 더 이상 쓰지 않는 항목은 LRU 등으로 bounded하게 정리한다.
- 날짜·시간 포맷은 timeZone을 명시적으로 config에서 받는다. 기본값은 UTC를 권장한다. timeZone을 명시하지 않으면 서버 렌더링과 브라우저 렌더링 결과가 갈려 hydration 불일치가 난다.
- baseline fallback으로 채워진 메시지는 그 메시지의 출처 locale(formatLocale) 기준으로 포맷한다. 이때 숫자·날짜 표기가 사용자가 고른 로케일의 기대와 다를 수 있음을 문서와 진단에 명시한다.

## revision의 구분

| 값 | 소유 | 용도 | 노출 |
| --- | --- | --- | --- |
| registry revision | 개발 서버·전역 transport | 카탈로그 전송 순서를 맞춘다 | 공개 API 아님 |
| instance stateRevision | 클라이언트 instance | UI 구독 identity | `UiSnapshot` |

- 로케일 전환은 instance stateRevision만 올린다. 로케일 전환으로 registry revision을 올리지 않는다.
- 전역 schemaRevision은 공개 API와 wire에 두지 않는다. schema 버전은 namespace 단위 `namespaceSchemaFingerprint`로 다룬다. 한 namespace의 schema 변경이 다른 namespace의 정상 로드 결과를 낡게 만들지 않는다.
- `catalogVersion`은 catalog key마다 증가한다. 삭제를 나타내는 tombstone도 version을 갖는다. 세부 규칙은 [08-update-protocol.md](08-update-protocol.md)를 따른다.

## 카탈로그 로드 결과와 오류

카탈로그 조회는 `CatalogSource` 인터페이스를 통한다. 개발과 운영은 같은 인터페이스 뒤에 다른 어댑터를 둔다. 결과는 세 상태로 구분한다.

- `present`: 카탈로그가 있다. catalogVersion, namespaceSchemaFingerprint, 카탈로그 record를 함께 돌려준다.
- `missing`: 서버가 그 카탈로그가 없다고 판정했다. 파일 삭제나 아직 없는 namespace가 해당한다. version만 돌려준다.
- `failed`: 네트워크 오류나 서버 오류로 조회가 끝나지 못했다. `missing`과 구분한다.

조회 실패(`failed`)면 이전 UI를 유지하고, 그 호출의 Promise는 `CatalogLoadError`로 reject한다. 서버가 판정한 `missing`은 실패가 아니라 정상 결과다.

| 오류 | 발생 조건 |
| --- | --- |
| `UnknownMessageError` | 알 수 없는 키에 접근했을 때. 키 문자열을 그대로 노출하지 않는다. |
| `NamespaceNotLoadedError` | 로드하지 않은 namespace에 접근했을 때. |
| `InvalidArgumentError` | accepted base schema 기준으로 필수 인자가 빠지거나 타입이 어긋날 때. |
| `CatalogLoadError` | `loadCatalog`가 `failed`를 반환했을 때. |
| `SupersededRequestError` | 앞선 의도가 실제로 대체되었을 때(예: `en` 전환 중 `ko`로 재전환). `dispose`는 별도 사유로 reject한다. |

## 공개 API

현행 구현은 `freezeCatalogs(catalogs: readonly ParsedCatalog[]): readonly ParsedCatalog[]`를 core 루트와 `@0disoft/saylo-core/runtime`에서 제공한다. JSON 전송 뒤 배열·AST·위치·인자 스키마를 깊게 동결하고 같은 배열을 반환한다. 외부의 얕은 동결은 내부까지 순회하며, core가 이미 순회한 객체는 다시 방문하지 않는다. 카탈로그·스키마 유효성 검사는 기존 decoder·store·i18n에서 수행한다. 이 함수는 게시된 `0.1.0-alpha.1`에 아직 없으며 Vite와의 동결 경로 공유는 [26-shared-catalog-freeze.md](26-shared-catalog-freeze.md)에 기록한다.

현재 코어는 parsed catalog 기반이다. 실제 생성 옵션은 두 갈래로, `catalogSource`·`locale`·`initialNamespaces`·`initialCatalogs`로 초기 카탈로그를 직접 전달하는 경로와 `initialSnapshot`(BootSnapshot)을 받는 SSR·hydration 경로가 있다. 실제 타입은 `packages/core/src/loading-types.ts`에 있다. `CatalogManifest.catalogs`의 pair별 version·schema fingerprint·missing tombstone과 모든 초기 base+target outcome을 검증한다. 비동기 `setLocale`·`loadNamespace`·어댑터용 `refresh`, `getSnapshot`·`getServerSnapshot`·`getBootSnapshot` 형태의 불변 조회, `onDispose`를 제공한다. 비동기 request-scoped 생성은 별도 `createServerI18n` factory가 맡는다. SSR 부팅 데이터는 `createBootSnapshot`·`serializeBootSnapshot`·`decodeBootSnapshot`으로 구현했다. 아래 `UiSnapshot.catalogs`의 `Map<string, CatalogRecord>` 모형과 wire catalog record는 설계 초안이고, 현행 구현은 `CatalogOutcome` 배열과 parsed catalog를 쓴다. 실행 예제는 `npm run demo:lazy`, SSR 예제는 `npm run demo:ssr`·`npm run dev:ssr`다.

초기 구현 선택은 동기 생성 + 명시적 로드다. 부팅에 필요한 로케일과 namespace는 `initialSnapshot`으로 함께 넘기고, 나머지는 필요할 때 로드한다. `createI18n`은 동기로 생성하고, SSR 요청 범위를 비동기로 준비하는 `createServerI18n`은 별도 factory로 제공한다.

schema는 런타임 옵션이 아니라 타입 전용 제네릭이다. 런타임 schema는 부팅 스냅샷의 base schema와 accepted schema 메타데이터에서 얻는다. `createI18n`에 schema 객체를 넘기지 않는다.

```ts
type Revision = number;
type LiteralId = string;
// TS 타입 전용. AppSchema 값 형태와 대응하며 런타임에는 존재하지 않는다.
type ArgTypes = Readonly<Record<string, unknown>>;

// 런타임 검증·직렬화용. 값 대신 accepted type partition과 required 여부를 담는다.
interface RuntimeArgumentSchema {
  readonly required: true;
  readonly acceptedTypes: ReadonlyArray<"string" | "number" | "date">;
}

// typegen이 생성해 앱이 import하는 타입. 키 -> 인자 이름 -> 인자 타입.
// Record 제약(string index signature) 문제를 피하려고 interface가 아니라 type 별칭으로 둔다.
type AppSchema = {
  "common:welcome": { name: string | number };
  "cart:title": {};                 // 인자 없음
  "cart:items": { count: number };
  "cart:total": { total: number };
  "cart:when": { at: number | Date };
};

// 런타임/타입 공용 최소 형태.
type Schema = Record<string, Record<string, unknown>>;
type UntypedSchema = Schema;

// 키와 인자의 상관관계를 유지하는 호출 tuple. union 키에서 인자를 잃지 않는다.
type TypedCall<S extends Schema> = {
  [K in keyof S & string]:
    keyof S[K] extends never
      ? [key: K]
      : [key: K, args: S[K]]
}[keyof S & string];

// 무타입 schema는 넓은 string 키를 허용하고, typed schema는 tuple 계약만 쓴다.
// typed 경로에 넓은 string overload를 추가하지 않는다. 추가하면 위 상관관계가 다시 무너진다.
type Translate<S extends Schema> =
  string extends keyof S
    ? (key: string, args?: Record<string, unknown>) => string
    : (...call: TypedCall<S>) => string;

// FormatJS AST 요소 배열. 형태는 불투명하게 둔다.
type MessageAst = readonly unknown[];

// Catalog는 literal ID -> MessageAst 맵이다.
type Catalog = Readonly<Record<LiteralId, MessageAst>>;

// namespace별 accepted base schema. 인자 스키마와 키 map, fingerprint를 담는다.
interface BaseSchema {
  readonly namespace: string;
  readonly fingerprint: string;
  readonly keys: ReadonlyMap<LiteralId, ReadonlyMap<string, RuntimeArgumentSchema>>;
}

// 한 로케일+namespace 카탈로그 레코드. 불변이다.
interface CatalogRecord {
  readonly locale: string;
  readonly namespace: string;
  readonly catalogVersion: Revision;
  readonly namespaceSchemaFingerprint: string;
  readonly formatLocale: string;                 // 이 메시지를 포맷할 출처 locale
  readonly messages: ReadonlyMap<LiteralId, MessageAst>;
  readonly messageFingerprints: ReadonlyMap<LiteralId, string>;
}

interface CatalogKey {
  readonly locale: string;
  readonly namespace: string;
}

type CatalogLoadResult =
  | { readonly status: "present"; readonly sessionId: string; readonly key: CatalogKey;
      readonly catalogVersion: Revision; readonly namespaceSchemaFingerprint: string;
      readonly catalog: CatalogRecord }
  | { readonly status: "missing"; readonly sessionId: string; readonly key: CatalogKey;
      readonly catalogVersion: Revision }
  | { readonly status: "failed"; readonly code: string; readonly message: string };

interface CatalogManifest {
  readonly sessionId: string;
  readonly registryRevision: Revision;
  readonly baseLocale: string;
  readonly availableLocales: readonly string[];
  readonly availableNamespaces: readonly string[];
}

// 카탈로그 조회 인터페이스. 개발과 운영 어댑터가 같은 인터페이스를 뒤에 둔다.
interface CatalogSource {
  loadCatalog(locale: string, namespace: string): Promise<CatalogLoadResult>;
  readManifest(): CatalogManifest | undefined;
}

// 공개 UI 스냅샷. render가 읽는 값이다.
interface UiSnapshot {
  readonly locale: string;
  readonly availableLocales: readonly string[];
  readonly availableNamespaces: readonly string[];
  readonly loadedNamespaces: readonly string[];
  readonly stateRevision: Revision;
  readonly catalogs: ReadonlyMap<string, CatalogRecord>;  // "<locale>:<namespace>" -> CatalogRecord
  readonly baseSchemas: ReadonlyMap<string, BaseSchema>;  // namespace -> accepted base schema
}

// wire로 직렬화 가능한 부팅 스냅샷. Map은 배열로 인코딩한다.
interface SerializedBaseSchema {
  readonly namespace: string;
  readonly fingerprint: string;
  readonly keys: ReadonlyArray<readonly [literalId: LiteralId, args: ReadonlyArray<readonly [name: string, schema: RuntimeArgumentSchema]>]>;
}
interface SerializedCatalogRecord {
  readonly key: CatalogKey;
  readonly catalogVersion: Revision;
  readonly namespaceSchemaFingerprint: string;
  readonly formatLocale: string;
  readonly messages: ReadonlyArray<readonly [literalId: LiteralId, ast: MessageAst]>;
  readonly messageFingerprints: ReadonlyArray<readonly [literalId: LiteralId, fingerprint: string]>;
}
interface BootSnapshot {
  readonly sessionId: string;
  readonly registryRevision: Revision;
  readonly locale: string;
  readonly baseLocale: string;
  readonly timeZone: string;
  readonly availableLocales: readonly string[];
  readonly availableNamespaces: readonly string[];
  readonly loadedNamespaces: readonly string[];
  readonly baseSchemas: readonly SerializedBaseSchema[];
  readonly catalogs: readonly SerializedCatalogRecord[];
  readonly catalogOutcomes: ReadonlyArray<{
    readonly key: CatalogKey;
    readonly outcome: "present" | "missing";
    readonly catalogVersion: Revision;
  }>;
  readonly provenance: string;
}

interface CreateI18nOptions {
  initialSnapshot: BootSnapshot;   // core가 decode해 UiSnapshot으로 만든다
  catalogSource: CatalogSource;
  timeZone?: string;               // 생략하면 initialSnapshot.timeZone 사용. 빌드·dev 기본은 "UTC"
}

interface I18n<S extends Schema> {
  readonly t: Translate<S>;
  setLocale(locale: string): Promise<void>;   // 허용 목록 밖이면 reject
  getLocales(): readonly string[];
  getNamespaces(): readonly string[];
  getSnapshot(): UiSnapshot;                    // 변할 때만 새 참조, 아니면 동일 참조
  subscribe(listener: (snapshot: UiSnapshot) => void): () => void;
  loadNamespace(namespace: string): Promise<void>;
  dispose(): void;                              // 이 instance가 소유한 구독만 정리
}

declare function createI18n<S extends Schema = UntypedSchema>(
  options: CreateI18nOptions
): I18n<S>;
```

- `fallbackLocale` 옵션은 두지 않는다. MVP의 fallback 대상은 baseLocale 하나다. 다단계 fallback은 로딩·스키마·포맷 출처까지 함께 설계한 뒤 후속으로 다룬다.
- `UiSnapshot.catalogs`는 wire의 catalog 배열을 decode해 복원한 `ReadonlyMap<string, CatalogRecord>`이다. `CatalogRecord`가 formatLocale, catalogVersion, namespaceSchemaFingerprint를 함께 보존한다. `JSON.stringify(Map)` 결과로 만들지 않는다.
- `ArgTypes`는 TS 타입 전용이다. 런타임 검증·직렬화는 `RuntimeArgumentSchema`(acceptedTypes, required)로 한다. 값 맵을 그대로 wire에 싣지 않는다.
- `BootSnapshot`의 encode/decode와 dev metadata handle은 [08-update-protocol.md](08-update-protocol.md)를 따른다.
- `catalogOutcomes`는 loadedNamespaces의 base+target pair 전부를 판정한 결과다. present는 같은 버전의 record가 반드시 있고, missing은 version을 가진 명시적 부재다. never-seen pair의 부재 버전은 0으로 시작한다. decode는 누락·중복·메타데이터 불일치를 거부한다.
- `UiSnapshot`에는 timeZone과 baseLocale을 담지 않는다. instance의 baseLocale과 timeZone은 생성 시 고정되는 불변 값이고, snapshot-bound formatter도 이 값을 쓴다. `initialSnapshot`(BootSnapshot)의 timeZone과 options의 timeZone이 다르면 모호한 상태를 만들지 않고 생성 오류로 멈춘다.
- 키와 인자의 상관관계는 `TypedCall` tuple로 유지한다. typed schema에 넓은 `string` overload를 덧붙이지 않는다.

소유권 규칙:

- `dispose`는 instance가 만든 구독만 닫는다. Vite dev server가 watcher와 websocket을 소유한다. Saylo plugin과 코어는 공유 watcher·socket을 닫지 않고 자신이 등록한 listener, route, channel binding만 소유·해제한다.
- 서버 렌더링에서는 immutable한 요청 스냅샷을 그대로 쓴다. 서버 전역 `setLocale`을 두지 않는다.
- Vite plugin은 dev 서버 종료 시 자신이 등록한 listener, route, channel binding만 정리한다. 공유 watcher와 socket은 Vite가 소유하며 닫지 않는다.

## 개발 연결 (virtual module)

개발 서버는 세 가지를 클라이언트에 제공한다.

- `virtual:saylo`: 카탈로그 handle, `initialSnapshot`(BootSnapshot), `catalogSource`를 내보낸다.
- `catalogSource`(개발): 범용 `loadCatalog(locale, namespace)`가 현재 registry를 조회한다. 부팅 뒤에 새 namespace가 생겨도 기존 namespace별 loader map에 항목이 없어서 실패하지 않는다.
- `connectDev(instance)`: 어떤 instance를 갱신할지 plugin에 알린다. 이 호출이 없으면 plugin은 어느 store에 이벤트를 적용할지 알 수 없다. 개발에서만 호출한다.

- namespace manifest가 동적으로 늘거나 줄면 patch envelope의 `availableNamespaces`와 mutable manifest handle 갱신으로 전달한다. 개발 경로에는 정적 namespace map을 두지 않는다. 새 namespace 조회는 범용 `loadCatalog`가 모두 처리한다. 정적 loader map은 운영에서만 생성한다.
- 운영은 generated static loader map만 쓴다. 그 map도 같은 `CatalogSource` 인터페이스를 뒤에 둔다.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import saylo from "@0disoft/saylo-vite";

export default defineConfig({
  plugins: [
    saylo({
      localesDir: "locales",
      baseLocale: "ko",
      initialLocale: "ko",
      initialNamespaces: ["common", "cart"],
      timeZone: "UTC",
      // 생성물을 .ts 모듈로 두면 HMR 전파 대상이 되므로 .d.ts로 둔다.
      typegen: { outFile: "src/i18n/generated.d.ts" }
    })
  ]
});
```

## 예제

TS, generated 타입 사용:

```ts
// src/i18n/client.ts
import { createI18n } from "@0disoft/saylo-core";
import { initialSnapshot, catalogSource } from "virtual:saylo";
import type { AppSchema } from "./generated";

export const i18n = createI18n<AppSchema>({
  initialSnapshot,
  catalogSource,
  timeZone: "UTC"
});

i18n.t("cart:title");                          // 인자 없음
i18n.t("common:welcome", { name: "제로디" });  // 필수 인자
i18n.t("cart:items", { count: 3 });
// i18n.t("cart:items", { count: "3" });       // 타입 오류: count는 number
// i18n.t("common:welcome", {});               // 타입 오류: name 누락
// i18n.t("cart:missing");                     // 타입 오류: 알 수 없는 키

declare const key: "cart:title" | "cart:items";
// i18n.t(key);                                // 타입 오류: union 키는 먼저 좁혀야 한다
if (key === "cart:items") {
  i18n.t(key, { count: 3 });                  // narrowing 후 통과
}

await i18n.loadNamespace("cart");
await i18n.setLocale("en");                    // 허용 목록 밖이면 reject
```

JS, `checkJs`와 JSDoc으로 typed 사용. 타입 없는 경로가 아니라 선언을 그대로 쓴다:

```js
// src/i18n/client.js
// @ts-check
import { createI18n } from "@0disoft/saylo-core";
import { initialSnapshot, catalogSource } from "virtual:saylo";

/** @type {import('@0disoft/saylo-core').I18n<import('./generated').AppSchema>} */
export const i18n = createI18n({ initialSnapshot, catalogSource, timeZone: "UTC" });
```

```js
// src/main.js
import { i18n } from "./i18n/client.js";

i18n.subscribe(() => render());
await i18n.setLocale("en");   // subscribe가 이미 render하므로 다시 부르지 않는다
```

```ts
// src/i18n/dev.ts  (개발 엔트리에서만 import)
import { connectDev } from "@0disoft/saylo-vite/client";
import { i18n } from "./client";

connectDev(i18n);
```

React, factory가 같은 context로 Provider와 hook을 만든다:

```tsx
// src/i18n/react.ts
import { createSayloReact } from "@0disoft/saylo-react";
import type { AppSchema } from "./generated";

export const { SayloProvider, useI18n } = createSayloReact<AppSchema>();
```

```tsx
// src/main.tsx
import { SayloProvider, useI18n } from "./i18n/react";
import { i18n } from "./i18n/client";

root.render(
  <SayloProvider instance={i18n}>
    <App />
  </SayloProvider>
);

function CartSummary() {
  const { t } = useI18n();          // 이 렌더가 선택한 UI snapshot에 바인딩된다
  return (
    <>
      <h2>{t("cart:title")}</h2>
      <p>{t("cart:items", { count: 3 })}</p>
    </>
  );
}
```

## 갱신 프로토콜

patch, snapshot, boot 인코딩, 적용과 resync 규칙은 [08-update-protocol.md](08-update-protocol.md)가 단일 출처다. 이 문서는 중복 정의를 두지 않는다.
