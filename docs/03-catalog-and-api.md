# 03. 카탈로그와 API

이 문서는 카탈로그 파일 형식, ID·namespace 규칙, ICU 처리, argument 계약, 공개 API와 예제, 개발 서버 HMR 프로토콜을 정한다. 모듈 이름과 패키지 이름은 아직 확정되지 않은 제안이다.

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
| 콜론 `:` | namespace와 literal ID 안에 쓸 수 없다. 구분자 전용이다. |
| 점 `.` | literal 문자다. 계층 구분이 아니다. ID로 `cart.items`를 쓰면 주소는 `cart:cart.items`다. |

- (namespace, id) 쌍의 중복과 namespace 구분자 모호성을 금지한다. 서로 다른 locale에서 같은 주소를 쓰는 것은 정상이다.
- JSON 안에 같은 ID가 두 번 나오면 거부한다. `JSON.parse`만으로는 중복 키를 감지하지 못하므로(마지막 값이 남는다) parser 전처리로 중복을 감지한다.

## ICU 정책

- ICU MessageFormat 표준 문법을 쓴다. 변수, `number`, `date`, `time`, `select`, `plural`, `selectordinal`, `#`(plural offset), 중첩 폼을 대상으로 한다. 문법 정의는 [FormatJS ICU 문법](https://formatjs.github.io/docs/core-concepts/icu-syntax/)을 따른다.
- parser와 formatter는 검증된 라이브러리를 재사용한다. 초기 구현 선택은 `@formatjs/icu-messageformat-parser`와 `intl-messageformat`이다. `IntlMessageFormat`은 직렬화된 AST를 입력으로 받고 tag/`ignoreTag` 옵션을 지원한다([FormatJS intl-messageformat](https://formatjs.github.io/docs/intl-messageformat/)). 문법을 새로 발명하지 않는다.
- 태그는 parser의 `ignoreTag`를 켜서 literal 텍스트로 처리한다. rich text 컴포넌트 보간은 MVP에서 제외하고 순수 텍스트를 지원한다.
- 임의 JavaScript 실행, `eval`, 자동 HTML 주입을 하지 않는다.
- AST는 언어 간에 같아야 하지 않는다. 번역마다 구조와 분기가 달라도 된다. 요구사항은 같은 로케일·같은 메시지·같은 argument에 대해 개발과 운영이 같은 출력, 같은 오류, 같은 fallback을 내는 것(dev/prod parity)이다. 같은 Intl locale data와 같은 런타임 매트릭스에서 비교한다.

## argument 계약 (초기 설계 결정)

기준 로케일이 키와 argument 스키마의 원본이다. argument의 타입은 오직 기준(base) 메시지 안에서 그 argument가 나타나는 모든 사용의 교집합으로 정한다.

| 사용 형태 | 그 사용의 타입 |
| --- | --- |
| plain 변수 (`{name}`) | 문자열 또는 숫자 |
| `number`, `plural`, `selectordinal` | number |
| `date`, `time` | number 또는 Date |
| `select` | string |

- 기준 메시지 안에서 한 argument가 여러 형태로 쓰이면 각 사용 타입의 교집합을 최종 타입으로 삼는다. 예를 들어 기준에 `{count}`(plain)와 `{count, plural}`(number)가 함께 있으면 교집합은 number다. 교집합이 비면 오류다.
- 번역은 기준의 최종 타입을 전부 받아야 한다. 번역이 더 좁은 타입을 요구하면(기준 plain, 번역 plural) 오류다. 즉 번역의 accepted 타입은 기준 타입의 상위 타입이어야 한다.
- 번역이 같은 메시지에서 어떤 argument를 아예 쓰지 않는 것은 허용한다. 이는 키 자체가 없는 것(폴백 대상)과 다른 경우다.

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

정상 예, 번역 `locales/en/cart.json`. 기준 타입을 그대로 받고 일부 키·argument는 생략한다:

```json
{
  "title": "Cart",
  "items": "{count, plural, one {# item} other {# items}}"
}
```

`total`과 `when`은 번역에 없다. 이는 키 누락이라 접근 시 baseline 값으로 폴백한다. `items`는 plural이라 number 요구가 기준과 맞는다.

오류 예, 번역이 더 좁은 타입을 요구한다. 기준 `locales/ko/badge.json`:

```json
{
  "count": "총 {count}개"
}
```

기준 `count`는 plain이라 타입이 문자열 또는 숫자다. 번역`locales/en/badge.json`이 아래처럼 plural(number)을 요구하면 오류다.

```json
{
  "count": "{count, plural, one {# item} other {# items}}"
}
```

argument 없는 키는 그대로 호출한다. `t("cart:title")`.

## 포맷 캐시와 시간대

- 날짜·시간 포맷은 timeZone을 명시적으로 config에서 받는다. 기본값은 UTC를 권장한다. timeZone을 명시하지 않으면 서버 렌더링과 브라우저 렌더링 결과가 갈려 hydration 불일치가 난다.
- formatter 캐시 키는 locale, format, timeZone, catalog/schema revision을 함께 넣는다. 로케일이나 카탈로그가 바뀌면 캐시가 자동으로 무효화된다.
- baseline fallback으로 채워진 메시지는 baseline 로케일 기준으로 포맷한다. 이때 숫자·날짜 표기가 사용자가 고른 로케일의 기대와 다를 수 있음을 문서와 진단에 명시한다.

## revision의 두 종류

| 값 | 소유 | 용도 |
| --- | --- | --- |
| registry revision | 개발 서버/전역 | 카탈로그 전송(transport)의 순서를 맞춘다. patch의 `baseRevision`/`revision` 비교에 쓴다. |
| instance stateRevision | 클라이언트 instance | UI 구독 identity다. 로케일 전환과 카탈로그 반영이 이 값을 갱신한다. |

로케일 전환은 instance stateRevision만 올린다. 로케일 전환으로 registry revision을 올리지 않는다. 두 값을 한 카운터로 합치면 로케일 전환이 카탈로그 전송 순서를 흔들어 patch 적용이 어긋난다.

## 공개 API

초기 구현 선택은 동기 생성 + 명시적 로드다. 부팅에 필요한 로케일과 namespace는 `initialSnapshot`으로 함께 넘기고, 나머지는 필요할 때 로드한다. async 생성 함수는 두지 않는다.

schema는 런타임 옵션이 아니라 타입 전용 제네릭이다. 런타임 schema는 `initialSnapshot`의 baseline AST와 accepted schema 메타데이터에서 얻는다. `createI18n`에 schema 객체를 넘기지 않는다.

```ts
type Revision = number;

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

// Catalog, MessageAst의 내부 표현은 생략한다.
// Catalog는 ID -> MessageAst 맵이고 MessageAst는 FormatJS AST 노드다.
type Catalog = Readonly<Record<string, unknown>>;

// 로더는 어느 revision의 카탈로그인지 함께 돌려준다. 그래야 로드 결과가 낡았는지 검사할 수 있다.
interface LoadedCatalog {
  locale: string;
  namespace: string;
  revision: Revision;
  schemaRevision: Revision;
  catalog: Catalog;
}

type CatalogLoader = (locale: string, namespace: string) => Promise<LoadedCatalog>;

interface Snapshot {
  locale: string;                         // 현재 로케일
  baseLocale: string;
  availableLocales: readonly string[];
  loadedNamespaces: readonly string[];
  registryRevision: Revision;             // 서버 전송 revision (wire의 revision)
  stateRevision: Revision;                // instance UI 구독 identity
  schemaRevision: Revision;               // accepted base schema revision
  catalogs: ReadonlyMap<string, Catalog>; // "<locale>:<namespace>" -> Catalog
}

interface CreateI18nOptions {
  initialSnapshot: Snapshot;
  loaders?: Record<string, CatalogLoader>; // namespace -> 로더
  timeZone?: string;                       // 기본 "UTC"
  fallbackLocale?: string;                 // 기본은 기준 로케일
}

interface I18n<S extends Schema> {
  t<K extends keyof S & string>(
    key: K,
    ...args: string extends keyof S
      ? [args?: Record<string, unknown>]      // 무타입: 인자 optional
      : keyof S[K] extends never
        ? []                                  // typed: 인자 없는 키
        : [args: S[K]]
  ): string;
  setLocale(locale: string): Promise<void>;   // 허용 목록 밖이면 reject
  getLocales(): readonly string[];
  getSnapshot(): Snapshot;                    // 변할 때만 새 참조, 아니면 동일 참조
  subscribe(listener: (snapshot: Snapshot) => void): () => void;
  loadNamespace(namespace: string): Promise<void>;
  dispose(): void;                            // 이 instance가 소유한 브라우저 리스너만 정리
}

declare function createI18n<S extends Schema = UntypedSchema>(
  options: CreateI18nOptions
): I18n<S>;
```

Snapshot의 `catalogs`는 wire의 `catalogs` 배열을 normalization으로 복원한 `ReadonlyMap`이다. wire payload를 `JSON.stringify(Map)` 한 결과로 만들지 않는다.

소유권 규칙:

- `dispose`는 instance가 만든 브라우저 리스너만 닫는다. Vite dev 서버 watcher나 websocket은 plugin이 소유한다. 코어가 개발 서버 socket을 닫지 않는다.
- 서버 렌더링에서는 immutable한 요청 스냅샷을 그대로 쓴다. 서버 전역 `setLocale`을 두지 않는다.
- Vite plugin은 dev 서버 종료 시 자기 watcher와 채널을 직접 정리한다.

## 개발 연결 (virtual module)

개발 서버는 두 가지를 클라이언트에 제공한다.

- `virtual:saylo`: 카탈로그 handle과 `initialSnapshot`, `loaders`를 내보낸다.
- `connectDev(instance)`: 어떤 instance를 갱신할지 plugin에 알린다. 이 호출이 없으면 plugin은 어느 store에 이벤트를 적용할지 알 수 없다. 개발에서만 호출한다.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import saylo from "@saylo/vite";

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
import { createI18n } from "@saylo/core";
import { initialSnapshot, loaders } from "virtual:saylo";
import type { AppSchema } from "./generated";

export const i18n = createI18n<AppSchema>({
  initialSnapshot,
  loaders,
  timeZone: "UTC"
});

i18n.t("cart:title");                          // 인자 없음
i18n.t("common:welcome", { name: "제로디" });
i18n.t("cart:items", { count: 3 });
// i18n.t("cart:items", { count: "3" });       // 타입 오류: count는 number
// i18n.t("common:welcome", {});               // 타입 오류: name 누락

await i18n.loadNamespace("cart");
await i18n.setLocale("en");                    // 허용 목록 밖이면 reject
```

```ts
// src/i18n/dev.ts  (개발 엔트리에서만 import)
import { connectDev } from "@saylo/vite/client";
import { i18n } from "./client";

connectDev(i18n);
```

JS, 타입 없음. 별도 부트스트랩 파일을 쓴다:

```js
// src/i18n/client.js
import { createI18n } from "@saylo/core";
import { initialSnapshot, loaders } from "virtual:saylo";

export const i18n = createI18n({ initialSnapshot, loaders, timeZone: "UTC" });
```

```js
// src/main.js
import { i18n } from "./i18n/client.js";

i18n.subscribe(() => render());
await i18n.setLocale("en");   // subscribe가 이미 render하므로 다시 부르지 않는다
```

React, Provider와 hook:

```tsx
import { SayloProvider, useI18n } from "@saylo/react";
import { i18n } from "./i18n/client";

root.render(
  <SayloProvider instance={i18n}>
    <App />
  </SayloProvider>
);

function CartSummary() {
  const { t } = useI18n();
  return (
    <>
      <h2>{t("cart:title")}</h2>
      <p>{t("cart:items", { count: 3 })}</p>
    </>
  );
}
```

## HMR 프로토콜

최소 형태는 다음과 같다. 검증 전 제안이다.

```ts
type SessionId = string;
type Revision = number;

interface CatalogKey { locale: string; namespace: string; }

// FormatJS AST 요소 배열. 형태는 FormatJS 파서 출력 계약을 따른다.
type SerializedMessageAst = ReadonlyArray<unknown>;

interface SerializedCatalog {
  revision: Revision;                          // 이 카탈로그 자체의 revision
  schemaRevision: Revision;                    // 이 카탈로그가 맞춘 accepted base schema
  messages: Record<string, SerializedMessageAst>;
}

interface CatalogPatch {
  kind: "patch";
  sessionId: SessionId;
  baseRevision: Revision;                      // 적용 조건: 현재 registry revision과 같아야 함
  revision: Revision;                          // 적용 후 registry revision
  locales: readonly string[];                  // 변한 로케일 목록
  schemaRevision: Revision;                    // accepted schema revision
  replacements: Array<{ key: CatalogKey; catalog: SerializedCatalog }>;
  deletions: CatalogKey[];
}

interface CatalogSnapshot {
  kind: "snapshot";
  sessionId: SessionId;
  revision: Revision;
  baseLocale: string;
  locales: readonly string[];
  loadedNamespaces: readonly string[];
  schemaRevision: Revision;
  catalogs: Array<{ key: CatalogKey; catalog: SerializedCatalog }>;
}

type DevEvent = CatalogPatch | CatalogSnapshot;
```

`replacements`는 영향받은 카탈로그 전체를 담는다. 삭제는 `deletions`에 명시한다. snapshot은 initial locale과 baseLocale 각각에 대해 `loadedNamespaces`에 있는 카탈로그들을 포함한다. secondary에 그 namespace 파일이 없으면 base 카탈로그만 포함한다.

`initialNamespaces`의 common과 cart가 initial snapshot에 들어가므로 `t("cart:items")`는 별도 `loadNamespace` 없이 동작한다. 나머지 namespace는 사용 전에 `loadNamespace`로 지연 로드한다.

이벤트 예(`title`은 argument가 없어 AST가 텍스트 노드 하나다):

```json
{
  "kind": "patch",
  "sessionId": "s-7f3a",
  "baseRevision": 41,
  "revision": 42,
  "locales": ["ko"],
  "schemaRevision": 7,
  "replacements": [
    {
      "key": { "locale": "ko", "namespace": "cart" },
      "catalog": {
        "revision": 42,
        "schemaRevision": 7,
        "messages": { "title": [{ "type": 0, "value": "장바구니" }] }
      }
    }
  ],
  "deletions": []
}
```

적용 순서:

1. 커스텀 이벤트 리스너를 먼저 등록한다. 그다음 full snapshot을 요청한다.
2. snapshot이 도착하기 전에 들어온 patch는 버퍼에 담는다.
3. snapshot이 오면 sessionId, registry revision, schemaRevision, locales, baseLocale, loadedNamespaces를 기록한다. 버퍼의 patch 중 sessionId가 같고 `baseRevision`이 현재 registry revision과 맞고 revision이 이어지는 것만 적용한다. 중복·역순·오래된 patch는 버린다(discard).
4. envelope(sessionId, revision, locales, schemaRevision) 반영과 payload 적용은 하나의 transaction 안에서 이 순서로 처리한다. 그래야 registry 진행이 특정 카탈로그 로드에 막히지 않는다.
5. 새 스냅샷은 transaction이 끝날 때 한 번만 통지한다. 중간 상태(새 schemaRevision과 옛 catalog가 섞인 값)를 구독자에게 노출하지 않는다.
6. payload는 이미 로드된 카탈로그에만 적용한다. 아직 로드하지 않은 카탈로그는 dirty로 표시하고 그 카탈로그의 최신 revision만 기록한 뒤 payload는 버린다.
7. 이후 `loadNamespace`는 최신 registry에서 카탈로그를 받아 자기 revision을 검사한다. 낡은(obsolete) 로드 결과는 버리고 다시 조회한다.
8. resync(full snapshot 재요청)는 새 세션이거나 revision gap일 때만 한다. 중복·오래된 patch는 resync가 아니라 discard다.

registry revision은 전송 순서용이고, instance stateRevision은 UI 구독용이다. 로케일 전환은 stateRevision만 올린다.
