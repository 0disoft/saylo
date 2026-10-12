# 빈 폴더에서 Vue로 Saylo 시작하기

Saylo 저장소에서 Vue 3 + Vite 8 스타터를 저장소 밖 빈 폴더로 내보내 설치·실행한다. Vue 바인딩(`@0disoft/saylo-vue`)은 로컬 private 패키지라 npm registry에서 설치할 수 없다. 그래서 내보내기가 워크스페이스 tarball을 스타터 폴더 안 `vendor/`에 동봉하고, 소비 앱은 `file:`로 그 tarball만 설치한다. 내보낸 폴더는 Saylo workspace·디렉터리 링크·루트 스크립트에 의존하지 않는다.

## 전제

- Node.js 24.x와 npm이 필요하다. Saylo 패키지의 `engines.node`는 `24.x`다.
- 내보내기는 Saylo 저장소 checkout에서 실행한다. `prepare:starter:vue`가 먼저 `npm run build`를 돌리므로 저장소 의존성 설치가 선행돼야 한다.
- 대상 폴더는 저장소 밖이어야 하고 비어 있어야 한다. 파일이 하나라도 있으면 내보내기를 거부하고 덮어쓰지 않는다.
- 도구는 메이저 범위만 적는다. Vue 3, Vite 8, `@vitejs/plugin-vue` 6, TypeScript 6, `vue-tsc` 3이다. 스타터의 TypeScript 6·vue-tsc 3은 본체가 쓰는 TypeScript 7과 분리된 도구이고, 루트 TypeScript 7은 그대로다.
- Vue 바인딩과 스타터는 게시하지 않는다. `@0disoft/saylo-vue`의 `private`는 `true`, `version`은 `0.1.0-alpha.4`지만 이 버전은 registry에 없고, 게시된 다섯 패키지(`alpha`)와 `0.1.0-alpha.5` 후보 어디에도 들어가지 않는다. publish hold다.

## 내보내기

Saylo 저장소 루트에서 실행한다.

```sh
npm run prepare:starter:vue -- --out-dir C:/Users/cherr/Downloads/saylo-vue-starter
```

`prepare:starter:vue`는 `npm run build`로 워크스페이스를 빌드한 뒤 `scripts/prepare-vue-starter.mjs`를 실행한다. 이 스크립트는

- 대상 경로가 저장소 밖이고 비었는지 확인한다. 어긋나면 아무것도 쓰지 않고 종료한다.
- `examples/vue-starter`를 대상으로 복사한다.
- `vendor/`를 만들고 네 패키지(`core`·`vue`·`vite`·`typegen`) tarball을 `npm pack`으로 만든다.
- tarball 이름을 `saylo-<name>.tgz`로 바꾸고 `vendor/manifest.json`을 남긴다.

터미널에는 대상 경로와 함께 `manifest.json`과 같은 내용이 JSON으로 출력된다.

## 내보낸 폴더 구성

| 파일 | 내용 |
| --- | --- |
| [package.json](../examples/vue-starter/package.json) | 스크립트·의존성. Saylo 패키지는 `file:./vendor/*.tgz` |
| [vite.config.mjs](../examples/vue-starter/vite.config.mjs) | Vue plugin과 `saylo()` plugin, 개발 5195·preview 5196 |
| [tsconfig.json](../examples/vue-starter/tsconfig.json) | TypeScript 설정, `virtual:saylo` 타입 포함 |
| [index.html](../examples/vue-starter/index.html) | mount 지점 `#root` |
| [main.ts](../examples/vue-starter/main.ts) | 앱 생성·plugin 설치·종료 정리 |
| [i18n.ts](../examples/vue-starter/i18n.ts) | `createI18n` lazy store와 `createSayloVue` factory |
| [App.vue](../examples/vue-starter/App.vue) | 화면과 개발 연결 |
| [demo-messages.ts](../examples/vue-starter/demo-messages.ts) | 마지막 정상 snapshot 문구 투영 |
| [locales/ko/demo.json](../examples/vue-starter/locales/ko/demo.json) | 기준 로케일 |
| [locales/en/demo.json](../examples/vue-starter/locales/en/demo.json) | 초기 화면 로케일 |
| `vendor/saylo-core.tgz` 등 | 로컬 미게시 tarball 네 개와 `vendor/manifest.json` |

