# 43. React 선택자 구독과 현행 상태

`packages/react`의 `useI18nSelector`와 이 시점의 구현·게시 상태를 정리한다. 계약과 사용법은 [packages/react/README.md](../packages/react/README.md)를 따른다.

## 현행 구현·게시 상태

- secondary quarantine과 build-time parser 런타임 제거(`astRuntime`): npm `0.1.0-alpha.2`에 게시했다.
- Svelte 어댑터: npm `0.1.0-alpha.2`부터 포함한다.
- Vite `requireCompleteTranslations`(완역 검사): npm `0.1.0-alpha.3`에 게시했다.
- React `useI18nSelector`(selector 미세구독): npm `0.1.0-alpha.4`에 게시했다. CI·registry 소비 검증은 [릴리스 기록](../releases/0.1.0-alpha.4.md)을 따른다.
- Svelte `selectSvelteStore`·`getI18nSelector`(selector 미세구독): npm `0.1.0-alpha.4`에 게시했다. 계약은 [44-svelte-selectors.md](44-svelte-selectors.md)를 따른다.

선택 후속은 core의 selector 미세구독과 다른 환경의 성능 측정·비교 실험이다. Vue 어댑터와 unused message 제거는 구현됐으며 Vue는 `private`·미게시 상태다. 전체 현행 상태와 잔여 항목은 [81-implementation-status.md](81-implementation-status.md)를 따른다. 최신 대표 조건의 성능 목표는 [75](75-early-disk-rechecks.md)를 따른다.

## React 선택자

`createSayloReact<S>()`는 `useI18n`에 더해 `useI18nSelector`를 제공한다. selector는 그 렌더의 `SayloReactSnapshot<S>`를 받고 필요한 값만 골라 낸다.

- 시그니처는 `useI18nSelector<T>(selector: (snapshot: SayloReactSnapshot<S>) => T): T`다.
- 내부는 `useSyncExternalStore`로 선택 결과를 구독한다. 같은 instance·selector·raw snapshot의 반복 읽기에서는 selector 결과를 캐시하므로, selector가 새 객체를 반환해도 반복 읽기 루프에 빠지지 않는다.
- 결과는 `Object.is`로 비교한다. 선택 결과 값이나 참조가 `Object.is`로 같으면 store 갱신으로 인한 렌더를 생략한다. 부모나 자기 state 변경으로 인한 렌더는 그대로 일어난다.
- hook은 기존과 같은 snapshot-bound `t`·`setLocale`·선택적 `loadNamespace`를 유지하고, SSR에서는 `getServerSnapshot`을 쓴다.
- 기존 `useI18n`은 그대로 남아 있다.

제약은 다음과 같다. selector는 매 snapshot마다 다시 실행될 수 있고, 렌더의 props/state를 캡처할 수 있다. 다만 부수 효과 없이 값을 계산하고, 구독되지 않은 변경 가능한 전역값에 의존하지 않는다. 변경되지 않은 객체 참조를 그대로 돌려주면 다시 렌더하지 않고, 매번 새 객체·새 배열을 만들면 snapshot이 바뀔 때마다 다시 렌더된다.

## 검증 기록

전체 `npm run check`가 exit 0으로 통과했다. 총 190개 테스트(core 75·react 14·svelte 5·typegen 8·vite 83·릴리스 helper 5)이고 React 새 검사 5개를 포함한다. JSDOM ReactDOM에서 DOM·입력·state·포커스·커서·모달 유지, 구독 해제, store 교체, prop 변경, `NaN`·signed zero, provider 오류, SSR boot 대 client early-release hydrate를 확인했고, JS/checkJs·TS 소비 fixture의 선택 인자 누락·타입·없는 키 거부와 반환 타입 추론도 통과했다. 빌드를 재사용한 `npm exec -- node scripts/pack-smoke.mjs`도 exit 0으로 통과했고, 외부 JS·TS 두 앱이 설치한 tarball로 새 selector SSR을 `renderToString` `<p>Hello Selector</p>`로 확인했다. 기존 README·CLI·runtime/React/Svelte SSR·Vite lazy build와 parser 제거·완역 fixture 검사도 함께 통과했다. 실제 네이티브 브라우저는 이번에 실행하지 않았다. version bump·push·publish는 없다.
