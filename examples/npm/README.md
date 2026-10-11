# Saylo npm 예제 (Vite + vanilla JS)

프레임워크 없이 Vite 8 위에서 게시된 npm 패키지를 그대로 설치해 쓰는 standalone 예제다. `@0disoft/saylo-core`와 `@0disoft/saylo-vite`를 npm registry에서 받아 쓰며, 개발 서버에서 로케일 JSON만 고치면 화면 문구가 즉시 바뀐다. Saylo 패키지를 다시 컴파일하지 않는다.

## 요구 사항

- Node.js 24.x, npm

## 의존성

| 구분 | 패키지 |
| --- | --- |
| dependencies | `@0disoft/saylo-core@alpha` |
| devDependencies | `@0disoft/saylo-vite@alpha`, `vite@8` |

이 예제는 루트 workspace에 속하지 않는 독립 `private` 패키지다. `workspaces`를 쓰지 않고, `file:`·`workspace:`·alias 링크 없이 npm registry에 게시된 실물 패키지를 설치한다. 그래서 루트 빌드가 필요 없다.

`package.json`은 `alpha` tag를 사용하고, 현재 lockfile은 core·Vite·Vite의 전이 의존성 typegen을 `0.1.0-alpha.4`로 잠근다. `npm ci --workspaces=false`는 이 lockfile을 재현한다. tag가 이동한 뒤 새 게시본을 받으려면 `npm update @0disoft/saylo-core @0disoft/saylo-vite --workspaces=false`를 실행한다.

## 실행

```sh
cd examples/npm
npm install --workspaces=false
npm run dev      # http://127.0.0.1:5188 (strictPort)
npm run build    # production 빌드
npm run preview  # 빌드 결과 미리보기 (127.0.0.1:5189)
```

`npm run dev`는 127.0.0.1:5188에서 고정 포트로 뜬다.

## 화면 구성

Vite 플러그인은 `saylo({ localesDir: 'locales', baseLocale: 'ko', initialLocale: 'en', timeZone: 'UTC' })`로 붙이고, 앱은 `virtual:saylo`의 eager 값으로 store를 만든다.

개발 연결은 앱 모듈의 `import.meta.hot`을 `connectDev(store, { hot: import.meta.hot, onUpdate, onDiagnostic })`로 넘겨 현재 앱 모듈의 Vite hot context를 보장한다. 런타임은 설치된 npm 패키지를 쓰므로 Saylo를 다시 빌드하지 않고 JSON만 수정하면 된다.

화면 요소는 `#locale` 선택, 기본값 `Saylo`인 `#name` 입력, `#note` textarea, `#open-dialog` 버튼, `#confirmation` dialog와 그 안의 `#dialog-note`, `#close-dialog` 버튼, `role="status"`인 `#status`다. 번역할 문구는 `h1`·`h2`·`p`·`label` 안의 `span`·`button`의 `data-i18n`에 `demo:heading` 같은 완전 키로 붙는다.

## 로케일 키

`locales/ko/demo.json`과 `locales/en/demo.json`은 같은 8개 키를 쓴다.

| 키 | 쓰임 |
| --- | --- |
| `heading` | 페이지 제목 `h1` |
| `greeting` | 이름을 넣는 인사 문구 (`{name}`) |
| `nameLabel` | 이름 입력 라벨 |
| `noteLabel` | 메모 입력 라벨 |
| `openDialog` | 확인 창 열기 버튼 |
| `dialogTitle` | dialog 제목 (`{name}`) |
| `dialogNoteLabel` | dialog 메모 라벨 |
| `closeDialog` | 닫기 버튼 |

`greeting`과 `dialogTitle`만 `{name}` 인자를 쓴다. 앱은 모든 `data-i18n` 노드를 `snapshot.t(key, { name: nameInput.value || 'Saylo' })`로 채우므로, 인자가 없는 키에는 여분의 `name`이 무시되고 `{name}`을 쓰는 키에는 항상 값이 들어간다.

## 라이브 수정 확인

1. `npm run dev`로 연 뒤 `#name`에 이름을 입력한다.
2. `locales/en/demo.json`의 `heading`을 `"Live update from npm"`으로 바꾸고 저장한다. 페이지는 처음부터 `en`으로 뜨므로 `h1` 문구가 즉시 바뀌고 `#name` 입력값은 그대로 남는다.
3. `#open-dialog`로 dialog를 열고 `#dialog-note`에 값을 입력한 채로 같은 JSON을 다시 저장한다. 열린 dialog 안의 문구가 갱신되고 입력값과 dialog 열림 상태는 유지된다.
4. `locales/ja/demo.json`을 추가하고 `en`과 같은 키를 넣는다. `#locale` 선택에 `ja`가 나타나고, 고르면 넣은 키 값대로 문구가 바뀐다.

키를 지우거나 필수 인자를 추가하지 않는 정상 편집은 기준 스키마를 유지하므로 위처럼 폼·dialog 상태가 보존된다. 키 삭제나 필수 인자 추가처럼 스키마를 깨는 편집은 이 보존 범위 밖이다.

## 검증 범위

### alpha.4 설치·빌드·라이브 수정 (2026-10-11)

Windows, Node 24.18.0, Vite 8.3.3에서 실행했다. 이 예제가 쓰는 core·Vite·typegen은 `0.1.0-alpha.4`다.

