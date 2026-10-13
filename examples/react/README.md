# React 데모

Saylo Vite 플러그인을 React 19와 TypeScript로 쓰는 예제다. `examples/vanilla/locales`의 같은 카탈로그와 기존 스타일을 공유하고, 입력값·수량·모달은 React state로 관리한다. 명령은 저장소 루트에서 실행한다.

## 개발 서버

```sh
npm run dev:react
```

전체 스키마와 전체 카탈로그를 쓰고, `examples/vanilla/locales/`의 파일을 저장하면 화면에 바로 반영한다. 개발 서버는 `--mode`를 주지 않으므로 `includeKeys` 없이 전체 카탈로그를 제공한다.

## 운영 빌드

기본 빌드는 메시지를 모두 담아 `examples/react/dist/`에 쓴다.

```sh
npm run build:react
```

선택 빌드는 `selected-keys.mts`의 `demoKeys`에 있는 키만 담아 `examples/react/dist-selected/`에 쓴다.

```sh
npm run build:react:selected
npm run preview:react:selected
```

`preview:react:selected`는 `examples/react/dist-selected/`를 127.0.0.1에서 띄운다. 두 빌드 모두 `npm run typegen:react`로 전체 base schema를 생성하고, `tsc -p examples/react/tsconfig.json`으로 데모 TS를 검사한 뒤 Vite로 번들한다.

이 화면은 `demoKeys`의 14개 키를 모두 쓴다. 기본 빌드와 선택 빌드 모두 그 14개를 담고, fixture가 쓰지 않는 키를 하나 더해 선택 빌드가 그 키를 빼는지 확인한다.

## 선택 키 관리

`demoKeys`는 이 화면이 실제로 쓰는 키를 손으로 적어 둔 목록이다. `examples/react/selected-keys.mts`에서 `readonly` tuple로 두고 `satisfies readonly (keyof AppSchema)[]`로 생성 타입과 맞춘다. 여기서 `AppSchema`는 `generated.d.ts`의 전체 base schema다. 파일을 `.mts`로 둬서 Node 24의 native TS stripping과 Vite native config 모듈 경고를 피한다.

```ts
// examples/react/selected-keys.mts
import type { AppSchema } from './generated';

export const demoKeys = Object.freeze([
  'demo:heading', 'demo:description', 'demo:formTitle',
  'demo:name', 'demo:namePlaceholder', 'demo:note', 'demo:notePlaceholder',
  'demo:count', 'demo:summary', 'demo:openDialog',
  'demo:dialogTitle', 'demo:dialogNote', 'demo:closeDialog', 'demo:rich',
] as const satisfies readonly (keyof AppSchema)[]);

export type DemoSchema = Pick<AppSchema, typeof demoKeys[number]>;
```

`vite.config.mjs`는 같은 `demoKeys`를 `./selected-keys.mts`에서 import해 `--mode selected`일 때만 `includeKeys`로 넘긴다. 기본 빌드와 개발 서버는 `includeKeys`를 넘기지 않아 전체 카탈로그를 그대로 쓴다.

```mjs
// examples/react/vite.config.mjs
import { demoKeys } from './selected-keys.mts';

export default defineConfig(({ mode }) => createDemoConfig({
  includeKeys: mode === 'selected' ? demoKeys : undefined,
  outDir: mode === 'selected' ? 'dist-selected' : 'dist',
}));
```

화면 타입도 같은 목록으로 좁힌다. `i18n.ts`가 `createI18n<DemoSchema>`와 `createSayloReact<DemoSchema>`로 store와 hook을 만든다. 타입 import·export 경로는 `./selected-keys.mjs`로 적는다(tsc가 `.mts` 소스로 해석한다).

```ts
// examples/react/i18n.ts
import type { DemoSchema } from './selected-keys.mjs';
export type { DemoSchema as AppSchema } from './selected-keys.mjs';

export const store = createI18n<DemoSchema>({ catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone });
export const { SayloProvider, useI18n } = createSayloReact<DemoSchema>();
```

