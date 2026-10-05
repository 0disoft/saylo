# @0disoft/saylo-react

Saylo의 React 19 바인딩이다. `createSayloReact`가 typed Provider와 hook을 만들고, hook은 `useSyncExternalStore`로 store snapshot을 구독한다.

## 상태

아직 npm에 게시하지 않았다. 현재는 이 저장소의 workspace나 `npm pack` tarball로 쓴다. 아래 설치 명령은 게시 후 기준이다.

## 설치 (게시 후)

```sh
npm install @0disoft/saylo-react @0disoft/saylo-core react@19 react-dom@19
```

`react`는 peer 의존성이며 현재 조건은 React 19다. `react-dom`은 앱에서 렌더링할 때 필요하고, `@0disoft/saylo-core`는 런타임 의존성이다.

## 사용

factory는 모듈에서 한 번만 만들고, Provider와 hook을 같은 factory에서 꺼내 쓴다. Provider에는 앱이 소유한 instance를 넘기며 이 instance는 렌더 사이에 바뀌면 안 된다. 아래 예제는 Vite나 typegen 없이 코어만으로 동작한다.

```tsx
import { createRoot } from 'react-dom/client';
import { parseCatalog, createStore } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';

const ko = parseCatalog('{"greeting":"안녕 {name}"}', { locale: 'ko', namespace: 'demo' });
const en = parseCatalog('{"greeting":"Hello {name}"}', { locale: 'en', namespace: 'demo' });

// 기준 로케일에서 만든 타입이다. saylo-typegen이 같은 형태를 생성한다.
type AppSchema = { 'demo:greeting': { name: number | string } };

export const store = createStore<AppSchema>({ baseLocale: 'ko', locale: 'en', catalogs: [ko, en] });
export const { SayloProvider, useI18n } = createSayloReact<AppSchema>();

function Greeting() {
  const { t, locale, setLocale } = useI18n();
  return (
    <button onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}>
      {t('demo:greeting', { name: 'Saylo' })}
    </button>
  );
}

createRoot(document.getElementById('root')!).render(
  <SayloProvider instance={store}>
    <Greeting />
  </SayloProvider>,
);
```

`useI18n`은 그 렌더의 불변 snapshot과 `setLocale`을 돌려준다. 같은 snapshot·instance에서는 hook 결과가 유지되고, 같은 문구나 비활성 로케일 수정은 다시 렌더하지 않는다. Provider는 instance의 수명을 소유하지 않으므로 앱이 `store.dispose()`로 정리한다. lazy instance(`createI18n`)를 쓰면 `setLocale`이 `Promise<void>`가 되고 `loadNamespace`가 함께 온다.

파일 저장 즉시 반영, `virtual:saylo`, SSR hydration은 아래 관련 패키지의 Vite 연결로 넘긴다. 저장소의 [React 예제](https://github.com/0disoft/saylo/tree/main/examples/react)와 [SSR 예제](https://github.com/0disoft/saylo/tree/main/examples/ssr)도 참고할 수 있다.

## 관련 패키지

- [@0disoft/saylo-core](https://github.com/0disoft/saylo/tree/main/packages/core#readme) — 파싱·검증·store
- [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme) — `virtual:saylo`·dev 연결·SSR
- [@0disoft/saylo-typegen](https://github.com/0disoft/saylo/tree/main/packages/typegen#readme) — `AppSchema` 생성

## 버전

Node.js·TypeScript 지원 범위는 아직 확정하지 않았다. peer 조건은 React 19이고, Vite 8은 [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme)의 조건이다.