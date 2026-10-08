# 38. Svelte 어댑터

## 구현 범위

`@0disoft/saylo-svelte`를 로컬 구현했다. Svelte 5를 peer로 받고 ESM JavaScript와 `.d.ts`를 제공한다. npm 게시와 새 패키지의 Trusted Publisher 등록은 아직 수행하지 않았다. 다른 네 패키지의 기존 게시 기록은 그대로 유지한다.

- `createSvelteStore(instance)`는 eager store 또는 lazy `createI18n` instance를 Svelte readable로 연결한다.
- `createSayloSvelte<AppSchema>()`는 같은 context를 공유하는 `setSayloContext(instance)`와 `getI18n()`을 만든다. 컴포넌트 초기화 중 호출하며 부모의 instance는 마운트 동안 안정적으로 유지한다.
- 컴포넌트는 `$i18n.t`를 사용한다. `t`는 해당 스냅샷에 바인딩되며 이전 스냅샷은 이전 번역을 유지한다. 키·인자 타입과 `setLocale`·선택적 `loadNamespace`를 전달한다.
- 첫 값은 동기 전달한다. 구독자가 있는 동안 하나의 core 구독을 공유한다. 마지막 구독 종료 또는 호출자의 instance 폐기 시 어댑터가 등록한 구독과 disposal listener를 해제한다. instance의 폐기 책임은 호출자에게 있다.
- SSR 요청마다 instance를 따로 생성한다. context factory는 공유할 수 있다. hydration의 최초 core boot는 서버와 일치시켜야 하며 개발 연결은 마운트 뒤에 시작한다.

[패키지 README](../packages/svelte/README.md)와 [데모 README](../examples/svelte/README.md)가 현행 API와 실행 방법을 설명한다. Vite 8과 `@sveltejs/vite-plugin-svelte` 7을 사용한다. 지원 범위는 Svelte 5이며 SvelteKit 전용 서버 라우트 예제·서버 전역 instance·마운트 중 instance 교체는 이번 범위에 포함하지 않았다.

## 검증

2026-10-08 Node 24.18.0, Svelte 5.57.2, Vite 8.3.2, TypeScript 7에서 로컬 빌드와 어댑터 검증을 수행했다.

| 검증 | 확인 내용 |
| --- | --- |
| 어댑터 테스트 | 동기 첫 값, 공유 구독, 마지막 구독과 disposal 정리, 구독 없는 기간의 갱신, 스냅샷 번역, 비동기 메서드 전달 |
| 컴파일한 Svelte 컴포넌트 | 카탈로그·locale 변경 후 DOM·입력값·포커스·커서·dialog·state 유지와 unmount 후 구독 해제 |
| SSR·hydration | 요청별·중첩 context 분리, 다른 factory 사용 오류, SSR 구독 해제, 일치하는 마크업을 재사용하고 이후 번역 갱신 |
| JS/TS 소비 | 잘못된 키·인자·union 호출과 다른 schema context를 타입 검사에서 거부 |
| 외부 tarball | 다섯 패키지를 저장소 밖에 설치해 JS checkJs·TS 소비를 검사하고 Svelte README 실행·컴파일한 Svelte SSR을 확인 |
| production 데모 | 타입 생성·`.ts` 연결부 검사·Svelte 컴포넌트 빌드. 영어 lazy chunk 유지 |
| 실제 브라우저 | 정상 문구 저장 후 입력·모달·포커스·커서 유지, 로케일 파일 추가·선택·삭제와 기준 언어 복귀 |

브라우저 검증 중 패키지 빌드를 병행한 첫 시도는 workspace `dist` 변경 때문에 Vite가 리로드했다. 해당 시도는 상태 보존 근거에서 제외했다. 빌드 종료 후 카탈로그만 수정한 확인에서는 이름·요청 사항·모달 메모가 그대로였고, 모달은 열린 채 포커스와 커서 위치 7이 유지됐다. 임시 `fr` 카탈로그는 영문 복사본으로 추가·선택·삭제를 확인한 뒤 제거했다. 문구도 원복했다.

템플릿 전체의 TypeScript 진단과 실제 SvelteKit 배포는 이번 검증에 포함하지 않는다. 성능 p95 목표도 새로 측정하지 않았다.

통합 검사 중 기존 Vite typegen 테스트에서 임시 선언 파일을 교체하는 `rename`이 Windows `EPERM`으로 두 번 실패했다. 단독 테스트는 통과했으나 통합 재실행에서도 발생해 writer를 보완했다. Windows `EPERM`·`EACCES`·`EBUSY`만 최대 다섯 번, 총 대기 620ms 이내로 재시도하고 새 generation이나 중단이 있으면 다음 교체 전에 취소한다. 실패가 지속되면 기존 오류를 전달하고 임시 파일은 기존 writer의 `finally`로 정리한다. 기존 선언 파일을 먼저 삭제하지 않는다. 재시도·취소·한도·비Windows 오류를 별도 테스트한다.

보완 후 `npm run check` 전체가 exit 0으로 통과했다. 마지막 Node 24.18.0 tarball 검증도 다섯 패키지의 외부 JS/TS 소비·README 실행·Svelte SSR을 통과했고 `.release/npm/`에 검증한 tarball과 manifest를 저장했다. 임시 개발 서버는 종료했다.

## 릴리스 연결

`scripts/release-check.mjs`의 `packageIds`를 공통 목록으로 사용해 로컬 pack·게시 계획·OIDC 검증이 다섯 패키지를 대상으로 동작한다. `verify:registry`는 기존 릴리스 manifest에 기록된 패키지만 검사해 미게시 Svelte 패키지를 기존 네 패키지의 게시 확인에 섞지 않는다.

현재 버전은 기존 workspace와 같은 `0.1.0-alpha.1`이며 자동 승격하지 않았다. 게시 단계에서는 이미 게시한 버전의 바이트 일치 검사와 새 패키지의 Trusted Publisher 준비를 통과해야 한다. 현행 소스에서 만든 기존 패키지 tarball은 게시된 alpha.1과 다를 수 있으므로 다음 릴리스의 버전 결정과 registry 등록은 별도 작업이다.

## 참고

- [Svelte store contract](https://svelte.dev/docs/svelte/stores#Store-contract)
- [Svelte context](https://svelte.dev/docs/svelte/context)
