# SvelteKit 3 예제

요청마다 Saylo 번역을 준비해 SSR하고, 같은 boot snapshot으로 브라우저를 초기화하는 독립 `private` 예제이다. 로컬 Saylo 패키지를 `file:` 의존성으로 설치한다. `.npmrc`의 `install-links=true`로 패키지 내용을 복사하므로 workspace 링크나 서로 다른 Svelte runtime에 의존하지 않는다. npm에 게시된 새 Svelte 어댑터를 사용하는 예제는 아니다.

## 실행

Node 24.x와 npm이 필요하다. 저장소 루트에서 실행한다.

```sh
npm run setup:sveltekit
npm run dev:sveltekit
```

개발 주소는 `http://127.0.0.1:5191/?locale=en`이다. `?locale=ko`는 한국어이며, 잘못되거나 존재하지 않는 로케일은 기준 언어로 처리한다. 로케일 선택은 URL query를 기준으로 한다. Saylo 패키지 소스를 변경했다면 `setup:sveltekit`을 다시 실행해 빌드와 예제의 복사본 설치를 갱신한다.

예제는 SvelteKit 3·Svelte 5·Vite 8·adapter-node 6·TypeScript 6·svelte-check 4를 사용한다. SvelteKit과 checker의 현재 peer 조건에 맞춰 예제만 TypeScript 6을 사용하며 Saylo 본체의 TypeScript 7은 유지한다. [SvelteKit 3 공식 변경 안내](https://svelte.dev/docs/kit/migrating-to-sveltekit-3)를 따른다.

## SSR과 hydration

- `hooks.server.ts`가 요청의 query locale을 정규화하고 해당 요청의 `locals`에 보관한다. HTML `lang`도 이 값으로 설정한다.
- `+layout.server.ts`가 `virtual:saylo/server`의 `createRequestI18n`으로 번역을 준비한다. boot를 JSON 문자열로 반환한 뒤 준비 instance를 `finally`에서 폐기한다. 응답은 `no-store`이다.
- `+layout.svelte`는 boot에서 새로운 instance를 만들어 context에 전달한다. 서버·브라우저 첫 렌더는 같은 locale·카탈로그·시간대를 사용한다. 공유 모듈에는 context factory만 둔다.
- `onMount` 뒤 `virtual:saylo/lazy`를 동적 import해 source를 연결한다. SSR에서는 브라우저 전용 dev source를 실행하지 않는다. 첫 snapshot은 연결 전에 boot로 고정하고, 연결 후 최신 manifest를 갱신한다.
- layout 해제 시 개발 연결과 instance를 정리한다. 지연 import가 해제 뒤에 끝나도 새 연결을 만들지 않는다.

공식 [서버 상태·context 지침](https://svelte.dev/docs/kit/state-management)에 따라 사용자 locale을 서버 전역 instance에 공유하지 않는다.

## 검증 명령

```sh
npm run build:sveltekit
npm run verify:sveltekit
```

`build`는 typegen·SvelteKit sync·템플릿과 TS 검사·client/SSR 빌드·Node adapter 생성을 수행한다. `verify:ssr`는 임시 개발 서버를 직접 시작해 한국어·영어 동시 요청의 SSR과 boot 일치, 로케일 정규화와 기준 언어 fallback을 확인한 뒤 서버를 닫는다. 이미 실행 중인 서버를 검사하려면 `npm --prefix examples/sveltekit run verify:ssr -- http://127.0.0.1:5191`로 주소를 넘긴다.

2026-10-08 로컬 client/SSR 빌드와 Svelte 진단 0 errors·0 warnings를 확인했다. 실제 HTTP 동시 요청과 `?locale=en` 브라우저 hydration도 확인했고 console 오류·경고는 없었다. 페이지 이동과 입력 상태 보존은 후속 연결에서 확인한다.
