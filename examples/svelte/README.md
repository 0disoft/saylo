# Svelte 5 데모

저장소 루트에서 `npm install` 후 실행한다.

```sh
npm run dev:svelte
```

주소는 `http://127.0.0.1:5190`이다. 이름·요청 사항을 입력하고 확인 창을 연 다음 `locales/ko/demo.json`의 문구를 수정한다. 정상 번역 저장 시 입력값과 열린 창을 유지하며 문구가 갱신된다. `locales/<locale>/demo.json`을 추가하면 언어 선택 목록에 나타나고 선택 시 지연 로딩한다. 선택 중인 로케일을 삭제하면 기준 언어인 `ko`로 돌아간다.

`App.svelte`가 instance를 context로 전달하고 `Preview.svelte`가 `$i18n`을 구독한다. `onMount`에서 개발 연결을 시작하고 컴포넌트 해제 시 연결을 정리한다. instance는 `main.ts`에서 소유·폐기한다. 이 데모는 브라우저용이며 SvelteKit 서버 라우트 예제는 포함하지 않는다.

```sh
npm run build:svelte
```

기준 카탈로그에서 타입을 생성하고 `.ts` 연결부를 검사한 뒤 Svelte 컴포넌트를 production 빌드한다. 템플릿 전체의 TypeScript 진단은 별도 Svelte 도구로 검사하는 범위이다. 어댑터의 타입 계약은 JS checkJs와 TS strict 소비 테스트에서 검사한다.

2026-10-08 실제 브라우저에서 정상 문구 저장 후 이름·요청 사항·모달 메모·모달 열림·포커스·커서 위치 유지, 임시 로케일 추가·선택·삭제와 기준 언어 복귀를 확인했다. 검증 중 생성한 임시 로케일과 문구 수정은 원복했다. 패키지를 재빌드하면 Vite가 연결된 패키지 모듈을 리로드하므로, 파일 저장 검증 중에는 패키지 빌드를 병행하지 않는다.
