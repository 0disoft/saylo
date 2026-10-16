# @0disoft/saylo-vue

Saylo의 Vue 3 바인딩이다. `createSayloVue<Schema>()`가 `createPlugin`·`provideI18n`·`useI18n`을 만들고, `useVueStore(instance)`가 store snapshot을 읽기 전용 `shallowRef`로 구독한다. `useI18n`·`useVueStore`·`provideI18n`은 컴포넌트 `setup`에서 동기 호출하고, `createPlugin(instance)`은 setup 밖에서 만들어 `app.use`로 설치한다.

## 상태와 설치

로컬 private workspace 전용이고 npm에 게시하지 않았다. `package.json`의 `private`는 `true`, `version`은 `0.1.0-alpha.4`지만 이 버전은 registry에 없고, 게시된 다섯 패키지(`alpha`)와 `0.1.0-alpha.5` 후보 어디에도 들어가지 않는다. 그래서 registry 설치 대신 workspace/file로 연결한다. 저장소 루트의 `workspaces: ["packages/*"]`에 이미 들어 있어 루트 `npm install`로 링크되고, 다른 앱은 `npm install <saylo 경로>/packages/vue`처럼 로컬 경로로 설치한다.

`vue`는 peer이고 조건은 메이저 3(`"vue": "3"`)이다. 저장소 루트도 검증용 devDependency로 같은 메이저 범위를 쓴다. `@0disoft/saylo-core`는 런타임 의존성이고 `dist/`에 ESM JavaScript와 `.d.ts`를 낸다(`tsc -p tsconfig.json`).

저장소 루트에서 설치·빌드한 뒤 사용한다. 독립 tarball 소비도 같은 루트에서 검증한다.

```sh
npm ci --ignore-scripts
npm run build
npm run verify:pack:vue
```

`verify:pack:vue`는 core·Vue tarball을 임시 앱에 설치하고 JS·TS 타입과 동시 ko/en SSR을 확인한 뒤 임시 폴더를 정리한다.

저장소 밖에서 Vue SFC 앱을 시작하려면 [Vue 시작 안내](../../docs/getting-started-vue.md)를 따른다. `prepare:starter:vue`가 네 tarball을 동봉하고, `verify:starter:vue`가 독립 설치·타입 생성·개발 서버·production 화면을 확인한다.

## 사용

factory는 모듈 범위에서 한 번 만들고, 앱은 `createApp(...).use(createPlugin(store))`로 instance를 설치한다. 감싸는 컴포넌트가 필요 없다. 아래는 브라우저 앱 하나가 store를 소유하는 Vue `h` render function 예제다. SSR에서는 요청마다 store를 만든다.

```js
import { createApp, defineComponent, h } from 'vue';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloVue } from '@0disoft/saylo-vue';

const ko = parseCatalog('{"greeting":"안녕 {name}"}', { locale: 'ko', namespace: 'demo' });
const en = parseCatalog('{"greeting":"Hello {name}"}', { locale: 'en', namespace: 'demo' });

// 모듈 범위에서 한 번 만든다. 주입 키는 이 factory 안에서만 유효하다.
const { createPlugin, provideI18n, useI18n } = createSayloVue();
const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [ko, en] });

const Child = defineComponent({
  setup() {
    const i18n = useI18n(); // 같은 factory의 provider가 instance를 넘긴다.
    return () => h('button', {
      onClick: () => i18n.value.setLocale(i18n.value.locale === 'ko' ? 'en' : 'ko'),
    }, i18n.value.t('demo:greeting', { name: 'Saylo' }));
  },
});

// setup 밖에서 plugin을 만들고 앱에 설치한다. install이 app.provide를 대신한다.
const app = createApp(Child).use(createPlugin(store));
app.mount('#app');

// 앱 종료 때 호출한다. plugin은 instance를 폐기하지 않는다.
function stop() {
  app.unmount();
  store.dispose();
}
```

하위 트리만 다른 instance로 덮고 싶으면 그 부모 컴포넌트 `setup`에서 `provideI18n(instance)`를 부른다. `useI18n`은 가장 가까운 컴포넌트 provider를 먼저 찾고, 없으면 앱 provider를 쓴다. 앱 전체가 한 instance면 `provideI18n`은 필요 없다.

```js
const Subtree = defineComponent({
  props: ['instance'],
  setup(props) {
    provideI18n(props.instance); // 호출자가 넘긴 instance를 이 subtree에 제공한다.
    return () => h(Child);
  },
});
```

`useI18n` 대신 같은 instance를 받는 `useVueStore(instance)`를 직접 써도 된다.

스키마를 주면 키와 인자, `setLocale` 반환 타입이 어댑터까지 유지된다.

