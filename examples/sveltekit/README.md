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
- `(saylo)/+layout.server.ts`가 `virtual:saylo/server`의 `createRequestI18n`으로 번역을 준비한다. boot를 JSON 문자열로 반환한 뒤 준비 instance를 `finally`에서 폐기한다. 응답은 `no-store`이다. load가 query locale을 직접 읽어 페이지 이동 중 query 변경도 다시 처리한다.
- `(saylo)/+layout.svelte`는 boot에서 새로운 instance를 만들어 context에 전달한다. 서버·브라우저 첫 렌더는 같은 locale·카탈로그·시간대를 사용한다. 공유 모듈에는 context factory만 둔다.
- `onMount`에서 개발 모드면 해당 요청 boot로 `createDevCatalogSource`를 새로 만든다. 이 source는 layout이 소유하고 폐기한다. 운영 모드면 `virtual:saylo/lazy`를 동적 import해 generated static source를 연결한다. SSR에서는 브라우저 전용 source를 실행하지 않는다. 첫 snapshot은 연결 전에 boot로 고정하고, 연결 후 최신 manifest를 갱신한다.
- layout 해제 시 개발 연결과 instance를 정리한다. 지연 import가 해제 뒤에 끝나도 새 연결을 만들지 않는다.

공식 [서버 상태·context 지침](https://svelte.dev/docs/kit/state-management)에 따라 사용자 locale을 서버 전역 instance에 공유하지 않는다.

## 검증 명령

```sh
npm run build:sveltekit
npm run verify:sveltekit
```

`build`는 typegen·SvelteKit sync·템플릿과 TS 검사·client/SSR 빌드·Node adapter 생성을 수행한다. `verify:ssr`는 임시 개발 서버를 직접 시작해 한국어·영어 동시 요청의 SSR과 boot 일치, 로케일 정규화와 기준 언어 fallback을 확인한다. 실제 client 연결 함수에 hot context를 제공해 등록된 listener의 해제, 중복 stop, 해제 뒤 지연 연결 취소도 검사하고 서버를 닫는다. 이미 실행 중인 서버를 검사하려면 `npm --prefix examples/sveltekit run verify:ssr -- http://127.0.0.1:5191`로 주소를 넘긴다. 주소를 넘긴 실행은 HTTP 검증만 수행한다.

## 페이지 이동과 live 갱신

`/`와 `/about`은 `(saylo)` layout을 공유한다. 이름·요청 사항·모달 메모는 이 layout의 `Workbench`에 있으므로 두 페이지 사이에서 유지된다. 모달 안의 연결 설명 링크로 열린 창을 유지한 채 페이지를 이동할 수 있다. 언어 선택은 URL query를 갱신하며 locale 로드가 완료될 때까지 선택 중인 값을 표시한다.

`/plain`은 이 layout 밖에 있으므로 이동하면 개발 연결·source·instance가 정리된다. 돌아오면 최신 SSR boot로 새 instance를 만들고 폼은 초기화한다. 일반 페이지 이동의 포커스·스크롤 정책은 SvelteKit 기본값을 따르고, 언어 전환은 `goto(..., { reset: false })`를 사용한다.

개발 중 `locales/en/demo.json` 또는 `ko/demo.json`을 수정한다. 정상 문구 저장은 페이지를 다시 로드하지 않고 반영한다. 잘못된 JSON은 마지막 정상 번역을 유지하며 진단을 표시한다. 오류를 수정하면 진단이 사라진다. 운영 빌드는 정적 카탈로그와 lazy loader를 사용한다.

2026-10-08 개발 서버와 실제 Node adapter 빌드에서 HTTP SSR·boot 일치와 브라우저 hydration을 확인했다. 개발 브라우저에서 열린 모달의 페이지 이동, 저장 후 입력·포커스·커서 유지, 잘못된 JSON의 마지막 정상 상태와 복구, URL 언어 전환, layout 종료·최신 boot 재진입과 live 재연결을 확인했다. 운영 브라우저에서도 언어 전환·페이지 이동 후 입력 유지와 console 오류·경고 없음을 확인했다. 상세 범위는 [39-sveltekit-example.md](../../docs/39-sveltekit-example.md)에 있다.
