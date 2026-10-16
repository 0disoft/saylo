# Vue 3 데모

Vue 3 어댑터의 라이브 카탈로그 동작을 브라우저에서 확인하는 예제다. 게시본이 아니라 루트 workspace의 `@0disoft/saylo-vue`·`@0disoft/saylo-vite`를 그대로 연결해 쓴다. 브라우저 전용이고 SSR 라우트는 두지 않는다.

저장소 루트에서 설치한 뒤 실행한다.

```sh
npm ci --ignore-scripts
npm run dev:vue
```

`dev:vue`는 workspace 패키지를 먼저 빌드하고 `examples/vue/vite.config.mjs`로 개발 서버를 띄운다. 기본 주소는 `http://127.0.0.1:5192`이고 `strictPort`라서 포트가 사용 중이면 실패한다.

## 파일 구성

`i18n.ts`가 `createI18n`으로 store를 만들고 `createSayloVue`의 `createPlugin`·`useI18n`을 낸다. `main.ts`가 `createApp(App).use(createPlugin(store))`로 plugin을 설치하며 이 store를 소유한다. `App.vue`는 `useI18n` snapshot과 `connectDev` 개발 연결을 구독한다. 기준 로케일은 `ko`, 초기 namespace는 `demo`, timeZone은 `UTC`다.

## 라이브 수정 확인

1. 이름·요청 사항·상품 수를 입력하고 확인 창 열기로 dialog를 연다. 실제 `<dialog>`가 열린다.
2. dialog가 열린 채 확인 메모에 포커스가 있는 상태에서 `examples/vue/locales/ko/demo.json`의 `heading`과 `dialogTitle`을 고치고 저장한다.
3. 화면 제목과 열린 dialog 문구가 즉시 바뀌고, 입력값·dialog 열림·포커스는 그대로 남는다.

## 로케일

로케일은 `examples/vue/locales`만 쓴다. react 데모가 쓰는 `examples/vanilla/locales`와 공유하지 않는다.

- `examples/vue/locales/<locale>/demo.json`을 기준 로케일과 같은 키로 추가하면 언어 선택 목록에 나타나고, 고를 때 지연 로딩한다.
- 키 구성과 ICU 인자는 기준 스키마에 맞춘다. `summary`의 `count` 인자를 유지하고 번역만 바꾼다. `heading`·`dialogTitle`은 인자가 없는 문자열이다.
- 지금 고른 로케일 파일을 지우면 기준 언어 `ko` 화면으로 돌아간다.
- JSON이 깨지면 마지막 정상 화면을 유지하고 진단을 띄운다.
- 키가 빠지면 수정 안내와 함께 마지막으로 번역된 화면을 유지한다.

## rich text 미리보기

`App.vue`가 `rich-preview` 문단을 더한다. `renderRichText`를 감싼 `RichPreview`를 같은 파일에서 만들고 템플릿의 `rich-preview` 문단에 `<RichPreview />`를 둔다. `strong`은 `<strong>`에, `link`는 같은 화면의 주문 폼(`#order-form`)으로 가는 링크에 매핑하고, 이름 입력이 비어 있으면 `Saylo`를 쓴다.

```ts
const richRenderers: RichTextRenderers = {
  strong: children => h('strong', children),
  link: children => h('a', { href: '#order-form' }, children),
};
const RichPreview = () => renderRichText(text.value.rich, richRenderers);
```

helper는 형제 tag를 key 있는 `Fragment`로 그리므로, 문구를 편집하거나 literal을 삽입해도 매핑한 요소의 identity와 state가 유지된다.

`examples/vue/locales/ko/demo.json`·`en/demo.json`에 rich 키를 더한다. 한국어는 `<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요.`이고, 영어는 `<strong>{name}</strong>, review <link>your order</link>.`로 React·Svelte 데모와 같다. 생성 타입에도 `demo:rich`가 더해진다.

`projectDemoMessages`는 마지막 정상 전체 번역 투영에 rich parts를 담는다. rich markup이 잘못된 뒤에도 이름·수량·입력 변경은 마지막 정상 snapshot을 현재 인자로 다시 포맷한다.

로컬 검증에서 데모 template 검사와 production 빌드, HeadlessChrome 155 recovery warm 16개·cold 3개(오류 없음)를 확인했다. 이 미리보기는 게시본에 없는 로컬 변경이고, 계약은 [Vue 패키지 안내](../../packages/vue/README.md)를 따른다.

## 문의용 진단 자료

지원 패널은 `createSupportRecorder`로 관측만 모은다. `진단 자료 만들기`로 JSON을 직접 생성해 검토하고, `오류 기록 지우기`로 기록과 상태를 비운다. 자동 전송은 하지 않는다. 보고서에는 오류 코드·숫자 위치·연결 상태·허용한 환경 버전만 들어가고, 번역 원문·파일 경로·입력값은 제외한다.

## 빌드

```sh
npm run setup:vue
npm run build:vue
```

첫 빌드 전에 `setup:vue`로 독립 템플릿 검사 도구를 설치한다. workspace 패키지 빌드에 이어 기준 카탈로그 타입 생성, Vue 템플릿 검사, Vite production 빌드를 순서대로 실행한다. `tools/vue`는 TypeScript 6·vue-tsc 3을 쓰며 본체의 TypeScript 7 컴파일러와 분리돼 있다. 도구 의존성을 바꾸지 않았다면 다음 빌드에서 setup을 반복할 필요는 없다.

## 복구 검증

```sh
npm run verify:demo:vue:recovery
```

`.release` 아래에 fixture를 복사해 임시 앱을 만들고 headless Chromium으로 확인한 뒤 폴더를 정리한다. 정상 라이브 편집·깨진 JSON·로케일 추가/선택/삭제·빈 카탈로그·누락 namespace 복구 12단계에 rich 4단계(rich 편집·무효 markup·fallback 입력·복구)를 더한 warm 16단계와 새 서버의 빈 첫 실행·입력·복구 cold 3단계를 확인한다. 입력값·열린 모달·포커스·생성한 진단 자료를 유지하며, 정상 저장에서는 확인 메모의 선택 범위도 검사한다. 원본 번역 파일은 고치지 않는다.

## 정리

`main.ts`가 instance를 소유한다. `app.use(createPlugin(store))`로 설치한 plugin은 구독을 만들지 않고 instance도 폐기하지 않으므로 정리는 `main.ts`가 맡는다. `pagehide`가 `persisted`면 BFCache 복귀를 위해 구독을 남기고, 실제 페이지 종료면 `app.unmount()` 뒤 `store.dispose()`로 정리한다. Vite HMR dispose에서도 같은 cleanup을 탄다. `App.vue`는 `onScopeDispose`에서 개발 연결을 끊고 세대 번호를 올려 늦게 도착한 응답을 버린다.
