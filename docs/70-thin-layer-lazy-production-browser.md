# 70. thin-layer lazy production browser

## 범위

[68](68-thin-layer-lazy-browser.md)·[69](69-thin-layer-typegen.md) 뒤에 실제 Vite HTML production build 두 개를 static HTTP 서버와 headless Chromium으로 확인한 기록이다. benchmark 전용이고 제품 package·공개 API·버전은 바뀌지 않았다.

확인한 것은 catalog chunk 부분 로딩, 입력·DOM 보존, English fallback, no-op refresh, 알 수 없는 namespace 오류다. SSR, 물리 재연결, 새 dev session, pending request race, 시간대 매트릭스, latency·memory, 번들 크기 일반화는 확인하지 않았다.

관측은 2026-10-11(KST)이다.

## 코드

- 실행 코드: [lazy-production-browser-probe.mjs](../benchmarks/thin-layer/lazy-production-browser-probe.mjs) · [lazy-browser-app.jsx](../benchmarks/thin-layer/lazy-browser-app.jsx) · [ast-runtime.mjs](../benchmarks/thin-layer/ast-runtime.mjs) · [chrome-protocol.mjs](../benchmarks/thin-layer/chrome-protocol.mjs)
- variant는 `core`와 `layer` 둘이다. `core`는 제품 `@0disoft/saylo-core/runtime`의 `createI18n`을, `layer`는 benchmark 전용 [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs)의 `createLazyLayer`를 factory로 쓴다.
- 두 variant는 같은 React UI 템플릿(`lazy-browser-app.jsx`)을 쓴다. production에서는 공개 `virtual:saylo/lazy`가 실제 static source를 만든다. `connectDev`는 인스턴스 구독과 정리 콜백을 등록하지만, static source의 `connect`·manifest 구독은 noop이라 개발 소켓을 연결하지 않는다. catalog chunk는 `loadCatalog`의 동적 import가 받는다.
- fixture는 variant별 독립 temp 디렉터리·독립 Vite production build·독립 static HTTP 서버·독립 Chromium user-data-dir이다. locales en·ru·ja × namespace demo·help = 6 pair, baseLocale `en`, initialLocale `ru`, initialNamespaces `[]`(empty boot), timeZone UTC다.
- build는 minify를 끄고 target `esnext`다. 두 variant 모두 JS chunk 7개(entry 1 + catalog 6)를 낸다. HTTP 서버는 build가 돌려준 산출물을 그대로 serve하고 파일을 변형하지 않는다.
- 환경은 Node v24.18.0·Vite 8.3.2·React 19.3.0·react-dom 19.3.0·i18next 26.4.3·intl-messageformat 12.1.3, 브라우저는 HeadlessChrome/154.0.0.0이다. CDP `Emulation.setTimezoneOverride`로 host 시간대를 Asia/Seoul로 바꿨다.

## 관측 결과

variant별 6단계, 합계 12개 관측이다. `catalog`는 그 단계까지의 catalog chunk Resource Timing 개수, `cache`는 `catalogSource.getCatalogs()` 길이다.

| id | locale | catalog | cache | demo | help | 보존 |
| --- | --- | ---: | ---: | --- | --- | --- |
| cold | ru | 0 | 0 | unloaded | unloaded | true |
| load-demo | ru | 2 | 2 | ru Ada | unloaded | true |
| select-ja | ja | 3 | 3 | ja Ada | unloaded | true |
| load-help | ja | 5 | 5 | ja Ada | ja-help Ada | true |
| no-op-refresh | ja | 5 | 5 | ja Ada | ja-help Ada | true |
| unknown-namespace | ja | 5 | 5 | ja Ada | ja-help Ada | true |

- 서버 HTTP 요청과 브라우저 Resource Timing entry가 두 곳 모두 catalog chunk 0 → 2 → 3 → 5 → 5 → 5를 보고한다. ru/help pair chunk는 build에 있지만 끝까지 요청되지 않았다.
- `.json` 요청과 `@vite` 요청이 없다. builtin favicon 404 외 모든 asset 요청이 200이다.
- 6단계 모두에서 input DOM identity·value `typed draft`·focus, caret 2~7, 열린 dialog, React counter `8`, `boots` 1, `errors` `[]`·`diagnostics` `[]`를 확인했다.
- demo 로드 뒤 보관한 이전 snapshot은 select-ja부터 이후 단계에서 `ru Ada`를 유지했다. cold 시점에 묶은 demo translator는 이후에도 `NamespaceNotLoadedError`를 던진다.
- demo가 loaded인 동안 English fallback plural은 `21 rows`, UTC date는 `1/1/2026 / 00:30`이고 host가 Seoul이어도 그대로다.
- no-op refresh의 `sameSnapshot`은 true, unknown namespace는 `namespaceError` `RangeError`·`keyError` `UnknownMessageError`로 raw에 기록됐다.

## parser marker

- 두 variant 모두 emitted JS chunk에 parser marker가 없다(`parserImplementationMarker` false).
- chunk `moduleIds`에는 `@formatjs/icu-messageformat-parser/index.js`와 `no-parser.js`가 들어 있다. parser 패키지 완전 제거나 module graph 전체 감사 결과가 아니고 marker 부재만 본 관측이다. helper·미사용 module 여부로 결론을 내리지 않는다.

## 해석과 한계

- 확인한 것은 기능 동작과 chunk 로딩 순서다. latency·memory·번들 크기 일반화·SSR·새 dev session·pending request race·시간대 매트릭스의 증거가 아니다.
- `layer`는 benchmark 전용 프로토타입이고 제품 진입 경로가 아니다. benchmark 전용 `lazy-layer.d.mts` 손으로 쓴 선언은 제품 변경이 아니다.
- 제품 package·공개 API·버전·원격은 그대로다.

## 원본과 재현

원본은 [thin-layer-lazy-production-browser-2026-10-11.json](../benchmarks/results/thin-layer-lazy-production-browser-2026-10-11.json)이다. raw의 `codeHashes` 16개가 현재 source와 일치했고, 소유 temp fixture는 정리됐다.

```sh
node benchmarks/thin-layer/lazy-production-browser-probe.mjs --out benchmarks/results/thin-layer-lazy-production-browser-2026-10-11.json
```

## 상태

probe·raw·package script는 로컬 커밋 `225a0fa`에 있고 기존 앱 템플릿을 재사용했다. 미푸시이며 제품 package의 API·의존성·버전은 바뀌지 않았다. SSR·물리 재연결·새 dev session·pending request race·시간대 매트릭스·latency·memory·번들 크기 일반화는 이 프로브의 범위 밖이다. 앞선 SSR·개발 소켓 관측은 [66](66-thin-layer-ssr-production.md)·[68](68-thin-layer-lazy-browser.md)에 보존한다.

## 후속: 세션 교체와 늦은 응답 (`3a4251c`)

여기까지가 production browser lazy다. 실제 개발 서버에서 product reply를 byte 변형 없이 보류·순서 변경하고, locale supersede와 실제 서버 종료·같은 port 재시작 뒤 새 session·옛 응답 replay를 확인한 기록은 [71](71-thin-layer-lazy-session-browser.md)에 있다. 위 6단계와 판정은 그대로 유효하다.