`generated.d.ts`는 스타터에 들어 있지 않다. 설치한 `saylo-typegen` CLI가 만든다.

## vendor/와 버전

`vendor/`에는 저장소에서 만든 네 tarball(`saylo-core.tgz`·`saylo-vue.tgz`·`saylo-vite.tgz`·`saylo-typegen.tgz`)이 들어간다. 파일 이름은 `npm pack` 산출 이름 대신 `saylo-<name>.tgz`로 바꾼다.

- 소스는 로컬 미게시 workspace다. `vendor/manifest.json`의 `source`는 `local-unpublished`이고, 패키지마다 `name`·`version`·`integrity`·`file`을 적는다.
- 버전 문자열은 게시본과 같이 `0.1.0-alpha.4`를 가리킬 수 있지만 바이트는 registry에 게시된 `alpha.4`와 다르다. 로컬 빌드 산출물이라 게시본이 아니라 로컬 소스 스냅샷이다.
- 소비 앱은 `dependencies`에 `file:./vendor/saylo-core.tgz`·`file:./vendor/saylo-vue.tgz`, `devDependencies`에 `file:./vendor/saylo-vite.tgz`·`file:./vendor/saylo-typegen.tgz`를 쓴다. `workspace:`, `file:` 디렉터리, 심볼릭 링크, 루트 스크립트 링크를 쓰지 않는다.

## 설치와 실행

```sh
cd <내보낸 폴더>
npm install --ignore-scripts --no-audit --no-fund
npm run dev
```

- `npm install`은 `vendor/`의 tarball을 그대로 설치한다. registry에서 Saylo 패키지를 받지 않고, `--ignore-scripts`로 설치 스크립트를 돌리지 않는다.
- `npm run dev`는 `typegen`으로 `generated.d.ts`를 만들고 Vite를 띄운다. 주소는 `http://127.0.0.1:5195`이고 `strictPort`라서 포트가 사용 중이면 실패한다.
- `npm run build`는 `typegen` → `vue-tsc --noEmit` → `vite build` 순서다. Vite build는 소비자 타입 검사를 하지 않으므로 `vue-tsc`를 앞에 둔다.
- `npm run preview`는 빌드 결과를 `http://127.0.0.1:5196`에서 보여준다. 라이브 갱신 대신 빌드 시점 카탈로그를 쓴다.

`npm install`이 `package-lock.json`을 만든다. 같은 설치를 재현하려면 `npm ci --ignore-scripts --no-audit --no-fund`를 쓴다.

## 코드 연결

전체 소스는 스타터 파일에 그대로 있으므로 여기서 반복하지 않는다.

- [i18n.ts](../examples/vue-starter/i18n.ts)가 `createI18n`으로 lazy store를 만들고 `createSayloVue`의 `createPlugin`·`useI18n`을 낸다. 카탈로그는 `virtual:saylo/lazy`에서 온다.
- [main.ts](../examples/vue-starter/main.ts)가 `createApp(App).use(createPlugin(store))`로 plugin을 설치한다. plugin은 구독을 만들지 않고 instance도 폐기하지 않으므로 store 수명은 앱이 소유한다. `pagehide`가 `persisted`면 BFCache 복귀를 위해 구독을 남기고, 실제 종료면 `app.unmount()` 뒤 `store.dispose()`로 정리한다. Vite HMR dispose에서도 같은 cleanup을 탄다.
- [App.vue](../examples/vue-starter/App.vue)가 `useI18n` snapshot을 구독하고 `onMounted`에서 `connectDev(store, { catalogSource, onDiagnostic })`로 개발 연결을 붙인다. `onScopeDispose`에서 연결을 끊고 세대 번호를 올려 늦게 도착한 로케일 전환 응답을 버린다.
- 화면 요소는 기본값 `Saylo`인 `#name` 입력, `#note` textarea, `#open-dialog`가 여는 `#confirmation` dialog, `#locale` 선택이다.

## 라이브 수정 확인