```ts
import { createSayloVue } from '@0disoft/saylo-vue';

type AppSchema = { 'demo:greeting': { name: string } };
export const { createPlugin, provideI18n, useI18n } = createSayloVue<AppSchema>();
```

## 계약

- 반환값은 읽기 전용 `shallowRef`다. script에서는 `.value`로 읽고 템플릿에서는 자동으로 풀린다. 값은 동결된 snapshot 객체다.
- `useVueStore`와 `provideI18n`·`useI18n`은 `setup` 중에만 부를 수 있고, 밖에서 부르면 동기 오류를 던진다. `createPlugin(instance)`은 setup 밖에서 부를 수 있다. `useI18n`은 같은 factory의 provider가 없으면 오류를 던지고, 메시지가 `provideI18n` 또는 `app.use(createPlugin(instance))`를 안내한다. 다른 factory의 context는 서로 읽히지 않는다.
- `createPlugin(instance)`의 `install`은 주입 키에 instance를 넣는 `app.provide`만 한다. 구독을 만들지 않고 instance도 폐기하지 않으며, 마운트 전에 설치한다. 같은 앱에 같은 instance로 새로 만든 plugin을 다시 설치하면 아무 일도 하지 않고, 같은 factory인데 다른 instance를 설치하면 오류를 던진다. 실행 중에 설치된 instance를 바꾸는 핫 스왑은 없다.
- `provideI18n`이나 `createPlugin`에 넘긴 instance는 해당 범위에서 안정적으로 유지한다. 어댑터는 instance를 폐기하지 않으므로 `dispose()`는 호출자가 책임진다.
- live 구독은 `onMounted`에서 시작한다. listener를 설치한 뒤 `getSnapshot()`을 한 번 더 읽어 setup과 mount 사이의 변경까지 반영하고, `onDispose` 리스너와 구독은 `onScopeDispose`에서 해제한다.
- snapshot의 `t`는 그 snapshot의 번역에 묶여 있고, `setLocale`은 instance에서 온다. `setLocale`은 동기 `void` 또는 lazy instance의 `Promise<void>`다. lazy instance는 `loadNamespace`도 함께 온다.

## 선택자 구독

`createSayloVue<S>()`가 돌려주는 `useI18nSelector`와 instance를 직접 받는 `useVueSelector`로 snapshot에서 필요한 값만 골라 읽는다. 둘 다 `setup`에서 동기 호출한다.

```ts
function useVueSelector<S extends Schema, T>(instance: SayloInstance<S>, selector: (snapshot: SayloVueSnapshot<S>) => T): ComputedRef<T>;
function useI18nSelector<T>(selector: (snapshot: SayloVueSnapshot<S>) => T): ComputedRef<T>;
```

먼저 `useVueStore(instance)`로 source를 한 번 만든 뒤 `computed(() => selector(source.value))`로 값을 고른다. 반환값은 읽기 전용 `ComputedRef<T>`이고 script에서는 `.value`로, 템플릿에서는 자동으로 풀린다.

- selector 결과가 `Object.is`로 같으면 downstream 업데이트를 건너뛴다. 매번 새 객체를 만들면 매번 갱신된다.
- selector가 읽은 reactive ref·prop을 추적한다. selector는 순수해야 한다.
- lazy `computed`라 처음 읽을 때 계산한다.
- selector 예외는 Vue `computed`의 일반 처리와 같다. 자동으로 마지막 정상 값을 보관하지 않는다.

구독은 composable마다 하나 만들고 `onMounted`에서 시작한다. listener를 설치한 뒤 snapshot을 한 번 더 읽어 `setup`과 mount 사이 변경까지 반영하고, scope dispose에서 해제한다. SSR에서는 구독이 생기지 않는다.

```js
import { defineComponent, h, ref } from 'vue';
// i18n 모듈은 앱에 설치한 factory의 useI18nSelector도 함께 내보낸다.
import { useI18nSelector } from './i18n';

const Demo = defineComponent({
  setup() {
    const name = ref('Saylo');
    const title = useI18nSelector(s => s.t('demo:greeting', { name: name.value }));
    return () => h('p', title.value);
  },
});
```

`useI18nSelector` 대신 같은 instance를 받는 `useVueSelector(instance, selector)`를 직접 써도 된다. Vue 바인딩은 여전히 private이고 게시와 버전 승격은 보류한다.

## SSR과 소유권

