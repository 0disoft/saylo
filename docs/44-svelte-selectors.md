# 44. Svelte 선택자 구독과 현행 상태

`packages/svelte`의 `selectSvelteStore`·`getI18nSelector`와 이 시점의 구현·게시 상태를 정리한다. 계약과 사용법은 [packages/svelte/README.md](../packages/svelte/README.md)를 따른다.

## 현행 구현·게시 상태

- secondary quarantine과 build-time parser 런타임 제거(`astRuntime`): npm `0.1.0-alpha.2`에 게시했다.
- Svelte 어댑터: npm `0.1.0-alpha.2`부터 포함한다.
- Vite `requireCompleteTranslations`(완역 검사): npm `0.1.0-alpha.3`에 게시했다.
- React `useI18nSelector`와 Svelte `selectSvelteStore`·`getI18nSelector`(selector 미세구독): 저장소 checkout의 로컬 구현이고 아직 게시본에는 없다.

남은 후속은 core의 selector 미세구독, Vue 어댑터, unused message 제거, 대규모 성능 목표, 비교 실험이다.

## Svelte 선택자

`selectSvelteStore`는 store에서 필요한 값만 골라 내는 `Readable`을 만들고, `createSayloSvelte<S>()`의 `getI18nSelector`는 같은 selector를 context로 전달한다.

- 시그니처는 `selectSvelteStore<S, T>(source: SayloSvelteStore<S>, selector: (snapshot: SayloSvelteSnapshot<S>) => T): Readable<T>`다.
- `createSayloSvelte<S>()`는 `getI18nSelector<T>(selector): Readable<T>`를 제공하고, 같은 factory context에서 초기화 중에 호출한다.
- 결과는 `Object.is`로 비교하고, 값 상자 `{ value }`로 Svelte `derived` 알림을 이어 준다. 같은 객체 참조와 `NaN`은 알림을 생략하고 `+0`·`-0`은 다른 값으로 알림을 전달한다.
- source와 공유 context의 기존 core 단일 구독과 최종 해제를 유지하고, SSR render가 끝난 뒤 core 구독은 0이다.
- 첫 구독과 재구독은 동기 최신값을 전달하고, snapshot-bound `t`와 `setLocale`/`loadNamespace`를 유지한다.
- 기존 `createSvelteStore`·`getI18n`은 그대로 남아 있다.

제약은 다음과 같다. selector는 순수 계산으로 둔다. selector가 props를 캡처해도 prop만 바뀌면 source 알림이 없으므로 자동으로 다시 선택하지 않는다. selector가 매번 새 객체·새 배열을 반환하면 `Object.is`가 다르므로 매 snapshot마다 알림이 발생한다. 동적 컴포넌트 인자는 기존 `$i18n`와 Svelte `$derived`로 조합한다.

## 검증 기록

전체 `npm run check`가 exit 0으로 통과했다. 총 195개 테스트(core 75·react 14·svelte 10·typegen 8·vite 83·릴리스 helper 5)이고, Svelte는 새 unit 4개와 SSR 컴파일 selector 1개를 추가했으며 기존 components 테스트가 실행한 JSDOM client 3개 중 새 selector hydration 1개를 포함한다.

확인한 동작은 다음과 같다. 무관한 active edit 알림은 0회이고 관련 제목·언어 전환은 최신값을 유지한다. shared source는 core 구독 1개·종료 0개를 지키고 dormant get·restart 뒤 정리된다. 값 비교는 `Object.is` 기준으로 object·function·undefined·`NaN`과 `+0`·`-0`을 구분한다. Svelte `derived` 조합은 동시 locale·text 수렴을 확인했고, SSR은 요청·중첩 context 격리·오류·subscription 0을 확인했다. 컴파일한 client selector는 hydration 마크업이 동일하고 DOM·입력·포커스·커서·dialog·state가 유지된다. JS/checkJs/TS 타입 계약도 통과했다.

selector 타입 fixture는 새 `selector-consumer.ts`·`.js`로 분리했고, 분리 뒤 `npm run typecheck:consumers --workspace=@0disoft/saylo-svelte`도 exit 0으로 통과했다.

빌드를 재사용한 `npm exec -- node scripts/pack-smoke.mjs`는 exit 0으로 통과했다. 새로 만든 로컬 다섯 tarball을 JS/checkJs/TS 앱에 설치해 `selectSvelteStore`·`getI18nSelector` 타입 fixture(imported declarations)를 검사했고, 컴파일한 Svelte 새 selector SSR이 `<h1>Packed Svelte</h1>`을 렌더했다. React selector SSR과 기존 CLI·runtime/SSR·Vite lazy build·parser 제거·완역 검사도 함께 통과했다. `npm run verify:registry:alpha3`도 exit 0으로 통과했고, 실제 게시된 `alpha.3` 다섯 패키지의 integrity·외부 JS·TS·README·Svelte 컴파일 SSR을 확인했다. selector API가 없는 게시본에서는 declared feature gate로 새 fixture를 제외해 기존 검증을 유지한다. 임시 앱과 서버는 스크립트 finally에서 정리했다.

실제 네이티브 브라우저 검증, version bump, push, publish는 예정에 없다.
