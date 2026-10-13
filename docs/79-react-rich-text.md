# 79. React rich text render (`renderRichText`)

이 문서는 core `tParts`가 돌려준 parts를 React 노드로 그리는 render helper의 계약과 데모를 정한다. core의 `tParts`는 그대로 두고, React 패키지가 `renderRichText(parts, renderers)`를 더한다.

상태: 로컬 구현과 아래 검증을 마쳤다. 게시본에는 이 helper가 없다. 버전 승격과 게시는 보류 중이다.

## 범위

- `@0disoft/saylo-react`가 `renderRichText`와 타입 `RichTextRenderers`를 내보낸다.
- 입력은 core `tParts`가 돌려준 읽기 전용 `RichTextPart[]`이고, 인자·필수 인자 검증·기준 로케일 폴백·소스 locale·timeZone 계약은 core와 같다. 훅은 기존 snapshot의 `tParts`를 그대로 쓴다.
- helper는 순수 함수다. props·state·store를 읽지 않고, 넘긴 parts와 renderers만으로 노드를 만든다.
- 이번 범위에 넣지 않는 것: Svelte·Vue render helper, 자동 HTML 렌더, parts에서 attribute·URL을 만드는 동작. Svelte·Vue helper는 다음 단계다.

## API

```ts
type RichTextRenderers = Readonly<Record<string, (children: ReactNode) => ReactNode>>;

function renderRichText(parts: readonly RichTextPart[], renderers?: RichTextRenderers): ReactNode;
```

`renderers`를 주지 않으면 빈 객체로 본다.

## 렌더 계약

- text part는 그대로 React text가 된다. React가 escape하므로 HTML로 해석되지 않는다.
- tag part는 그 이름이 `renderers`의 own property이고 값이 함수일 때만 그 함수 결과로 바뀐다. 없거나 함수가 아니면 태그 자체를 만들지 않고 자식만 이어 그린다.
- 함수 조회는 own property만 본다. `constructor`·`toString`처럼 prototype에서 상속된 이름은 매핑으로 쓰지 않고 자식만 그린다.
- 카탈로그에서 온 이름으로 임의의 DOM 태그, HTML, attribute, URL을 만들지 않는다. 링크·attribute·URL은 앱이 자기 목록에 넣은 이름에만 붙인다.
- 중첩 태그를 지원한다. 안쪽 tag도 같은 규칙으로 매핑한다.
- attribute가 붙은 여는 마커와 self-closing 마커(`<br/>`)는 구조가 아니라 literal text로 남는다. 여는 마커가 literal이 되면 짝 없는 닫는 마커가 매칭되지 않아 `InvalidRichTextError`가 날 수 있다. 어긋나거나 닫히지 않은 구조도 오류다. 이 판정은 core `tParts`가 한다. helper는 유효한 parts만 받는다.

## 키와 identity

반환 노드의 Fragment key는 tag 이름과 그 이름의 등장 순번을 합쳐 만든다(`link:0`, `link:1`). 같은 이름의 두 번째 태그가 첫 번째와 다른 key를 갖는다. 문구나 literal을 삽입·편집해도 매핑된 컴포넌트 identity가 유지된다.

renderers 콜백은 같은 tag에 대해 같은 element·component 타입을 돌려줘야 한다. 타입이 바뀌면 React가 다시 mount해 입력·포커스·state가 사라진다.

## 데모 (rich-preview)

공유 카탈로그 `examples/vanilla/locales/ko/demo.json`과 `en/demo.json`에 rich 키를 더한다.

```json
{ "rich": "<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요." }
```

```json
{ "rich": "<strong>{name}</strong>, review <link>your order</link>." }
```

React 데모는 `strong`을 `<strong>`에, `link`를 `<a href="#order-form">`에 매핑한다. 미리보기 노드의 id는 `rich-preview`이고, 링크는 같은 화면의 주문 폼(`#order-form`)으로 간다. 이름 입력이 비어 있으면 화면은 `Saylo`를 쓴다.

`projectDemoMessages`는 전체 번역 투영과 마지막 정상 상태 fallback 모두에 rich parts를 담는다. malformed 태그 뒤에도 이름·수량·입력 변경은 마지막 정상 snapshot을 다시 포맷한다.

`selected-keys.mts`의 `demoKeys`에 `demo:rich`를 더한다. 생성 타입은 `"demo:rich": { "name": string | number; }`이다. 이 화면은 `demoKeys`의 14개 키를 모두 쓴다. 기본 빌드와 선택 빌드가 같은 14개를 담고, fixture가 쓰지 않는 키를 하나 더해 선택 빌드가 그 키를 빼는지 확인한다.

## 검증

로컬에서 확인한 항목:

- `@0disoft/saylo-react`의 build·typecheck.
- React 테스트 17개. 새 rich renderer 테스트 3개가 중첩 매핑, 같은 이름 반복 태그의 key·identity, unknown·prototype 상속 태그, text·인자 값 escape, 카탈로그 편집·literal 삽입 뒤 같은 이름 `link` Counter 두 개가 각자 state(첫 번째 count 1, 두 번째 count 0)와 노드 identity를 유지하는지, hydration 고정 snapshot을 덮는다.
- 전체 `npm run check` exit 0. 293개 테스트(경계·tooling 포함)이고 React 17개를 포함한다.
- 기본 production 데모 lifecycle.
- 실제 HeadlessChrome 154 recovery 검사: warm 11개(`rich-live-edit`·invalid·fallback-input·restoration 포함)와 cold 3개, browser 오류 없음. 로그는 `.release/react-rich-recovery.log`다.
- React 선택 빌드 검증: TS 선택 키 계약과 en 전환 뒤 rich text production lifecycle. 로그는 `.release/react-rich-selected.log`다.
- vanilla full·selected Chromium 검사: 각 11개, 동적 키 개수 반영. 로그는 `.release/react-rich-vanilla-selected.log`다.

- 독립 tarball 소비: `npm exec -- node scripts/pack-smoke.mjs` exit 0. 다섯 패키지의 JS·TS 설치에서 core parts를 React 링크·강조로 렌더하고 인자 문자열의 HTML escape를 확인했다. 기존 selector·SSR·lazy 소비도 통과했다. 로그는 `.release/react-rich-pack.log`다.

vanilla 데모의 화면은 기존 13개 키를 쓴다. 공유 카탈로그에는 React용 rich 키가 더해져 14개가 있고, vanilla 검증 fixture는 100개 미사용 키를 추가한다. 전체 빌드는 114개, 선택 빌드는 화면이 쓰는 13개를 유지한다. 검증기는 카탈로그 원본에서 기대 개수를 계산한다.

## 다음 단계

Svelte·Vue render helper와 실제 브라우저 UI 데모는 다음 단계다. 이번 범위는 React helper와 React 데모까지다.
