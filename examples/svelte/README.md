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

## rich text 미리보기

`Preview.svelte`가 `rich-preview` 문단을 더한다. `strong`은 `<strong>`에, `link`는 같은 화면의 주문 폼(`#order-form`)으로 가는 링크에 매핑하고, 이름 입력이 비어 있으면 `Saylo`를 쓴다.

`examples/svelte/locales/ko/demo.json`·`en/demo.json`에 rich 키를 더한다. 한국어는 `<strong>{name}</strong>님, <link>입력한 주문</link>을 확인해 주세요.`이고, 영어는 `<strong>{name}</strong>, review <link>your order</link>.`로 React 데모와 같다.

`projectDemoMessages`는 마지막 정상 전체 번역 투영에 rich parts를 담는다. rich markup이 잘못된 뒤에도 이름·수량·입력 변경은 마지막 정상 snapshot을 현재 인자로 다시 포맷한다.

이 미리보기는 로컬 커밋 `010a600`의 컴포넌트를 쓰는 미게시 변경이다. 검증 상태는 [80-svelte-rich-text.md](https://github.com/0disoft/saylo/blob/main/docs/80-svelte-rich-text.md)를 따른다. 개발·빌드·복구 명령과 로케일 편집 절차는 앞의 절차를 그대로 쓴다.