- `npm update @0disoft/saylo-core @0disoft/saylo-vite --workspaces=false --ignore-scripts --no-audit --no-fund`가 exit 0으로 끝났다. `package.json`의 `alpha` tag는 그대로이고, Saylo 세 패키지 밖 서드파티 lockfile 항목과 키는 갱신 전후가 완전히 같다.
- 같은 옵션의 `npm ci --workspaces=false --ignore-scripts --no-audit --no-fund`가 exit 0이다. 세 패키지는 registry 실물 tarball로 설치되고 symlink가 아니며, realpath는 예제의 `node_modules` 안쪽이다. 설치본 integrity는 [승인 manifest](../../releases/0.1.0-alpha.4.json)와 일치했다.
- `npm run build`가 exit 0이다. 45 modules, 출력 JavaScript 28.23 kB(gzip 10.09 kB). 루트 workspace 빌드 없이 게시본만 사용했다.
- IAB 실브라우저(`http://127.0.0.1:5188`)에서 dialog를 열고 `#name`에 `Alpha4`, `#note`에 `keep note alpha4`, `#dialog-note`에 `PreserveAlpha4`를 넣었다. 첫 저장 뒤 5ms를 기다려 서로 다른 내용으로 두 번째 저장을 했다. 화면 문구는 `Rapid2 final save`, dialog 제목은 `Rapid2 final, Alpha4`로 최종 반영됐고, 세 입력값과 dialog 열림·포커스는 유지됐다.
- `locales/ja/demo.json`을 추가했을 때 `#locale` 목록이 `en`·`ja`·`ko`가 됐고, 열린 dialog의 입력값과 열림·포커스는 유지됐다. `#close-dialog`로 닫고 `ja`를 고른 뒤 다시 열면 `h1`이 `Alpha4 Japanese catalog`, dialog 제목이 `Japanese catalog, Alpha4`로 뜨고 세 입력값도 유지됐다. console warn/error는 없었다.
- 사전 첫 visible 관측과 복원 중 `#dialog-note`가 입력 간섭처럼 변한 관측은 상태 보존 판정에 넣지 않았다. 복원 과정에서 본 `ja` 삭제 후 `ko` fallback도 관측으로만 남긴다. 임시로 고친 `en` JSON은 원래 bytes로 되돌리고 `ja` 파일 삭제, 브라우저 탭 close, 개발 서버 stop까지 마쳤다.

근거는 [npm 예제 alpha.4 검증 기록](../../review/npm-example-alpha4-2026-10-11.json)에 있다. `npm run preview`는 실행하지 않았고 새 성능 수치도 측정하지 않았다.

### alpha.2 설치·빌드 (2026-10-09)

Windows, Node 24.18.0, npm 12.0.2, Vite 8.3.3에서 실행했다.

- `npm update @0disoft/saylo-core @0disoft/saylo-vite --workspaces=false --ignore-scripts --no-audit --no-fund`로 Saylo 세 패키지만 alpha.2로 갱신했다. `package.json`의 `alpha` tag와 서드파티 lockfile 항목은 유지했다.
- 갱신한 lockfile로 `npm ci --workspaces=false --ignore-scripts --no-audit --no-fund`를 통과했다. core·Vite·typegen의 설치 버전은 모두 `0.1.0-alpha.2`이고, registry tarball URL·integrity가 [승인 manifest](../../releases/0.1.0-alpha.2.json)와 일치했다. 세 패키지 모두 symlink가 아니며 realpath는 예제의 `node_modules` 안쪽이다.
- `npm run build` 통과: 44 modules, 출력 JavaScript 28.11 kB(gzip 10.05 kB). 루트 workspace 빌드 없이 게시본만 사용했다.
- 이번에는 개발 서버·브라우저·preview를 실행하지 않았다. 아래 라이브 수정 기록은 alpha.1에서 수행한 과거 검증이다. 별도 alpha.2 외부 소비·SvelteKit 브라우저 검증은 [릴리스 기록](../../releases/0.1.0-alpha.2.md)을 따른다.

### alpha.1 라이브 수정 (2026-10-06)

2026-10-06 Windows, Node 24.18.0, Vite 8.3.3에서 실행한 결과다.

- 설치: `npm install --workspaces=false --ignore-scripts --no-audit --no-fund` 성공. `@0disoft/saylo-core`·`saylo-vite`·`saylo-typegen` 모두 registry의 `0.1.0-alpha.1`로 들어왔고, symlink가 아니라 realpath가 `examples/npm/node_modules` 안쪽이다.
- 빌드: `npm run build` 성공.
- 브라우저: IAB 실브라우저에서 `locales/en/demo.json`의 `heading`을 고치면 화면이 즉시 갱신되고 `#name`·메모 입력값은 유지됐다. dialog를 연 채 `dialogTitle`을 고치면 문구가 바뀌고 dialog 열림 상태와 `#dialog-note` 입력값이 유지됐다. `locales/ja/demo.json`을 추가하면 `#locale` 선택 목록에 `ja`가 나타나고, 전환해도 입력값이 유지됐다. console warn/error는 없었다.
- 이 검증의 `ja` 카탈로그는 `heading`·`dialogTitle`에 일본어를 넣고 나머지 키는 `en` 값을 복제했다.
- 임시로 고친 `en` 파일과 추가한 `ja` 파일은 원래대로 복원·삭제했다.

`npm run preview`는 실행하지 않았다.
