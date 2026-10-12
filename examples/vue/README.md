# Vue 3 데모

Vue 3 어댑터의 라이브 카탈로그 동작을 브라우저에서 확인하는 예제다. 게시본이 아니라 루트 workspace의 `@0disoft/saylo-vue`·`@0disoft/saylo-vite`를 그대로 연결해 쓴다. 브라우저 전용이고 SSR 라우트는 두지 않는다.

저장소 루트에서 설치한 뒤 실행한다.

```sh
npm ci --ignore-scripts
npm run dev:vue
```

`dev:vue`는 workspace 패키지를 먼저 빌드하고 `examples/vue/vite.config.mjs`로 개발 서버를 띄운다. 기본 주소는 `http://127.0.0.1:5192`이고 `strictPort`라서 포트가 사용 중이면 실패한다.

## 파일 구성

`i18n.ts`가 `createI18n`으로 store를 만들고 `createSayloVue`의 `provideI18n`·`useI18n`을 낸다. `main.ts`가 이 store를 소유하고, `App.vue`는 `useI18n` snapshot과 `connectDev` 개발 연결을 구독한다. 기준 로케일은 `ko`, 초기 namespace는 `demo`, timeZone은 `UTC`다.

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

`.release` 아래에 fixture를 복사해 임시 앱을 만들고 headless Chromium으로 확인한 뒤 폴더를 정리한다. 정상 라이브 편집·깨진 JSON·로케일 추가/선택/삭제·빈 카탈로그·누락 namespace 복구 12단계와 새 서버의 빈 첫 실행·입력·복구 3단계를 확인한다. 입력값·열린 모달·포커스·생성한 진단 자료를 유지하며, 정상 저장에서는 확인 메모의 선택 범위도 검사한다. 원본 번역 파일은 고치지 않는다.

## 정리

`main.ts`가 instance를 소유한다. `pagehide`가 `persisted`면 BFCache 복귀를 위해 구독을 남기고, 실제 페이지 종료면 `app.unmount()` 뒤 `store.dispose()`로 정리한다. Vite HMR dispose에서도 같은 cleanup을 탄다. `App.vue`는 `onScopeDispose`에서 개발 연결을 끊고 세대 번호를 올려 늦게 도착한 응답을 버린다.