- 마운트 관련 훅은 서버 렌더에서 실행되지 않으므로 SSR 중에는 구독이 생기지 않는다([컴포넌트 라이프사이클 훅](https://vuejs.org/guide/scaling-up/ssr.html#component-lifecycle-hooks)). 첫 렌더 값은 `setup` 시점의 `getSnapshot()`이다.
- 서버에서 쓸 때는 요청마다 instance를 따로 만들어 그 요청의 앱에 `createSSRApp(Root).use(createPlugin(instance))`로 설치한다. factory와 주입 키는 공유해도 되지만 instance를 서버 전역에 두면 안 되고, 요청이 끝나면 호출자가 `dispose()`로 정리한다.
- 서버 HTML과 boot snapshot을 브라우저에서 연결하는 예제는 [Vue SSR 데모](../../examples/vue-ssr/README.md)를 따른다. 클라이언트는 `initialSnapshot`으로 첫 렌더를 맞추고 `app.mount()`가 끝난 뒤 개발 동기화를 연결한다.
- 어댑터는 컴포넌트 범위가 끝날 때 자신이 건 구독과 disposal 리스너만 해제한다. store의 수명은 앱이 소유한다.

## rich text 렌더 (renderRichText)

`renderRichText`는 `snapshot.tParts(key, args)`가 돌려준 읽기 전용 parts를 Vue 노드로 그린다. 순수 TS 함수이고 `h`와 `Fragment`만 쓰므로 SFC 컴파일이나 별도 서브패스가 필요 없다. 루트 엔트리(`@0disoft/saylo-vue`)가 함수와 타입 `RichTextRenderers`를 함께 내보내고, 어떤 tag를 어떤 element로 그릴지는 앱이 넘긴 renderers가 정한다.

```ts
type RichTextRenderers = Readonly<Record<string, (children: VNodeChild[]) => VNodeChild>>;

function renderRichText(parts: readonly RichTextPart[], renderers?: RichTextRenderers): VNodeChild[];
```

`renderers`를 주지 않으면 빈 객체로 본다.

계약은 다음과 같다.

- text part는 그대로 Vue text가 되고 Vue가 escape한다. helper는 `v-html`이나 raw HTML 문자열을 만들지 않는다.
- tag part는 그 이름이 `renderers`의 own property이고 값이 함수일 때만 그 함수 결과로 바뀐다. 없거나 함수가 아니면 태그를 만들지 않고 자식만 이어 그린다.
- 조회는 own property만 본다(`Object.hasOwn`). `constructor`·`toString`처럼 prototype에서 상속된 이름은 매핑으로 쓰지 않고 자식만 그린다.
- 카탈로그에서 온 이름으로 임의의 DOM 태그, HTML, attribute, URL을 만들지 않는다. 링크와 attribute는 앱이 자기 renderers에 넣은 이름에만 붙인다.
- 중첩 태그를 지원한다. 안쪽 tag도 같은 규칙으로 매핑한다.
- 형제 tag는 이름과 등장 순번을 합친 key를 가진 `Fragment`로 그린다(`link:0`, `link:1`). 문구를 편집하거나 literal을 삽입해도 매핑한 컴포넌트 identity와 그 state가 유지된다. 같은 tag 종류끼리 순서를 바꿀 때의 의미적 identity는 보장하지 않는다.
- renderers는 같은 tag에 같은 element·component 타입을 돌려줘야 한다. 타입이 바뀌면 Vue가 다시 mount해 입력·포커스·state가 사라진다.
- 파싱 오류는 core `tParts`가 던진다. helper는 유효한 parts만 받는다.

```ts
import { defineComponent, h } from 'vue';
import { renderRichText } from '@0disoft/saylo-vue';
import type { RichTextRenderers } from '@0disoft/saylo-vue';
import { useI18n } from './i18n';

const richRenderers: RichTextRenderers = {
  strong: children => h('strong', children),
  link: children => h('a', { href: '#order-form' }, children),
};

const RichPreview = defineComponent({
  setup() {
    const i18n = useI18n(); // useI18n은 setup에서만 부를 수 있다.
    return () => renderRichText(i18n.value.tParts('demo:rich', { name: 'Saylo' }), richRenderers);
  },
});
```

이 helper는 로컬 커밋 `4df90a2`에 있고 npm 게시본에는 없다. 버전 승격과 게시는 보류한다. 로컬 검증에서 패키지 테스트 13개, JS·TS 소비 타입 검사와 패키지 경계 검사, 독립 tarball JS·TS 설치와 concurrent SSR·rich SSR 소비, 데모 template 검사와 production 빌드, HeadlessChrome 155 recovery warm 16개·cold 3개(오류 없음), 워크스페이스 전체 `npm run check` exit 0(297개 테스트)까지 확인했다. 데모 연결은 [Vue 데모](../../examples/vue/README.md)를 따른다.

## 구현 범위

브라우저 예제는 [Vue 데모](../../examples/vue/README.md)를 따른다. Nuxt 모듈, 게시본 integrity 인수 검사는 구현하지 않았다. 이 패키지는 게시된 `alpha.4`·`alpha.5` 대상이 아니고 대응하는 릴리스 검증 기록도 없다.

라이선스는 Apache-2.0이고, 배포 tarball의 `files`에 `LICENSE`와 `NOTICE`를 포함한다.
