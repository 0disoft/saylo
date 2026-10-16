# 80. Svelte rich text 컴포넌트 (`RichText.svelte`)

이 문서는 core `tParts`가 돌려준 parts를 Svelte 5 컴포넌트로 그리는 `RichText.svelte`의 계약과 데모를 정한다. core의 `tParts`는 그대로 두고, Svelte 패키지가 컴포넌트와 타입을 더한다.

상태: 컴포넌트를 로컬 커밋 `010a600`으로 저장했고 데모 연결과 아래 검증도 마쳤다. 게시본 `0.1.0-alpha.4`에는 이 컴포넌트가 없다. 버전 승격과 게시는 보류한다.

## 범위

- `@0disoft/saylo-svelte/RichText.svelte` 서브패스를 별도 기본 import로 연다.
- 루트 엔트리는 store API를 그대로 두고 타입 `RichTextProps`·`RichTextRenderers`만 내보낸다. 루트 import는 Node SSR에서 Svelte 컴파일 없이 동작한다.
- 입력은 core `tParts`가 돌려준 읽기 전용 `RichTextPart[]`다. 인자·필수 인자 검증·기준 로케일 폴백·소스 locale·timeZone 계약은 core와 같다. 컴포넌트는 넘긴 parts와 renderers만으로 노드를 만든다.
- 이 문서의 범위는 Svelte 컴포넌트다. Vue 구현은 아래 연결 문서에서 다룬다. 자동 HTML 렌더와 parts에서 attribute·URL을 만드는 동작은 지원하지 않는다.

## 설치와 import

```ts
// 앱 컴포넌트에서는 서브패스를 기본 import로 가져온다.
import RichText from '@0disoft/saylo-svelte/RichText.svelte';
// 타입만 필요하면 루트 엔트리에서 가져온다.
import type { RichTextProps, RichTextRenderers } from '@0disoft/saylo-svelte';
```

`RichText.svelte`는 소비자가 컴파일하는 Svelte 컴포넌트라 import 경로를 나눈다. 루트 엔트리(`@0disoft/saylo-svelte`)는 store API이고 Node SSR에서 컴파일 없이 그대로 import한다.

## API

```ts
import type { Snippet } from 'svelte';
import type { RichTextPart } from '@0disoft/saylo-core';

type RichTextRenderers = Readonly<Record<string, Snippet<[Snippet]>>>;

interface RichTextProps {
  readonly parts: readonly RichTextPart[];
  readonly renderers?: RichTextRenderers;
}
```

- `parts`는 core `tParts`의 반환값을 그대로 넣는다.
- `renderers`를 주지 않으면 빈 객체로 본다. 값은 자식 렌더러 하나(`Snippet`)를 인자로 받는 snippet이다.

## 렌더 계약

- text part는 Svelte 템플릿의 text가 된다. Svelte가 escape하므로 HTML로 해석되지 않는다. 컴포넌트는 `{@html}`을 쓰지 않는다.
- tag part는 그 이름이 `renderers`의 own property이고 값이 snippet일 때만 그 snippet으로 그린다. 없거나 snippet이 아니면 태그 자체를 만들지 않고 자식만 이어 그린다.
- 조회는 own property만 본다(`Object.hasOwn`). `constructor`·`toString`처럼 prototype에서 상속된 이름은 매핑으로 쓰지 않고 자식만 그린다.
- 카탈로그에서 온 이름으로 임의의 DOM 태그, HTML, attribute, URL을 만들지 않는다. 링크·attribute·URL은 앱이 자기 renderers에 넣은 이름에만 붙인다.
- 중첩 태그를 지원한다. 안쪽 tag도 같은 규칙으로 매핑하고 컴포넌트가 재귀로 그린다.
- 컴포넌트가 만드는 HTML은 앱이 renderers에 넣은 snippet뿐이다. Saylo는 번역에서 온 이름으로 태그나 HTML을 만들지 않는다.
- attribute가 붙은 여는 마커와 self-closing 마커(`<br/>`)는 core가 literal text로 남긴다. 여는 마커가 literal이 되면 짝 없는 닫는 마커가 매칭되지 않아 `InvalidRichTextError`가 난다([78-rich-text-parts.md](78-rich-text-parts.md)). 어긋나거나 닫히지 않은 구조도 오류다. 이 판정은 core `tParts`가 하고 컴포넌트는 유효한 parts만 받는다.

## 키와 identity

컴포넌트는 keyed 목록으로 parts를 그린다. key는 tag 이름과 그 이름의 등장 순번을 합쳐 만든다.

```ts
// parts:  [{ type: 'tag', name: 'link', ... }, { type: 'tag', name: 'link', ... }]
// keys:   ['tag:link:0', 'tag:link:1']
```

- 같은 이름의 두 번째 태그가 첫 번째와 다른 key를 갖는다. 문구나 literal을 삽입·편집해도 매핑된 노드 identity가 유지된다.
- renderers의 snippet은 같은 tag에 대해 같은 타입을 유지해야 한다. 타입이 바뀌면 노드가 다시 만들어져 입력·포커스·state가 사라진다.

## 사용 예

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import RichText from '@0disoft/saylo-svelte/RichText.svelte';
  import { getI18n } from './i18n';

  let { name = 'Saylo' }: { name?: string } = $props();
  const i18n = getI18n();
</script>

