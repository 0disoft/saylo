# 78. Rich text parts (`tParts`)

이 문서는 첫 rich text core API 슬라이스의 계약과 사용법을 정한다. 기존 `t()`가 문자열을 돌려주는 동작은 그대로 두고, 같은 메시지에서 읽기 전용 parts 트리를 얻는 `tParts(key, args)`를 core에 더한다.

상태: 로컬 구현과 `npm run check`·독립 JS/TS pack 소비 검증을 마쳤다. 게시본에는 이 API가 없다. 카탈로그·wire metadata를 추가하지 않고, 버전 승격과 게시도 하지 않는다.

## 범위

- `tParts(key, args)`를 `Translator`·`Store`·`StoreSnapshot`·`I18n`에 더한다.
- 인자 계약(`TypedCall`), 필수 인자 검증, 기준 로케일 폴백, 소스 locale, timeZone 처리는 `t()`와 같은 경로를 쓴다.
- 반환값은 깊게 동결한 읽기 전용 `RichTextPart[]`다.
- 이 슬라이스에 넣지 않는 것: 인자로 컴포넌트를 넘기는 보간, 자동 HTML 렌더, React·Svelte·Vue render helper, 실제 브라우저 UI 데모. 프레임워크 helper와 데모는 다음 슬라이스다. 훅 사용자는 기존 snapshot에서 `tParts`를 그대로 얻는다.

## API

```ts
type RichTextPart =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'tag'; readonly name: string; readonly children: readonly RichTextPart[] };

// 키와 인자의 상관관계는 t()와 같은 TypedCall tuple을 쓴다.
type TranslateParts<S extends Schema> =
  string extends keyof S
    ? (key: string, args?: Record<string, unknown>) => readonly RichTextPart[]
    : (...call: TypedCall<S>) => readonly RichTextPart[];
```

`t()`는 문자열과 literal 태그를 그대로 유지한다. `tParts()`는 같은 메시지를 마커 단위로 나누고, 없는 번역은 기준 로케일 문구로 폴백한다.

| 노출 위치 | 바인딩 |
| --- | --- |
| `Translator.tParts` | 그 translator의 로케일·카탈로그 |
| `Store.tParts` | 최신으로 커밋된 snapshot |
| `StoreSnapshot.tParts` | 그 snapshot에 고정 |
| `I18n.tParts` | 최신으로 커밋된 snapshot |

## 마커 문법

- 정확히 `<NAME>` 여는 마커와 `</NAME>` 닫는 마커만 해석한다.
- `NAME`은 ASCII 영문자로 시작하고 영문자·숫자·밑줄·하이픈이 이어질 수 있다.
- 해석 대상은 parser가 만든 literal 요소뿐이다. 인자로 들어온 값은 문법 해석 스캔에 들어가지 않는다.
- 중첩 태그와 같은 이름의 반복 태그를 지원한다.
- ICU plural·select 분기 안의 태그도 지원한다. 분기는 자기 안에서 balanced여야 한다.
- attribute가 붙은 마커(`<a href="/">`)와 self-closing 마커(`<br/>`)는 구조로 해석하지 않는다. 각각이 따로 literal text로 남는다.
- 지원하는 구조는 attribute 없는 여는·닫는 짝 마커뿐이다. 링크·attribute·URL은 앱이 허용 목록에 넣은 tag 이름만 자기 element로 매핑할 때 붙인다. 번역에서 온 이름으로 임의의 HTML element를 만들지 않는다.
- 밑줄로 시작하는 이름(`<__proto__>`)은 여는 마커 규칙에 맞지 않으므로 literal text다.

## 오류

여는 순서와 닫는 이름이 어긋나거나(`<a>word</b>`), 닫히지 않거나(`<a>word`), 태그가 ICU 분기 경계를 가로지르면 `InvalidRichTextError`를 던진다. 오류 객체는 `key`에 `"<namespace>:<id>"`를 담는다.

ICU 식 전체를 `<link>{n, plural, other {# items}}</link>`처럼 감싸는 것은 허용한다. 분기 밖에서 연 태그를 분기 안에서 닫거나 그 반대로 짝을 맺는 구조는 허용하지 않는다.

attribute가 붙은 여는 마커는 구조가 아니라 literal text다. 그래서 `<a href="/">x</a>`에서 여는 `<a href="/">`는 그대로 남지만 짝 없는 닫는 `</a>`가 매칭되지 않아 오류가 난다. attribute 없는 짝 마커만 구조로 지원하고, href와 나머지 HTML attribute는 앱 매핑이 붙인다.

이 오류는 `tParts()`에만 적용한다. 같은 메시지에서도 `t()`는 문자열을 계속 돌려준다.

## 인자와 마커의 관계

- 인자 값에 `<`와 `>`가 들어 있어도 text로만 남는다.
- 같은 이름의 scalar 인자와 태그를 함께 쓸 수 있다(예: 인자 `name`과 태그 `<name>`).
- 내부 callback 이름은 인자 키와 충돌하지 않는 별칭으로 투영한다.

## ICU 인용과 escape

ICU 인용은 parser가 이미 해소한다. 그 결과 남은 literal 마커를 `tParts()`가 해석한다. literal `<...>` 텍스트를 그대로 보여주려면 `t()`를 쓴다. 새 escape 문법을 만들지 않는다.

