# 72. thin-layer sync 생성 계약

## 범위

[70](70-thin-layer-lazy-production-browser.md)·[71](71-thin-layer-lazy-session-browser.md) 뒤에 benchmark 전용 lazy layer에 동기 생성 경로를 넣고 그 생성자 계약을 확인한 기록이다. 새 API는 `createCatalogLayerSync`·`createLazyLayerSync` 두 개이고 기존 async `createCatalogLayer`·`createLazyLayer`는 그대로 남는다.

확인한 것은 생성자 계약이다. 전체 API equivalence(예: 오류 코드가 Saylo core와 같은지), 성능·bench 비교, native·standalone typegen은 확인하지 않았다. 관측은 2026-10-11(KST)이고 Node v24.18.0·TypeScript 7.0.2다.

## 코드

- 실행 코드: [catalog-layer.mjs](../benchmarks/thin-layer/catalog-layer.mjs) · [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs) · [lazy-layer.d.mts](../benchmarks/thin-layer/lazy-layer.d.mts) · [lazy-sync.test.mjs](../benchmarks/thin-layer/lazy-sync.test.mjs) · [lazy-contract.test.mjs](../benchmarks/thin-layer/lazy-contract.test.mjs) · [typegen-probe.mjs](../benchmarks/thin-layer/typegen-probe.mjs) · [lazy-production-browser-probe.mjs](../benchmarks/thin-layer/lazy-production-browser-probe.mjs)
- 엔진 생성을 `createCatalogLayerSync`가 소유한다. async `createCatalogLayer`는 그 결과의 `replace`만 async로 감싸고, `createLazyLayer`는 `createLazyLayerSync`를 그대로 돌려주는 async 함수다. 기존 async 호출부는 Promise 반환과 rejection을 유지한다.
- 엔진은 resource-only다. `engine.init({ ... }, callback)`에 `initAsync: false`를 넘기고 callback이 끝났고(`completed`) `engine.isInitialized`일 때만 publish한다. 둘 중 하나라도 아니면 `The resource engine did not initialize synchronously.`로 던지고 직전 snapshot을 유지한다. 앞으로 i18next가 비동기 init 경로를 쓰면 반쯤 만든 엔진이 나가지 않고 옛 snapshot이 남는다.
- 동기 생성은 seeded boot에서 반환 전에 `.t`·`.getSnapshot`·`.getServerSnapshot`이 바로 동작한다. empty boot도 반환 시점에 ready이고 source 로드가 0회이며 `loadNamespace`는 Promise 그대로다. 대기 중 snapshot은 바뀌지 않고 cold snapshot의 `.t`는 계속 `NamespaceNotLoadedError`를 던진다.
- [lazy-layer.d.mts](../benchmarks/thin-layer/lazy-layer.d.mts)는 공개 `I18n`·`Schema`·`CreateI18nOptions`·`BootSnapshot`을 그대로 쓴다. `createLazyLayer`는 `Promise<LazyLayer<S>>`, `createLazyLayerSync`는 `LazyLayer<S>`이고 TS 소비자와 checkJs 소비자가 둘을 구분한다.

## 관측 결과

unit 64개를 돌려 전부 통과했다.

| 구분 | 개수 | 근거 |
| --- | ---: | --- |
| lazy-contract | 42 | 동일 14 시나리오 × core·asyncLayer·syncLayer |
| sync 생성자 | 8 | seeded·empty boot, 잘못된 seed, 직렬화 복원, async factory 유지, 비동기 init 거부 |
| scope·hydration·timezone | 14 | scope 3 + hydration 6 + timezone 5 |

- lazy-contract raw의 `observations`는 core 14·layer 14·layer-sync 14이고 시나리오 id와 pass가 셋이 같다.
- 비동기 엔진 init을 거부할 때 `replace`가 던지고 `getSnapshot()`은 직전 snapshot을 그대로 돌려준다.
- typegen `--sync`는 9 phase 모두 compiler status 0이다. 라이브 런타임은 core·sync 두 factory이고, TS·checkJs 소비자는 기존 async와 새 sync API를 함께 같은 `AppSchema`로 검사한다. any-return 대조 선언은 exit 1이다. boot 복원 2건은 core가 boot 객체, sync가 직렬화 JSON이고 raw의 `layerFactory`는 `createLazyLayerSync`다.
- production browser `--sync`는 variant 2개 × 6단계다. 샘플 앱이 `await` 없이 생성·구독·초기 snapshot 읽기를 수행하고 namespace 로딩 후 번역한다. catalog chunk 0 → 2 → 3 → 5 → 5 → 5, host Asia/Seoul에 설정 UTC, 입력·DOM·focus·caret·dialog·counter 보존을 확인했다. 두 variant 모두 `constructionWithoutAwait` true다.
- sync raw 3개의 `codeHashes` 45개가 현재 파일과 일치하고 profile·temp fixture는 probe가 삭제한다.

## 해석과 한계

- 이것은 생성자 계약의 증거다. 전체 API equivalence가 아니고, 예를 들어 오류 코드 동일성은 증명하지 않았다.
- 성능·bench 비교가 아니고 native·standalone typegen, 브라우저 편집기·LSP도 아니다.
- 제품 package·공개 API·버전·원격은 그대로다. 루트에 새 dependency가 없고 제품 `packages/core/dist`와 benchmark `lazy-source-cache.mjs` 해시도 그대로다.

## 원본과 재현

raw는 [lazy-contracts-sync](../benchmarks/results/thin-layer-lazy-contracts-sync-2026-10-11.json)·[typegen-sync](../benchmarks/results/thin-layer-typegen-sync-2026-10-11.json)·[lazy-production-browser-sync](../benchmarks/results/thin-layer-lazy-production-browser-sync-2026-10-11.json)이다.

contract test의 기본 출력은 이제 current 파일이고 `SAYLO_LAZY_CONTRACT_OUT`로 날짜가 붙은 파일을 지정한다. 앞선 [lazy-contracts raw](../benchmarks/results/thin-layer-lazy-contracts-2026-10-11.json)(28개 = 14×2)는 역사값으로 보존한다. 그 raw의 `codeHashes`는 그때 파일의 시점 기록이고 지금 파일과 3개가 다르다.

```powershell
$env:SAYLO_LAZY_CONTRACT_OUT='benchmarks/results/thin-layer-lazy-contracts-sync-2026-10-11.json'
npm --prefix benchmarks/thin-layer run test:lazy
node --test benchmarks/thin-layer/hydration-layer.test.mjs benchmarks/thin-layer/timezone.test.mjs
Remove-Item Env:SAYLO_LAZY_CONTRACT_OUT
node benchmarks/thin-layer/typegen-probe.mjs --sync --out benchmarks/results/thin-layer-typegen-sync-2026-10-11.json
node benchmarks/thin-layer/lazy-production-browser-probe.mjs --sync --out benchmarks/results/thin-layer-lazy-production-browser-sync-2026-10-11.json
```

첫 browser 실행은 `DevToolsActivePort` EBUSY로 끝났다. benchmark helper [chrome-protocol.mjs](../benchmarks/thin-layer/chrome-protocol.mjs)에 EBUSY를 허용하는 bounded 재시도를 넣은 뒤 통과했고 제품 결함은 아니다.

## 상태

probe·test·raw는 로컬 커밋 `15605cd`에 있다. 미푸시이고 제품 package의 API·의존성·버전은 바뀌지 않았다.