1. `#name`에 이름을 넣는다. `{name}`을 쓰는 문구가 그 값으로 바뀐다.
2. `locales/en/demo.json`의 `greeting`을 `Hello {name}`에서 `Updated {name}`으로 고치고 저장한다. 페이지는 처음부터 `en`으로 뜨므로 문구가 그 자리에서 바뀌고, 입력값과 열어 둔 dialog는 그대로 남는다.
3. `locales/ja/demo.json`을 기준과 같은 키로 만들면 `#locale` 목록에 `ja`가 나타나고, 고르면 그 파일을 지연 로딩해 보여준다.
4. 기준 로케일 `ko`에 키를 추가하면 Vite plugin 옵션 `typegen: { outFile: 'generated.d.ts' }`가 `generated.d.ts`를 다시 만든다. 앱 호출부와 생성 타입을 함께 고쳐야 타입이 맞는다.

## 폼·dialog 보존

`projectMessages`는 문구를 전부 계산한 뒤에만 화면을 바꾼다. 로케일 JSON이 깨지거나 키 스키마가 어긋나면 입력값·열린 dialog·포커스를 지우지 않고 마지막 정상 문구를 보여주며 진단을 띄운다. 파일을 복구하면 진단이 풀리고 저장된 입력으로 다시 보간한다. 기준 키 삭제나 필수 인자 추가처럼 기준 스키마 자체를 바꾸는 편집은 앱 호출부와 타입도 함께 고쳐야 한다.

## 타입 생성

```sh
npm run typegen
```

`saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts`를 실행한다. dev와 build가 앞에서 typegen을 돌리므로 따로 부를 일은 드물다. 생성 타입은 설정이 아니라 `createI18n<AppSchema>`의 제네릭에 연결한다. 기준의 키·인자를 바꾸면 `generated.d.ts`가 다시 만들어져야 하고, 문구만 바꾸는 편집은 스키마를 바꾸지 않아 타입 재생성을 기다리지 않고 반영된다.

## 같은 메이저 업데이트

- 네 tarball은 로컬 소스 스냅샷이라 패키지를 다시 만들면 새 tarball이 필요하다. 새로 내보낼 때는 비어 있는 새 폴더에 다시 내보낸다.
- 같은 메이저 안의 갱신은 exporter를 다시 돌려 tarball을 새로 받고, 설치는 `package-lock.json`과 `npm ci`로 재현한다. 저장소가 게시본을 새로 내면 그 버전에서도 같은 절차를 다시 확인한다.
- 스타터의 도구는 메이저 범위만 적으므로(`vue: "3"`, `vite: "8"`, `@vitejs/plugin-vue: "6"`, `typescript: "6"`, `vue-tsc: "3"`) 같은 메이저의 안정 업데이트는 lockfile 갱신으로 따라가고, 새 메이저는 호환성 확인 뒤 승격한다.

이 문서는 게시·로그인·private registry 설치 절차를 다루지 않는다. Vue 패키지는 publish hold이고 스타터는 그 게시 상태를 바꾸지 않는다.

## 저장소 검증

저장소 루트의 `npm run verify:starter:vue`가 내보내기부터 브라우저 확인까지 묶는다. 저장소를 빌드한 뒤 스타터를 저장소 밖 임시 폴더로 내보내고, 실제 tarball을 링크 없이 설치해 확인한다.

- 실제 tar 파일 설치와 symlink 부재
- 새 Vite 개발 서버 브라우저에서 라이브 편집, 로케일 추가, 깨진 JSON 복구
- 설치본 CLI typegen으로 `generated.d.ts` 생성, 스타터 자체 빌드의 CLI typegen과 `vue-tsc`
- production preview에서 언어 전환·폼 입력·dialog 동작

2026-10-13 Node 24.18.0·Vite 8.3.4·Chromium 154에서 독립 설치와 개발 9단계·production 4단계를 통과했다. 네 tarball의 SHA-512와 설치 lockfile integrity를 대조했고, 기준 키 추가 후 개발 서버의 타입 갱신과 설치된 CLI·Vue 템플릿 검사·production 빌드도 통과했다. 브라우저 오류·경고는 없었다. 현재 출력은 `.release/vue-starter-report.json`에 남긴다. 라이브러리 게시나 원격 CI를 실행한 결과는 아니다.