`tsc`는 Vite `--mode`와 무관하게 돈다. 그래서 이 화면 계약은 개발·기본·선택 빌드에 모두 적용되고, `demoKeys`에 없는 키를 코드에서 부르면 선택 빌드가 아니어도 거부된다. `generated.d.ts`는 선택 빌드에서도 전체 base schema 그대로이고, `typegen:react`는 `includeKeys`를 받지 않는다.

동적 키는 `keyof DemoSchema`로만 다룬다. 키를 `string`으로 넓혀 넘기면 컴파일에서 거부된다. `as keyof DemoSchema`처럼 캐스팅하면 그 검사를 건너뛰므로, 캐스팅으로 넘긴 키가 선택 빌드에서 빠져 있으면 런타임 `UnknownMessageError`로만 드러난다. 화면에 키를 더하거나 빼면 `demoKeys`도 같이 고치고 다시 빌드한다. `includeKeys`는 게시본 `0.1.0-alpha.4`에는 없고, 이 기능이 추가되기 전 커밋 `2037f9a` 기준으로 동결한 `0.1.0-alpha.5` 후보 tarball에도 없다. 아직 게시되지 않은 기능이다.

## rich text 미리보기

공유 카탈로그 `examples/vanilla/locales/ko/demo.json`과 `en/demo.json`에 rich 키를 더한다. 한국어는 `<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요.`이고, 영어는 `<strong>{name}</strong>, review <link>your order</link>.`이다.

화면은 이 parts를 `renderRichText`로 그린다. `strong`을 `<strong>`에, `link`를 `<a href="#order-form">`에 매핑하고, 미리보기 노드의 id는 `rich-preview`다. 링크는 같은 화면의 주문 폼으로 간다. 이름 입력이 비어 있으면 `Saylo`를 쓴다.

`projectDemoMessages`는 전체 번역 투영과 마지막 정상 상태 fallback 모두에 rich parts를 담는다. malformed 태그 뒤에도 이름·수량·입력 변경은 마지막 정상 snapshot을 다시 포맷한다.

`demoKeys`에 `demo:rich`를 더하고, 생성 타입은 `"demo:rich": { "name": number | string; }`이다. 개발 서버·운영 빌드·선택 빌드·검증 명령은 앞의 절차를 그대로 쓴다.

이 helper는 아직 npm 게시본에 없다. 로컬 변경이며 버전 승격과 게시를 하지 않는다. 로컬 rich renderer 테스트 3개와 전체 `npm run check`(293개), HeadlessChrome recovery 검사(warm 11·cold 3, browser 오류 없음, 로그 `.release/react-rich-recovery.log`), React 선택 빌드 검증(로그 `.release/react-rich-selected.log`), vanilla full·selected Chromium 검사 각 11개(로그 `.release/react-rich-vanilla-selected.log`)를 통과했고 독립 tarball 검사만 남았다.

## 선택 빌드 검증

```sh
npm run verify:demo:react:selected
```

React·vanilla·shared 예제를 `.release/` 아래 임시 복사본으로 만들고, 로케일마다 쓰지 않는 키 1개를 카탈로그에 더한 뒤 전체 base schema로 타입을 다시 생성한다. 이 fixture에서 TypeScript 부정·긍정 계약을 검사한다. 전체 `AppSchema` 번역기는 그 unused 키를 그대로 받고, `DemoSchema`로 좁힌 번역기·store·hook은 그 키와 `string`으로 넓힌 키, 어긋난 인자, 빠진 필수 인자를 거부해야 한다. 이어서 선택 빌드의 실제 production 출력에서 unused 문구가 어떤 chunk에도 남지 않고 영어용 동적 chunk는 그대로 lazy인지, `generated.d.ts`가 빌드 뒤에도 전체 타입을 유지하는지 확인한다. 마지막으로 기존 React lifecycle 검사를 임시 fixture의 선택 빌드 출력에 실행해 lazy 언어 전환과 폼·dialog 상태 유지를 확인한다. 이 검사들은 jsdom에서 번들을 실행하며 Chromium을 쓰지 않는다.