## 포맷·캐시·폴백

- FormatJS AST 포맷과 기존 `Intl` 캐시를 재사용한다. timeZone, 소스 locale, 필수 인자 검증, 기준 로케일 폴백은 `t()`와 같다.
- `/runtime` 엔트리와 Vite production 번들에 ICU parser를 추가하지 않는다.
- 잘못된 구조로 `tParts()`가 실패해도 다음 정상 카탈로그에서 복구한다. 실패한 시도는 캐시를 오염시키지 않는다.

## 예제

중첩·반복 태그. 기준 카탈로그:

```json
{ "x": "Hello <link><strong>{name}</strong></link> / <link>again</link>" }
```

```ts
i18n.t('demo:x', { name: 'Zed' });
// 'Hello <link><strong>Zed</strong></link> / <link>again</link>'

i18n.tParts('demo:x', { name: 'Zed' });
// [
//   { type: 'text', value: 'Hello ' },
//   { type: 'tag', name: 'link', children: [
//     { type: 'tag', name: 'strong', children: [{ type: 'text', value: 'Zed' }] },
//   ] },
//   { type: 'text', value: ' / ' },
//   { type: 'tag', name: 'link', children: [{ type: 'text', value: 'again' }] },
// ]
```

plural 분기 안의 태그:

```json
{ "x": "{n, plural, offset:1 =0 {<em>none</em>} one {<em># item</em>} other {<em># items</em>}}" }
```

```ts
i18n.tParts('demo:x', { n: 3 });
// [{ type: 'tag', name: 'em', children: [{ type: 'text', value: '2 items' }] }]

i18n.tParts('demo:x', { n: 0 });
// [{ type: 'tag', name: 'em', children: [{ type: 'text', value: 'none' }] }]
```

인자 값은 text로 남는다:

```json
{ "x": "Hi <b>{name}</b>" }
```

```ts
const name = '<script>alert(1)</script>';
i18n.tParts('demo:x', { name });
// [
//   { type: 'text', value: 'Hi ' },
//   { type: 'tag', name: 'b', children: [{ type: 'text', value: name }] },
// ]
```

attribute나 self-closing이 붙은 마커는 구조가 아니다. `<br/>`는 그대로 literal text로 남고, `<a href="/">x</a>`처럼 여는 쪽에 attribute가 붙으면 여는 마커는 literal이 되지만 짝 없는 `</a>`가 매칭되지 않아 오류가 난다.

```json
{ "br": "line<br/>break", "link": "<a href='/'>x</a>", "broken": "<a>word</b>" }
```

```ts
i18n.tParts('demo:br');
// [{ type: 'text', value: 'line<br/>break' }]

i18n.tParts('demo:link');     // InvalidRichTextError, key 'demo:link'
i18n.tParts('demo:broken');   // InvalidRichTextError, key 'demo:broken'
i18n.t('demo:broken');        // '<a>word</b>'
```

parts는 DOM이 아니라 값이다. 태그를 어떤 element로 그릴지, 어떤 attribute·URL을 붙일지는 앱이 정한다. 앱은 자기 화면이 허용한 tag 이름만 매핑하고, 번역에서 온 이름으로 임의의 HTML element를 만들지 않는다. Saylo는 HTML을 만들지 않는다.

```ts
// 앱 코드. Saylo API가 아니다.
const allowed = { strong: Strong, em: Em, link: Link };   // 앱이 허용한 tag만 넣는다

for (const part of i18n.tParts('demo:x', { name })) {
  if (part.type === 'text') appendText(part.value);
  else if (allowed[part.name]) appendElement(allowed[part.name], part.children);
  else appendChildren(part.children);   // 허용 목록 밖 tag는 자식만 그린다
}
```

## 검증

로컬 구현을 마쳤고 `npm run check`가 exit 0으로 통과했다(290개 테스트, 로그 `.release/rich-text-check.log`). 여섯 workspace build, JS·TS 소비 타입 검사, Vite production에서 rich parts AST runtime과 일반 경로의 출력 일치, AST 번들에 parser 부재까지 포함한다. `npm exec -- node scripts/pack-smoke.mjs`도 exit 0으로 통과했다(로그 `.release/rich-text-pack.log`). 다섯 tarball의 독립 JS·TS 설치에서 새 core·runtime API를 실행했고, 기존 SSR·selector·Vite lazy 소비도 통과했다. 확인 범위는 다음과 같다.

- JS·TS 소비에서 `tParts` 타입과 반환 형태.
- 중첩·ICU 분기 포맷, 기준 로케일 폴백, UTC, boot snapshot.
- 라이브 store 카탈로그 교체와 옛 snapshot 고정.
- parser가 없는 Vite production과 루트 엔트리의 동작 일치.

## 다음 단계

React render helper와 실제 Chromium 데모는 로컬에서 완료했다. [79-react-rich-text.md](79-react-rich-text.md)가 `renderRichText`의 계약과 React 데모를 정한다. 게시본에는 없다. 남은 단계는 Svelte·Vue render helper다. 훅은 기존 snapshot의 `tParts`를 그대로 쓴다.
