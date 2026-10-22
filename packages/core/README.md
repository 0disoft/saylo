# @0disoft/saylo-core

Saylo 코어 패키지다. 카탈로그 파싱과 스키마 검증, 동기 번역기, eager store, 지연 로딩 i18n, SSR boot 직렬화를 제공한다. DOM이나 특정 프레임워크에 의존하지 않는다.

## 상태

마지막으로 게시를 확인한 버전은 2026-10-11의 `0.1.0-alpha.4`(dist-tag `alpha`)다. 첫 게시 버전은 2026-10-06의 `0.1.0-alpha.1`이다. 이 저장소의 workspace에서 쓰거나 `npm pack`으로 만든 tarball을 설치할 수도 있다.

React·Svelte selector 미세구독(`useI18nSelector`, `selectSvelteStore`·`getI18nSelector`)은 `0.1.0-alpha.4` 게시본에 포함된다.

이 README 수정은 다음 배포에 포함된다.

## 설치

```sh
npm install @0disoft/saylo-core@alpha
```

`latest`는 아직 등록용 placeholder를 가리키므로 `@alpha`를 지정한다. 앱 런타임 의존성(`dependencies`)으로 설치한다.

## 사용

`parseCatalog`로 로케일별 카탈로그를 파싱하고 `createStore`로 즉시 쓸 수 있는 store를 만든다.

```js
import { parseCatalog, createStore } from '@0disoft/saylo-core';

const base = parseCatalog('{"items":"{count, number}개"}', {
  locale: 'ko', namespace: 'cart', sourceName: 'locales/ko/cart.json',
});
const translation = parseCatalog('{"items":"{count, plural, one {# item} other {# items}}"}', {
  locale: 'en', namespace: 'cart', sourceName: 'locales/en/cart.json',
});

const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: [base, translation] });

store.t('cart:items', { count: 3 });                 // "3 items"
store.getSnapshot().t('cart:items', { count: 1 });   // snapshot에 고정된 읽기
store.setLocale('ko');
store.dispose();
```

메시지는 ICU MessageFormat이다. `{count, number}` 같은 변수는 호출 인자로 채운다. 기준 스키마에 없는 키는 `UnknownMessageError`, 인자 누락이나 타입 오류는 `InvalidArgumentError`다. 없는 번역은 기준 로케일 문구로 폴백한다. `createStore`는 카탈로그를 게시 전에 검증하고, 표시 상태가 같으면 `getSnapshot()`이 같은 객체를 돌려준다.

`store.subscribe(snapshot => ...)`로 변경을 구독하고 `onDispose(cleanup)`으로 소유 자원 정리를 등록한다. 더 이상 쓰지 않으면 `store.dispose()`를 호출한다.

