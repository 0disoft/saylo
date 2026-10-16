# Saylo Svelte 스타터

Saylo의 Svelte 5 + Vite 8 스타터다. Saylo 저장소가 이 폴더를 저장소 밖 빈 폴더로 내보내고, 소비 앱은 저장소 workspace 없이 `vendor/`의 로컬 tarball만으로 설치·실행한다. Node 24.x가 필요하다.

## 내보내기

Saylo 저장소 루트에서 실행한다.

```sh
npm run prepare:starter:svelte -- --out-dir <저장소 밖 빈 폴더>
```

대상은 저장소 밖의 빈 폴더여야 한다. 파일이 있으면 덮어쓰지 않고 거부한다. 내보내기는 저장소를 먼저 빌드한 뒤 이 폴더를 복사하고 `vendor/`에 tarball 네 개와 `vendor/manifest.json`을 만든다.

## 설치와 실행

내보낸 폴더에서 실행한다.

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run dev      # typegen 뒤 개발 서버 127.0.0.1:5199 (strictPort)
npm run build    # typegen -> svelte-check -> vite build
npm run preview  # 빌드 결과 127.0.0.1:5200 (strictPort)
```

`svelte-check` 4의 peer 범위에 맞춰 TypeScript 6을 사용한다.

## vendor/와 버전

`saylo-core.tgz`·`saylo-svelte.tgz`·`saylo-vite.tgz`·`saylo-typegen.tgz`는 로컬 workspace를 `npm pack`으로 묶은 tarball이고 `package.json`이 `file:`로 참조한다.

- `vendor/manifest.json`의 `source`는 `local-unpublished`이고 패키지별 `version`·`integrity`가 기록된다.
- 버전 문자열은 게시본 `0.1.0-alpha.4`와 같지만 바이트는 게시본과 다르다. 로컬 빌드 산출물이라 게시하지 않는다.

## 화면 구성

- `i18n.ts`가 store와 `setSayloContext`·`getI18nSelector`를 만든다. `App.svelte`는 context로 받은 `$i18n`에서 문구를 읽고, `SelectedLocale.svelte`가 `getI18nSelector(snapshot => snapshot.locale)`로 로케일만 구독한다.
- `#rich-preview`는 `<RichText parts={text.rich} renderers={{ strong, link }} />`를 그린다. `strong`·`link`는 `App.svelte`의 snippet이고 `link`의 `href`는 `#order-form`이다.
- `demo-messages.ts`의 `projectMessages`가 rich까지 전부 계산한 뒤 화면을 바꾼다. rich 마커가 어긋나면 `#render-error`에 진단을 띄우고 마지막 정상 문구를 현재 이름으로 다시 보간한다.
- 첫 화면 로케일은 `en`, 기준 로케일은 `ko`이고 `generated.d.ts`는 `npm run typegen`이 만든다. 이름 인자는 `name || 'Saylo'`다.
- `main.ts`가 mount한 app과 store를 소유한다. `pagehide`가 `persisted`면 BFCache 복귀를 위해 남기고, 실제 종료면 `unmount(app)` 뒤 `store.dispose()`로 정리한다. Vite HMR dispose도 같은 cleanup을 탄다. `App.svelte`는 `onDestroy`에서 개발 연결을 끊고 세대 번호를 올려 늦은 응답을 버린다.

## 저장소 검증

루트에서 `npm run verify:starter:svelte:local`이 저장소 밖 export, symlink 없는 설치, 타입 템플릿 검사, build, dev·production 브라우저 확인을 한 번에 돌린다. 임시 폴더를 만들어 검사하고 끝나면 지운다.

게시본 설치 안내는 Saylo 저장소의 docs/getting-started-svelte.md를 따른다.