{#snippet strong(children: Snippet)}
  <strong>{@render children()}</strong>
{/snippet}

{#snippet link(children: Snippet)}
  <a href="#order-form">{@render children()}</a>
{/snippet}

<RichText parts={$i18n.tParts('demo:rich', { name })} renderers={{ strong, link }} />
```

snippet이 받는 인자는 매핑된 자식 렌더러다. 앱은 `{@render children()}`으로 그 자리에 안쪽 parts를 그린다. renderers에 없는 이름은 자식만 그려지므로 안쪽 text가 그대로 이어진다.

## 배포 형태

- tarball에는 `dist/RichText.svelte` 원본과 helper JS(`dist/rich-text.js`), 타입 선언(`dist/rich-text.d.ts`·`dist/rich-text-component.d.ts`)을 함께 담는다. helper는 key를 만드는 `keyedRichTextParts`를 내보낸다.
- `dist/RichText.svelte`는 소스로 게시하고 소비자의 Svelte 5 컴파일러가 컴파일한다. 기존 Svelte 5와 `@sveltejs/vite-plugin-svelte` 7 설정에서 그대로 쓴다.
- Node에서 컴포넌트를 SSR하려면 소비자가 Svelte 컴파일러로 `RichText.svelte`를 컴파일한다. store만 쓰는 루트 API는 컴파일 없이 그대로 import한다.

## 데모 (rich-preview)

- `examples/svelte/locales/ko/demo.json`·`en/demo.json`에 rich 키를 더한다. 한국어는 `<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요.`이고, 영어는 `<strong>{name}</strong>, review <link>your order</link>.`로 React 데모와 같다.
- `Preview.svelte`가 `rich-preview` 문단을 더한다. `strong`은 `<strong>`에, `link`는 같은 화면의 주문 폼(`#order-form`)으로 가는 링크에 매핑한다. 이름 입력이 비어 있으면 `Saylo`를 쓴다.
- `projectDemoMessages`는 마지막 정상 전체 번역 투영에 rich parts를 담는다. rich markup이 잘못된 뒤에도 이름·수량·입력 변경은 마지막 정상 snapshot을 현재 인자로 다시 포맷한다.
- 명령은 그대로 둔다. `npm run dev:svelte`, `npm run build:svelte`, `npm run verify:demo:svelte:recovery`, `npm run check`, `npm run verify:pack`.

## 검증

로컬에서 확인한 항목(2026-10-14, 클라이언트 로컬):

- 컴포넌트 구현을 로컬 커밋 `010a600`으로 저장했다.
- `packages/svelte` 테스트 15개와 자식 client 실행 5개(새 rich state·hydration 테스트 2개 포함)가 통과했다. 루트 15개와 중첩 5개는 따로 집계한다. 컴파일한 SSR에서 중첩 매핑·인자 text의 HTML escape·unknown·prototype 상속 태그가 자식만 그리는 경우와, client에서 같은 이름 반복 노드가 각자 state와 노드 identity를 유지하는 경우를 확인했다.
- SvelteKit 예제 설치본의 `svelte-check`를 `--workspace packages/svelte --no-tsconfig --ignore dist,test --fail-on-warnings`로 실행해 오류 0·경고 0이었다.
- JS·TS 소비 타입 검사와 패키지 경계 검사가 통과했다.
- 데모도 같은 checker로 `--workspace examples/svelte --no-tsconfig --ignore dist --fail-on-warnings`를 실행해 오류 0·경고 0이었다.
- 데모를 새로 연결했다. 생성 스키마·이름 폴백·parts를 화면에 쓴다.
- HeadlessChrome 154 recovery 검사가 통과했다. warm 11개(rich 관련 4개 포함)와 cold 3개, browser 오류 없음(`errors[]`). 로그는 `.release/svelte-rich-recovery.log`다.
- SSR에서는 일치하는 마크업의 hydration과 이후 live snapshot 갱신을 확인했다.
- 전체 `npm run check` exit 0: 294개 테스트와 여섯 workspace의 빌드·소비 타입 검사를 통과했다(로그 `.release/svelte-rich-check.log`). 자식 client 5개는 앞서 구분한 별도 실행 집계다.
- 데모 TypeScript 검사와 Vite 8.3.4 production 빌드를 통과했다.
- `npm exec -- node scripts/pack-smoke.mjs` exit 0: 다섯 tarball의 독립 JS·TS 설치에서 새 component 선언을 검사하고, 배포한 Svelte 소스를 소비자 compiler로 컴파일해 중첩 snippet·문자열 escape·SSR을 확인했다. 기존 root store·selector·React·Vite 소비도 통과했다(로그 `.release/svelte-rich-pack.log`).

## 다음 단계

Svelte 컴포넌트는 로컬 커밋 `010a600`에 있고 데모는 로컬 변경으로 연결했다. 남은 단계였던 Vue render helper와 Vue 데모도 로컬에서 구현했다. Vue는 이 문서의 Svelte 컴포넌트와 달리 SFC 컴파일이나 서브패스 없이 루트 엔트리의 순수 TS `renderRichText`를 쓴다. 계약은 [@0disoft/saylo-vue README](../packages/vue/README.md), 데모 연결과 검증은 [Vue 데모](../examples/vue/README.md)에 적었다. 게시본에는 아직 없고 버전 승격과 게시는 보류한다.