TypeScript에서는 `createStore<AppSchema>(...)`로, JS에서는 JSDoc `Store<AppSchema>`로 키와 인자 타입을 연결한다. `AppSchema`는 [@0disoft/saylo-typegen](https://github.com/0disoft/saylo/tree/main/packages/typegen#readme)으로 생성하거나 직접 작성한다. 타입을 지정하지 않아도 동작한다.

지연 로딩은 `createI18n`이 담당하고 카탈로그 전송 source는 [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme)가 제공한다. 요청별 SSR은 `createServerI18n`, boot 직렬화는 `serializeBootSnapshot`·`decodeBootSnapshot`이다.

미게시 소스는 `setLocale(locale, { signal })`, `loadNamespace(namespace, { signal })`, `refresh({ signal })`을 지원한다. 이 signal은 해당 호출자의 대기만 취소하며, 공유 catalog load와 요청한 화면 상태 전환은 계속된다. 실패는 `CatalogLoadError`의 `code: 'ABORTED'`, `cause: signal.reason`으로 전달된다. 인스턴스 전체를 정리하려면 `dispose()`를 호출하거나 `createI18n`·`createServerI18n`의 options에 수명용 `signal`을 넘긴다. 수명 취소로 진행 중인 API 호출은 `I18nDisposedError`로 끝나고, SSR 준비 중 취소는 `ABORTED`로 끝난다.

미게시 `setNamespaces(namespaces, { signal })`은 현재 화면의 필수 namespace 전체를 교체한다. `await i18n.setNamespaces(['common', 'editor'])`처럼 호출하면 이전 화면의 namespace는 언어 전환의 대기 대상에서 빠지고, 이미 받은 카탈로그는 캐시에 남는다. `[]`도 허용한다. 교체로 제외된 namespace 요청과 이전 범위 요청은 `SCOPE_SUPERSEDED`로 거부한다. 배열 순서는 무관하고, 중복·없는 namespace는 상태 변경 전에 거부한다. React·Svelte·Vue 바인딩과 React hydration adapter에서도 이 메서드를 전달한다.

두 factory의 선택적 `schedule(milliseconds, callback)`은 테스트에서 타이머를 제어할 때 쓴다. callback을 나중에 실행하고 여러 번 호출해도 안전한 취소 함수를 반환해야 한다. `requestTimeoutMs`는 유한한 양수부터 `2,147,483,647`까지 허용하며 소수는 올림한다. 표시 상태가 바뀌어 revision이 안전 정수 범위를 넘게 되면 `REVISION_OVERFLOW`로 거부하고 기존 snapshot과 boot를 유지한다.

브라우저 런타임에서 `parseCatalog`를 빼려면 `@0disoft/saylo-core/runtime` 서브패스 엔트리를 쓴다. 여기에는 `parseCatalog`가 없고 나머지 API는 루트 엔트리와 같다. 루트 엔트리 `@0disoft/saylo-core`는 기존 API를 그대로 유지한다. 이 서브패스는 `0.1.0-alpha.2` 게시본에 포함된다.

## 로케일 해석

`resolveLocale(candidates, supported, fallback)`은 후보를 앱이 정한 순서대로 보고, 지원 목록에 있는 canonical tag를 정확히 일치시킨 뒤 부모 tag로만 넓힌다. 예를 들어 지원 목록에 `en`만 있으면 `en-GB`는 `en`으로 해석하지만, `en-US`만 있으면 `en`이나 `en-GB`를 임의로 `en-US`에 맞추지 않는다. 형식이 잘못된 후보는 건너뛴다. 지원 로케일이 잘못되었거나 canonical tag가 중복되거나 fallback이 지원 목록에 없으면 `RangeError`를 던진다.

`parseAcceptLanguage(header)`는 `{ range, quality }`의 동결된 배열을 품질 내림차순으로 돌려주며 같은 품질은 헤더 순서를 유지한다. 잘못된 항목은 건너뛰고 `q=0` 항목은 제외 정보를 잃지 않도록 남긴다. `resolveAcceptLanguage(header, supported, fallback)`는 가장 구체적인 `q=0` 범위를 제외로 적용한다. 같은 구체성에서 양수와 0이 겹치면 0이 이긴다. wildcard는 명시 범위를 모두 살핀 뒤 기본값을 고른다. 수용 가능한 값이 없으면 HTTP 406 대신 앱 fallback을 반환한다.

세 함수와 `LanguagePreference` 타입은 `@0disoft/saylo-core`와 parser를 포함하지 않는 `@0disoft/saylo-core/runtime` 모두에서 제공한다. 이 API는 로컬 미게시이며 `0.1.0-alpha.4`에는 없다.

## Rich text parts

`tParts(key, args)`는 `t()`와 같은 메시지·인자 계약을 쓰면서 결과를 읽기 전용 parts 트리로 돌려준다. `t()`는 문자열과 literal 태그를 그대로 유지한다.

```js
import { parseCatalog, createStore } from '@0disoft/saylo-core';

const ko = parseCatalog('{"bold":"<strong>{name}</strong>님, 안녕하세요"}', {
  locale: 'ko', namespace: 'common', sourceName: 'locales/ko/common.json',
  richText: { bold: ['strong'] }, // 선택: 카탈로그 수용 전에 구조·허용 태그 검사
});
const richStore = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [ko] });

richStore.tParts('common:bold', { name: '제로디' });
// [
//   { type: 'tag', name: 'strong', children: [{ type: 'text', value: '제로디' }] },
//   { type: 'text', value: '님, 안녕하세요' },
// ]
richStore.dispose();
```

parts는 `{ type: 'text', value }`와 `{ type: 'tag', name, children }` 두 형태이고 깊게 동결된다. attribute 없는 짝 마커(`<name>`·`</name>`)만 구조로 해석한다. attribute가 붙은 마커와 self-closing 마커는 literal text로 남고, 어긋나거나 닫히지 않거나 ICU 분기 경계를 가로지르는 구조는 `InvalidRichTextError`를 던진다(`richText` 사전 검증을 지정하지 않은 경우 `tParts`에만 적용). `richText`를 지정한 메시지는 수용 단계에서 `INVALID_RICH_TEXT` 진단으로 거부하며, 기준 rich 계약은 번역 검증에도 적용한다. 인자 값에 들어온 `<`·`>`는 text로 남는다. 링크·HTML attribute는 앱이 허용 목록에 넣은 tag 이름만 자기 element로 매핑할 때 붙인다. 번역에서 온 이름으로 임의의 HTML element를 만들지 않는다. 마커 문법·오류·예제는 [rich text parts 기록](../../docs/78-rich-text-parts.md)에 있다. 이 API는 `0.1.0-alpha.4` 게시본에 없고 로컬 `npm run check`로 검증했다.

## 전송 카탈로그 동결

`freezeCatalogs(catalogs)`는 JSON 전송 뒤 카탈로그 배열·AST·위치·인자 스키마를 깊게 동결하고 같은 배열을 반환한다. 루트와 `/runtime` 엔트리에서 제공한다. 같은 core 모듈이 이미 깊게 동결한 객체는 재순회하지 않으며, 외부에서 겉만 동결한 객체는 내부까지 순회한다. 유효성 검사는 기존 decoder·store·i18n에서 수행한다. 이 함수는 `0.1.0-alpha.2` 게시본에 포함되며 구현과 측정은 [동결 경로 공유 기록](../../docs/26-shared-catalog-freeze.md)과 [개발 prebundle 공유 기록](../../docs/30-prebundle-freeze-sharing.md)에 있다.

## 로컬 파싱 최적화

`parseCatalog`는 일반 텍스트와 ASCII `{name}` 보간에 내부 빠른 경로를 쓴다. AST·위치·인자 추론·불변성은 기존 계약을 유지하며, 아포스트로피·복잡한 ICU·범위 밖 인자는 FormatJS가 처리한다. 공개 API 옵션은 추가하지 않았다. 이 최적화는 `0.1.0-alpha.2` 게시본에 포함되며, 측정과 한계는 [설계 기록](../../docs/15-simple-message-parser.md)에 있다.

## 관련 패키지

- [@0disoft/saylo-react](https://github.com/0disoft/saylo/tree/main/packages/react#readme) — React 19 바인딩
- [@0disoft/saylo-typegen](https://github.com/0disoft/saylo/tree/main/packages/typegen#readme) — 기준 카탈로그 타입 선언 생성
- [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme) — Vite 플러그인과 dev client

## 문서

- [카탈로그와 API](https://github.com/0disoft/saylo/blob/main/docs/03-catalog-and-api.md)
- [라이브 반영과 타입](https://github.com/0disoft/saylo/blob/main/docs/04-live-update-and-types.md)
- [운영 빌드와 SSR](https://github.com/0disoft/saylo/blob/main/docs/05-build-and-ssr.md)
- 저장소 [README](https://github.com/0disoft/saylo#readme)

## 버전

Node.js 24.x를 지원한다. `engines.node`는 `24.x`이고 로컬 검증 환경은 Node 24.18.0이다. TypeScript 7을 기준으로 검증하지만 `typescript`를 peer로 강제하지 않는다.

런타임 target은 ES2022이고 브라우저 대상이라 Node API에 의존하지 않는다. 이 패키지에는 런타임 peer 의존성이 없다.

## 문의와 보안 제보

일반 문의·기능 제안·버그는 [rodisoft1@gmail.com](mailto:rodisoft1@gmail.com)으로 보낸다. 패키지·버전, 환경, 기대한 동작과 실제 동작, 합성 데이터로 만든 최소 재현을 적는다. 보안 문제도 같은 이메일에 `Saylo security` 제목으로 비공개 제보한다. 토큰·키·쿠키·실제 사용자 데이터는 보내지 않는다.

Vite 패키지를 설치했다면 `node_modules/@0disoft/saylo-vite/docs/support.md`와 `security.md`에서 자세한 안내를 읽을 수 있다. 이 안내와 연락처 변경은 현재 checkout과 `0.1.0-alpha.5` 후보 tarball에 포함하며 기존 alpha.4 tarball에는 없다. 후보는 아직 npm에 게시하지 않았다.

## 라이선스

Apache-2.0이다. 배포 tarball에 저장소 루트의 `LICENSE`와 `NOTICE`를 함께 싣는다.
