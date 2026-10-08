# 39. SvelteKit 실제 앱 연결

## 범위

[examples/sveltekit](../examples/sveltekit/README.md)에 SvelteKit 3의 SSR·hydration·페이지 이동 예제를 로컬 구현했다. 새 공개 패키지나 Saylo API를 추가하지 않는다. npm 게시와 외부 배포는 수행하지 않았다.

예제는 독립 `private` 패키지이며 Saylo core·svelte·typegen·vite를 로컬 `file:` 의존성으로 설치한다. `install-links=true`로 내용을 복사하고, 실제 설치된 core·svelte·vite가 workspace symlink가 아님을 확인했다. 본체는 TypeScript 7을 유지하고 예제는 SvelteKit·checker의 peer 조건에 맞는 TypeScript 6을 사용한다. 서드파티 의존성은 메이저 범위를 지정한다.

2026-10-08 검증 환경은 Node 24.18.0, SvelteKit 3.0.1, Svelte 5.57.2, Vite 8.3.4, adapter-node 6.0.0이다. `#lib` subpath imports, Vite의 `sveltekit({ adapter })` 설정과 `$app/tsconfig`를 사용한다. SvelteKit 2와 다른 adapter는 이번 범위에 포함하지 않는다.

## 요청과 소유권

1. 서버 hook이 URL query locale을 정규화해 요청별 `locals`에 넣는다. 존재하지 않거나 잘못된 locale은 base locale로 처리하고 HTML `lang`도 맞춘다.
2. `(saylo)/+layout.server.ts`가 `createRequestI18n`으로 요청 scope를 준비한다. boot를 JSON 문자열로 반환하고 준비 instance를 `finally`에서 폐기한다. query를 직접 읽어 client navigation에서 locale query 변경도 추적한다.
3. `(saylo)/+layout.svelte`가 boot를 decode해 새로운 instance를 만든다. 서버 렌더와 첫 hydration은 같은 snapshot을 사용한다. module scope에는 typed context factory만 있고 사용자 locale을 담은 전역 instance는 없다.
4. `onMount`에서 개발 source를 요청 boot로 생성하고 layout이 소유한다. layout 재진입마다 fresh boot로 시작해 이전 source의 오래된 manifest를 가져오지 않는다. 운영에서는 generated static source를 동적 import한다.
5. layout의 instance와 구독은 `/`·`/about` 사이에서 유지된다. `/plain`으로 나가면 연결·소유 source·instance를 해제한다. 지연 연결이 해제 뒤 완료되어도 다시 붙지 않는다. 다시 들어오면 새 instance와 폼을 생성한다.

source proxy는 처음에 prepared boot scope를 읽고 마운트 뒤 browser source를 사용한다. SSR에서는 websocket source를 실행하지 않는다. 개발 source가 공유하는 Vite socket 자체는 닫지 않고 등록한 listener만 정리한다. UI는 snapshot의 `t`를 사용한다.

## 검증

| 확인 | 결과 |
| --- | --- |
| Svelte 타입 검사 | 예제의 TS·템플릿·Vite config 진단 0 errors·0 warnings |
| 빌드 | client·SSR 빌드와 adapter-node 출력 생성 성공 |
| 개발 HTTP | ko/en 동시 요청 4개, 일치하는 SSR 언어·boot·UTC·namespace, `EN` 정규화, malformed·미등록 locale의 base fallback |
| 운영 HTTP | 실제 `node build/index.js`에서 같은 SSR·boot 검증 통과 |
| 연결 수명 | 실제 client 연결 함수와 hot context에서 listener 등록·종료 후 0개, 중복 stop, attach 전 종료 시 지연 연결 취소 |
| 개발 브라우저 | 영어 boot hydration 후 `/about` 이동에서도 이름·요청 사항·모달 메모·열린 창 유지 |
| 정상 문구 저장 | about 제목과 dialog 제목 변경이 반영되고 입력·열린 창·포커스·커서 위치 8 유지 |
| 오류와 복구 | 잘못된 JSON은 이전 정상 번역과 revision을 유지하고 진단을 표시. 원복 후 정상 번역과 진단 해제 |
| 언어 전환 | URL query·HTML lang·문구를 ko로 전환하고 입력 유지 |
| 종료·재진입 | `/plain`에서 번역 layout 제거. 그동안 수정한 ko 문구가 돌아온 화면의 fresh SSR boot에 반영. 이후 저장도 다시 live 반영 |
| 운영 브라우저 | 영어 hydration, ko 전환·페이지 이동 후 입력 유지. 검사한 브라우저 console 오류·경고 없음 |

검증용 en·ko 문구와 잘못된 JSON은 원복했다. route 구조와 컴포넌트를 구현 중 바꿀 때 발생한 HMR reload는 카탈로그 상태 보존 검증에 사용하지 않았다. 카탈로그 검증 시에는 빌드를 병행하지 않았다.

이 예제는 로컬 Node 운영 빌드까지 검증했다. 외부 호스팅 배포와 성능 p95 측정은 수행하지 않았다.

## 실행

```sh
npm run setup:sveltekit
npm run dev:sveltekit
npm run build:sveltekit
npm run verify:sveltekit
```

개발 포트는 5191이고 preview 포트는 5192이다. `verify:sveltekit`은 임시 개발 서버를 직접 시작하고 `finally`에서 종료한다. 실제 실행 중인 Node 빌드도 `npm --prefix examples/sveltekit run verify:ssr -- http://127.0.0.1:5192`로 HTTP 검증할 수 있다.

## 참고

- [SvelteKit 3 변경 안내](https://svelte.dev/docs/kit/migrating-to-sveltekit-3)
- [서버 상태와 context](https://svelte.dev/docs/kit/state-management)
- [load와 navigation 재실행](https://svelte.dev/docs/kit/load)
