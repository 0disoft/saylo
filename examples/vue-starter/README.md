# Saylo Vue 스타터

Saylo의 Vue 3 + Vite 8 스타터다. Saylo 저장소가 이 폴더를 저장소 밖 빈 폴더로 내보내고, 소비 앱은 저장소 workspace에 의존하지 않고 `vendor/`의 tarball만으로 설치·실행한다.

## 이 폴더가 만들어지는 방식

Saylo 저장소 루트에서 실행한다.

```sh
npm run prepare:starter:vue -- --out-dir <저장소 밖 빈 폴더>
```

대상은 저장소 밖이어야 하고 비어 있어야 한다. 파일이 있으면 덮어쓰지 않고 거부한다. 내보내기는 저장소를 먼저 빌드한 뒤 이 폴더를 복사하고 `vendor/`에 네 패키지 tarball과 `vendor/manifest.json`을 만든다.

## vendor/와 버전

`vendor/`의 `saylo-core.tgz`·`saylo-vue.tgz`·`saylo-vite.tgz`·`saylo-typegen.tgz`는 로컬 미게시 workspace를 `npm pack`으로 묶은 tarball이다.

- `vendor/manifest.json`의 `source`는 `local-unpublished`다.
- 버전 문자열은 게시본과 같이 `0.1.0-alpha.4`지만 바이트는 게시된 `alpha.4`와 다르다. 로컬 빌드 산출물이라 게시본이 아니다.
- `@0disoft/saylo-vue`는 private이고 게시하지 않는다. 그래서 registry 설치 대신 `file:` tarball을 쓴다.

## 설치와 실행

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run dev      # typegen 뒤 개발 서버 127.0.0.1:5195 (strictPort)
npm run typegen  # saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts
npm run build    # typegen -> vue-tsc --noEmit -> vite build
npm run preview  # 빌드 결과 127.0.0.1:5196 (strictPort)
```

`--ignore-scripts`로 설치 스크립트를 돌리지 않는다. `package-lock.json`이 만들어지면 `npm ci --ignore-scripts --no-audit --no-fund`로 같은 설치를 재현한다. 도구는 메이저 범위만 적는다. Vue 3, Vite 8, `@vitejs/plugin-vue` 6, TypeScript 6, `vue-tsc` 3이다.

`generated.d.ts`는 저장소에 들어 있지 않고 `npm run typegen`이 만든다. dev와 build도 앞에서 typegen을 돌린다.

## 로케일

- `locales/<locale>/demo.json`을 기준 로케일 `ko`와 같은 키로 추가하면 `#locale` 목록에 나타나고, 고를 때 지연 로딩한다.
- 처음 화면 로케일은 `en`이고 기준은 `ko`다.
- `locales/en/demo.json`의 `greeting`을 `Hello {name}`에서 `Updated {name}`으로 바꾸고 저장하면 문구가 즉시 바뀐다.
- 기준 로케일에 키를 추가하면 `generated.d.ts`를 다시 만들고 앱 호출부 타입도 맞춰야 한다.
- 안 쓰는 로케일 파일을 지우면 그 로케일은 목록에서 빠진다.

## rich 문구

`App.vue`의 `#rich-preview`는 `snapshot.tParts('demo:rich', { name: name || 'Saylo' })` 결과를 `renderRichText`로 그린다. `strong`·`link` 태그는 앱이 정하고 `link`의 `href`는 `#order-form`이다. `locales/en/demo.json`·`locales/ko/demo.json`에 `rich` 문구가 들어 있고 다른 키와 같은 규칙으로 고친다.

`#selected-locale`은 같은 factory의 `useI18nSelector(snapshot => snapshot.locale)`을 쓰는 자식 컴포넌트가 그린다. rich 마커가 어긋나면 `#render-error`에 진단이 뜨고 마지막 정상 문구를 현재 이름으로 다시 보간한다.

## 폼·dialog 보존

`demo-messages.ts`의 `projectMessages`가 문구를 rich까지 전부 계산한 뒤에만 화면을 바꾼다. 로케일 JSON이 깨지거나 키가 어긋나면 입력값·열린 dialog·포커스를 지우지 않고 마지막 정상 문구를 보여주며 진단을 띄운다. 파일을 복구하면 저장된 입력으로 다시 보간한다.

## 정리

`main.ts`가 instance를 소유한다. `app.use(createPlugin(store))`로 설치한 plugin은 구독을 만들지 않고 instance도 폐기하지 않으므로 정리는 `main.ts`가 맡는다. `pagehide`가 `persisted`면 BFCache 복귀를 위해 구독을 남기고, 실제 종료면 `app.unmount()` 뒤 `store.dispose()`로 정리한다. Vite HMR dispose에서도 같은 cleanup을 탄다. `App.vue`는 `onScopeDispose`에서 개발 연결을 끊고 세대 번호를 올려 늦게 도착한 응답을 버린다. 앱 구조를 바꾸면 이 폐기 책임도 직접 관리한다.
