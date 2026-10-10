# 69. thin-layer typegen 소비자 계약

## 범위

[68](68-thin-layer-lazy-browser.md) 뒤에 benchmark 전용 수기 `.d.mts` façade와 실제 TypeScript·checkJs 소비자, 실제 Vite 개발 서버 typegen worker·watch 갱신을 확인한 기록이다. benchmark 전용이고 제품 package·공개 API·의존성·버전·원격은 그대로다.

확인한 것은 손으로 쓴 선언의 공개 타입 재사용, strict 타입검사 9단계, 잘못된 호출에 대한 `@ts-expect-error` 검사가 실제로 작동하는지 보는 any-return control, dev 서버 typegen worker의 watch 갱신이다. 브라우저 편집기·LSP 타입 서비스, 자동 브라우저 타입 갱신, native i18next 단독 typegen, 구현 소스 자체의 checkJs, 성능·메모리, 전체 API equivalence, async·sync parity는 확인하지 않았다.

관측은 2026-10-11(KST)이고 Node v24.18.0·TypeScript 7.0.2다.

## 코드

- 실행 코드: [typegen-probe.mjs](../benchmarks/thin-layer/typegen-probe.mjs) · [type-consumer.ts](../benchmarks/thin-layer/type-consumer.ts) · [type-consumer-js.js](../benchmarks/thin-layer/type-consumer-js.js) · [lazy-layer.d.mts](../benchmarks/thin-layer/lazy-layer.d.mts)
- [lazy-layer.d.mts](../benchmarks/thin-layer/lazy-layer.d.mts)는 손으로 쓴 private 실험 선언이다. `I18n`·`Schema`·`CreateI18nOptions`·`BootSnapshot`을 공개 `@0disoft/saylo-core/runtime`에서 그대로 import하고, `LazyLayer<S>`는 `I18n<S>`를 확장하며 `createLazyLayer`는 `Promise<LazyLayer<S>>`를 돌려준다.
- 옵션은 공개 `CreateI18nOptions` 그대로이거나 그 `initialSnapshot: BootSnapshot` 변형의 `initialSnapshot`만 string으로 바꾼 것이다. 공개 core 생성자는 동기이고 `BootSnapshot` 객체를 받지만, 이 실험은 비동기이며 객체 boot와 직렬화 JSON 문자열 boot를 모두 받는다.
- 소비자는 TS(`type-consumer.ts`)와 checkJs(`type-consumer-js.js`) 두 개다. `tsconfig`는 `strict`·`checkJs`·`allowJs`·`skipLibCheck: false`·`types: ['node','vite/client']`를 켠다. React·Svelte·`connectDev`는 타입 위치(structural compatibility)만 확인하고 런타임 호환 실행은 하지 않는다.
- probe는 실제 Vite dev 서버에서 공개 `virtual:saylo/server`의 live `catalogSource`를 `ssrLoadModule`로 받는다. 브라우저가 아니고, 갱신은 매 단계 두 인스턴스의 `instance.refresh()`를 명시 호출한다.
- base schema는 그 typegen worker가 만든 `generated.d.ts`의 `AppSchema`다. core(`createI18n`)와 layer(`createLazyLayer`)가 같은 `AppSchema`를 쓴다.

## 관측 결과

소비자 세트를 9번 컴파일했고 매 단계 두 런타임의 `instance.refresh()` 결과를 함께 봤다. 9단계 모두 compiler status 0이고 core·layer가 같은 값을 낸다.

| 단계 | compiler | `.d.ts` sha | 런타임 |
| --- | ---: | --- | --- |
| startup | 0 | 3e58f77b | core·layer 동일 |
| translation-text-only | 0 | 3e58f77b(같음) | ja greeting 갱신 |
| base-text-only | 0 | 3e58f77b(같음) | en plain 갱신 |
| invalid-base-last-good | 0 | 3e58f77b(같음) | 직전 정상 유지 |
| recover-and-add-key | 0 | 0b5b8078 | 새 키 추가 |
| add-required-argument | 0 | 5b4a4199 | greeting에 role 추가 |
| remove-key | 0 | 31fc248d | added 키 제거 |
| add-namespace | 0 | 1d8c0a10 | late namespace 추가 |
| remove-namespace | 0 | 31fc248d | late namespace 제거 |

