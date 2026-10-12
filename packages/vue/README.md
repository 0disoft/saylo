# @0disoft/saylo-vue

Saylo의 Vue 3 바인딩이다. `createSayloVue<Schema>()`가 typed context의 `provideI18n`과 `useI18n`을 만들고, `useVueStore(instance)`가 store snapshot을 읽기 전용 `shallowRef`로 구독한다. `useVueStore`와 factory의 두 함수는 컴포넌트 `setup`에서 동기 호출한다.

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

## 사용

factory는 모듈 범위에서 한 번 만들고, 부모 `setup`에서 `provideI18n`, 자식 `setup`에서 `useI18n`을 쓴다. 아래는 브라우저 앱 하나가 store를 소유하는 Vue `h` render function 예제다. SSR에서는 요청마다 store를 만든다.

```js
import { createApp, defineComponent, h } from 'vue';
import { createStore, parseCatalog } from '@0disoft/saylo-core';
import { createSayloVue } from '@0disoft/saylo-vue';

const ko = parseCatalog('{"greeting":"안녕 {name}"}', { locale: 'ko', namespace: 'demo' });
const en = parseCatalog('{"greeting":"Hello {name}"}', { locale: 'en', namespace: 'demo' });

// 모듈 범위에서 한 번 만든다.
const { provideI18n, useI18n } = createSayloVue();
const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [ko, en] });

const Child = defineComponent({
  setup() {
    const i18n = useI18n(); // 같은 factory의 부모 provideI18n이 필요하다.
    return () => h('button', {
      onClick: () => i18n.value.setLocale(i18n.value.locale === 'ko' ? 'en' : 'ko'),
    }, i18n.value.t('demo:greeting', { name: 'Saylo' }));
  },
});

const Parent = defineComponent({
  setup() {
    provideI18n(store); // 앱이 소유한 instance를 그대로 넘긴다.
    return () => h(Child);
  },
});

const app = createApp(Parent);
app.mount('#app');

// 앱 종료 때 호출한다.
function stop() {
  app.unmount();
  store.dispose();
}
```

`useI18n` 대신 같은 instance를 받는 `useVueStore(instance)`를 직접 써도 된다.

스키마를 주면 키와 인자, `setLocale` 반환 타입이 어댑터까지 유지된다.

```ts
import { createSayloVue } from '@0disoft/saylo-vue';

type AppSchema = { 'demo:greeting': { name: string } };
export const { provideI18n, useI18n } = createSayloVue<AppSchema>();
```

## 계약

- 반환값은 읽기 전용 `shallowRef`다. script에서는 `.value`로 읽고 템플릿에서는 자동으로 풀린다. 값은 동결된 snapshot 객체다.
- `useVueStore`와 factory의 두 함수는 `setup` 중에만 부를 수 있고, 밖에서 부르면 동기 오류를 던진다. `useI18n`은 같은 factory의 부모 `provideI18n`이 없으면 오류를 던지고, 다른 factory의 context는 서로 읽히지 않는다.
- `provideI18n`에 넘긴 instance는 마운트 동안 안정적으로 유지한다. 어댑터는 instance를 폐기하지 않으므로 `dispose()`는 호출자가 책임진다.
- live 구독은 `onMounted`에서 시작한다. listener를 설치한 뒤 `getSnapshot()`을 한 번 더 읽어 setup과 mount 사이의 변경까지 반영하고, `onDispose` 리스너와 구독은 `onScopeDispose`에서 해제한다.
- snapshot의 `t`는 그 snapshot의 번역에 묶여 있고, `setLocale`은 instance에서 온다. `setLocale`은 동기 `void` 또는 lazy instance의 `Promise<void>`다. lazy instance는 `loadNamespace`도 함께 온다.

## SSR과 소유권

- 마운트 관련 훅은 서버 렌더에서 실행되지 않으므로 SSR 중에는 구독이 생기지 않는다([컴포넌트 라이프사이클 훅](https://vuejs.org/guide/scaling-up/ssr.html#component-lifecycle-hooks)). 첫 렌더 값은 `setup` 시점의 `getSnapshot()`이다.
- 서버에서 쓸 때는 요청마다 instance를 따로 만들어 부모 `provideI18n`에 넘긴다. factory는 공유해도 되지만 instance를 서버 전역에 두면 안 되고, 요청이 끝나면 호출자가 `dispose()`로 정리한다.
- 서버 HTML과 boot snapshot을 브라우저에서 연결하는 예제는 [Vue SSR 데모](../../examples/vue-ssr/README.md)를 따른다. 클라이언트는 `initialSnapshot`으로 첫 렌더를 맞추고 `app.mount()`가 끝난 뒤 개발 동기화를 연결한다.
- 어댑터는 컴포넌트 범위가 끝날 때 자신이 건 구독과 disposal 리스너만 해제한다. store의 수명은 앱이 소유한다.

## 구현 범위

브라우저 예제는 [Vue 데모](../../examples/vue/README.md)를 따른다. 키 단위 selector 구독, `app.use` 플러그인, Nuxt 모듈, 게시본 integrity 인수 검사는 구현하지 않았다. 이 패키지는 게시된 `alpha.4`·`alpha.5` 대상이 아니고 대응하는 릴리스 검증 기록도 없다.

라이선스는 Apache-2.0이고, 배포 tarball의 `files`에 `LICENSE`와 `NOTICE`를 포함한다.
