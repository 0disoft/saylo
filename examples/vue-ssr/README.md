# Vue 3 SSR hydration 데모

Vue 3 `createSSRApp`와 `h` 렌더 함수로 서버 렌더 HTML을 브라우저에서 hydrate하는 예제다. 게시본이 아니라 루트 workspace의 `@0disoft/saylo-core`·`@0disoft/saylo-vue`·`@0disoft/saylo-vite`를 그대로 연결해 쓴다. 개발용 데모 서버일 뿐이고, 실제 서비스에 올리는 production SSR 배포 구성은 아니다.

SSR과 hydration이 무엇인지, 어떤 전제를 지켜야 하는지는 Vue 공식 문서를 따른다. [Server-Side Rendering (SSR)](https://vuejs.org/guide/scaling-up/ssr.html)

저장소 루트에서 설치한 뒤 실행한다.

```sh
npm ci --ignore-scripts
npm run dev:vue:ssr
```

`dev:vue:ssr`는 workspace 패키지를 먼저 빌드하고 `examples/vue-ssr/server.mjs`를 띄운다. 기본 주소는 `http://127.0.0.1:5193`이고 쿼리로 로케일을 고른다.

```text
http://127.0.0.1:5193/?locale=ko
http://127.0.0.1:5193/?locale=en
```

## 파일 구성

`examples/vue-ssr`는 `examples/vue`와 별도 앱이다. 렌더 함수와 서버 요청 수명주기를 보여주는 게 목적이라 `App.vue` 대신 `h`로 트리를 만든다. 로케일 파일은 `examples/vue/locales`를 그대로 쓰고 따로 복사하지 않는다. 기준 로케일은 `ko`, 초기 namespace는 `demo`, timeZone은 `UTC`다.

`app.mjs`는 `createSayloVue()` factory를 모듈 범위에서 한 번 만들고, `createApp(instance)`가 `createSSRApp(Form).use(createPlugin(instance))`로 그 요청의 instance를 설치한다. 서버 요청마다 `createRequestI18n`으로 instance를 만들고 렌더가 끝나면 `finally`에서 dispose한다. 요청 간에 instance를 재사용하지 않고, 서버 쪽에 공용 singleton instance는 두지 않는다. 직렬화한 boot snapshot(`serializeBootSnapshot`)을 HTML에 실어 보내고, 클라이언트는 `decodeBootSnapshot`으로 초기 snapshot을 복원해 하이드레이션에 쓴다.

이름·요청 사항 입력은 uncontrolled DOM input이다. 하이드레이션 이후 `onMounted`에서 값을 Vue ref로 읽어 echo 문구를 갱신한다. 하이드레이션 전에 이미 입력해 둔 값이 있어도 그대로 살아남고, 프레임워크가 input을 다시 그리지 않는다.

`connectDev`는 `app.mount`가 동기로 끝난 뒤에 건다. `pagehide`가 `persisted`면 BFCache 복귀를 위해 구독을 남기고, 실제 페이지 종료면 `disconnectDev`→`app.unmount()`→`client.dispose()` 순서로 정리한다. Vite HMR dispose에서도 같은 cleanup을 탄다.

## 하이드레이션 확인

1. `?locale=ko`로 열고 이름·요청 사항을 입력한다. 서버가 그린 HTML이 그대로 살아 있고, echo 문구만 갱신된다.
2. 새로고침해 하이드레이션 오류 없이 같은 화면이 뜨는지 본다. boot snapshot의 로케일과 클라이언트 초기 snapshot이 일치해야 한다.
3. 개발 모드에서 `examples/vue/locales/ko/demo.json` 문구를 고치고 저장한다. 하이드레이션 이후 라이브 수정이 반영되고 입력값·포커스·선택 범위는 유지된다.
4. 언어를 `en`으로 바꿔 `examples/vue/locales`가 로케일 전환에도 쓰이는지 본다.

## Rich text와 복구

`app.mjs`는 `renderRichText`로 `rich-preview` 문단을 그린다. `strong`·`link`를 강조·링크 요소에 매핑하고, 링크의 `href`는 앱이 정한 `#order-form`을 가리킨다. parts는 `snapshot.tParts('demo:rich', { name: name || 'Saylo' })`로 만든다. SSR과 초기 하이드레이션은 이름이 비어 있어 `Saylo`로 같은 마크업을 낸다. `onMounted`가 하이드레이션 전에 입력한 값을 ref로 가져오면 강조 문구도 실제 이름으로 갱신된다.

화면 번역은 전체를 먼저 계산한다. 잘못된 마커를 만나면 `render-error` 안내를 띄우고, 마지막 정상 snapshot을 현재 `name`·`count`로 다시 포맷해 유지한다. 번역을 고쳐 저장하면 오류 안내가 사라지고 정상 렌더로 돌아간다. 첫 서버 렌더부터 잘못된 경우에는 마지막 정상 snapshot이 없으므로 요청을 실패시킨다.

## 자동 확인

```sh
npm run verify:demo:vue:ssr
```

`npm run build` 뒤 `scripts/verify-vue-hydration.mjs`를 headless Chromium으로 돌린다. 원본 번역 파일은 고치지 않고 `examples/vue/locales`를 `.release` 아래 격리된 fixture로 복사해 검사한다. 확인 항목은 `ko`·`en` 동시 SSR, boot와 초기 하이드레이션 snapshot 일치, 하이드레이션 전 입력·포커스·선택 범위·DOM 정체성 유지, 서버 카탈로그 수정 후 sync까지의 gap, 언어 전환, 하이드레이션 이후 라이브 수정, cleanup 뒤 리스너 수 0, 런타임 오류·경고 없음이다. 여기에 rich SSR 문자열 escape와 marker 매핑, rich 라이브 리터럴 삽입 시 DOM 정체성 유지, 잘못된 rich marker에서의 복구와 현재 입력 추적이 더해진다.

예제는 이제 요청 instance를 `app.use(createPlugin(instance))`로 설치한다. 2026-10-12 같은 환경에서 이 설치 경로도 동시 SSR과 한국어·영어 각각 8단계를 다시 통과했다. 런타임 오류·경고는 없었고, 종료 후 컴포넌트 구독과 폐기 리스너는 모두 0이었다.

2026-10-12 Node 24.18.0·Vite 8.3.4·headless Chromium 154에서 동시 SSR과 한국어·영어 각각 8단계의 브라우저 검사를 통과했다(당시 설치 경로는 부모 컴포넌트 `provideI18n`). 런타임 오류·경고는 없었고, 종료 후 컴포넌트 구독과 폐기 리스너는 모두 0이었다. 로컬 보고서는 `.release/vue-hydration-report.json`에 생성한다. 개발 서버에서 확인한 결과이며 production 배포·Nuxt 통합·실제 BFCache 복귀는 검증 범위에 포함하지 않는다. BFCache 검사는 합성 `pagehide` 이벤트의 `persisted` 분기만 확인한다.

RichText를 연결한 뒤 Node 24.18.0·Vite 8.3.4·HeadlessChrome 155에서 동시 SSR과 한국어·영어 각각 12단계를 통과했다. 추가한 4단계는 rich 문구 편집·잘못된 마커·오류 중 현재 이름 반영과 HTML 이스케이프·정상 복구다. 강조·링크 DOM과 입력·포커스·선택 범위를 유지했고, 오류·경고와 종료 후 남은 구독은 없었다. 로그는 `.release/vue-rich-ssr.log`, 보고서는 `.release/vue-hydration-report.json`이다.