- translation-text-only·base-text-only·invalid-base-last-good는 startup과 `.d.ts` sha·mtime이 모두 같다. 관측 지점에서 생성 파일 바이트가 바뀌지 않았다.
- recover-and-add-key에서 새 키와 필수 인자가 생기고 sha가 바뀐다. add-required-argument에서 base `demo:greeting`에 `role`이 추가되어 `{name, role}`을 요구한다. ja 번역이 role을 생략해도 타입과 런타임이 모두 role을 요구하고, 누락 시 런타임이 `InvalidArgumentError`를 던진다.
- remove-key·remove-namespace 뒤 런타임은 제거된 키·namespace에 `UnknownMessageError`를 던지고 생성 스키마에서 빠진다. add-namespace는 `late:status`가 생성 스키마에 들어오는 것을 본다.
- 바뀌기 전 `getSnapshot()`을 붙든 참조는 이후에도 그 시점 값을 유지하고, 제거된 항목도 이전 snapshot에서는 계속 읽힌다.
- 대조 선언 `loose.d.mts`가 any를 돌려주게 하면 기대대로 exit 1이 난다. 출력에 미사용 `@ts-expect-error` `TS2578` 17개와 `IsAny` 대입 실패 2개가 있어, 타입이 any로 사라지면 소비자 검사가 이를 잡는다는 점을 확인했다.
- 정상·오류 호출을 함께 확인한 계약은 필수 인자, plural count 숫자, date 문자열 제외, select 분기 인자 필수, mixed 축소, dotted 리터럴 키, reserved `lng`·`ns`, `__proto__` 키, union 키 narrowing, snapshot readonly, subscriber snapshot 인자 유지, 알 수 없는 키·여분 인자다.
- boot 복원에서 core는 boot 객체, layer는 `JSON.stringify(boot)` 문자열을 받는다. 두 변형 모두 `JSON.parse(JSON.stringify(...))` 기준 데이터가 같고(`serializedDataEqual: true`) greeting이 `JA-updated Ada`, role 누락 시 `InvalidArgumentError`다. 이 비교는 직렬화 JSON 기준이고 prototype chain 동등성 계약이 아니다.

## 해석과 한계

- 생성 선언과 런타임은 이 관측 범위에서 통과했다. 전체 제품 목표의 완료 판정은 아니고, 아래 한계가 그대로 남는다.
- 확인한 것은 손으로 쓴 선언 + 실제 TS·checkJs 소비자 컴파일 + 선택 런타임 확인이다. 구현 소스 자체를 checkJs로 검사한 게 아니다.
- native i18next 단독 typegen, 브라우저 편집기·LSP 타입 서비스, 자동 브라우저 타입 갱신, 성능·메모리, 전체 API equivalence, async·sync parity는 확인하지 않았다.
- `layer`는 benchmark 전용 프로토타입이고 제품 진입 경로가 아니다.
- 제품 package·공개 API·의존성·버전·원격은 그대로다.

## 원본과 재현

원본은 [thin-layer-typegen-2026-10-11.json](../benchmarks/results/thin-layer-typegen-2026-10-11.json)이다. raw의 `codeHashes` 16개가 현재 source와 일치했고, temp는 소유 디렉터리 안에서 정리됐다.

```sh
node benchmarks/thin-layer/typegen-probe.mjs --out benchmarks/results/thin-layer-typegen-2026-10-11.json
```

## 상태

typegen 코드와 원시 결과는 로컬 커밋 `26e9df0`에 있고 미푸시다. 제품 package·버전은 바뀌지 않았고 게시·배포는 없다.
