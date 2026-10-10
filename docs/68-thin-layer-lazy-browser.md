# 68. thin-layer lazy 브라우저 wire 전송

## 범위

[67](67-thin-layer-lazy-contracts.md) 뒤에 실제 Chromium과 Vite 개발 서버에서 공개 `virtual:saylo/lazy` source와 `connectDev` bridge의 wire 전송을 확인한 기록이다. benchmark 전용이고 제품 package·공개 API·버전은 바뀌지 않았다.

확인한 것은 catalog pair 6개의 요청, compact·patch frame, 부분 요청, invalid JSON last-good·복구, `connectDev` detach·rebind handshake, 실제 Vite 소켓 종료 뒤 기본 reload다. 투명한 물리 reconnect, server restart·session 교체, pending reply race, typegen, production browser lazy, 성능은 확인하지 않았다.

관측은 2026-10-11(KST)이다.

## 코드

- 실행 코드: [lazy-browser-probe.mjs](../benchmarks/thin-layer/lazy-browser-probe.mjs) · [lazy-browser-app.jsx](../benchmarks/thin-layer/lazy-browser-app.jsx) · [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs) · [lazy-source-cache.mjs](../benchmarks/thin-layer/lazy-source-cache.mjs) · [chrome-protocol.mjs](../benchmarks/thin-layer/chrome-protocol.mjs)
- variant는 `core`와 `layer` 둘이다. `core`는 제품 `@0disoft/saylo-core/runtime`의 `createI18n`을, `layer`는 benchmark 전용 [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs)의 `createLazyLayer`를 factory로 쓴다.
- 두 variant 모두 공개 `virtual:saylo/lazy`의 `catalogSource`·`initialCatalogs`·`initialLocale`·`initialNamespaces`·`timeZone`과 `@0disoft/saylo-vite/client`의 `connectDev`를 쓴다. 개발 모드의 virtual 모듈이 만드는 것은 실제 `createDevCatalogSource`이고, 별도 `createStaticCatalogSource`는 쓰지 않는다.
- 앱은 synthetic manifest·catalog reply·socket 이벤트를 넣지 않는다. 요청과 응답은 실제 플러그인 transport가 보낸 것이다. React UI는 `useSyncExternalStore`로 runtime snapshot을 구독한다.
- fixture는 variant별 독립 temp 디렉터리·독립 Vite 개발 서버·독립 Chromium user-data-dir이다. locales en·fr·ja × namespace demo·help = 6 pair이고, baseLocale en, initialLocale fr, initialNamespaces `[]`(empty boot), timeZone UTC다. `layer` 소스는 `/@fs/` 절대 경로로 benchmark 파일을 직접 import한다.
- wire 관측은 두 번째 Vite plugin이 맡는다. `configureServer`에서 `server.ws.on('saylo:request-catalog')`로 들어온 요청을 기록하고, 접속마다 `socket.send`를 감싸 나가는 `saylo:` custom 메시지의 event·manifest `registryRevision`·request·`result.status`·diagnostic을 기록한다.
- 환경은 Node v24.18.0·Vite 8.3.2·React 19.3.0·react-dom 19.3.0·i18next 26.4.3·intl-messageformat 12.1.3이고 브라우저는 HeadlessChrome/154.0.0.0이다. 값은 raw의 `packages`·`node`·`userAgent`에서 읽었다.

## 관측 결과

variant별 12단계이고 합계 24개 관측이다. 두 variant는 catalog pair 요청 순서·응답 종류·단계 값이 같다. request identity와 session ID는 각 fixture가 따로 생성한다. variant별 catalog request는 9개, wire frame은 21개다.

frame 구성은 catalog compact 6, catalog patch 3, manifest snapshot 3, manifest update 4, eager-diagnostic 5로 총 21개다. snapshot 3개 중 2개는 최초 연결·rebind이며, 1개는 소켓 종료 뒤 reload된 페이지의 연결이다. diagnostic 5개에도 reload 이후 1개가 포함된다.

request 9개는 en/demo compact, fr/demo compact, ja/demo compact, en/help compact, ja/help compact, ja/demo patch(`catalogVersion` 1), ja/demo patch(`catalogVersion` 2), fr/help compact, fr/demo patch(generation 2, `catalogVersion` 1) 순이다. demo 로드가 base locale en과 selected locale fr pair를, help 로드가 en·ja pair를 각각 요청한다. patch 3개는 모두 `known`에 `sessionId`와 `catalogVersion`을 싣는다.

| id | locale | request | cache | revision | demo | help | 보존 |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| cold | fr | 0 | 0 | 0 | unloaded | unloaded | true |
| load-demo | fr | 2 | 2 | 0 | fr Ada | unloaded | true |
| select-ja | ja | 3 | 3 | 0 | ja Ada | unloaded | true |
| load-help | ja | 5 | 5 | 0 | ja Ada | ja-help Ada | true |
| live-edit | ja | 6 | 5 | 1 | Updated Ada | ja-help Ada | true |
| invalid-json-last-good | ja | 6 | 5 | 1 | Updated Ada | ja-help Ada | true |
| recover-json | ja | 7 | 5 | 2 | Recovered Ada | ja-help Ada | true |
| unselected-pair-edit | ja | 7 | 5 | 3 | Recovered Ada | ja-help Ada | true |
| select-fr-fresh-help | fr | 8 | 6 | 3 | fr Ada | Fresh-help Ada | true |
| detached-last-good | fr | 8 | 6 | 3 | fr Ada | Fresh-help Ada | true |
| rebind-catch-up | fr | 9 | 6 | 4 | Rebound Ada | Fresh-help Ada | true |
| physical-socket-loss-vite-reload | fr | — | 0 | 0 | unloaded | unloaded | false |

`cache`는 `catalogSource.getCatalogs()` 길이, `request`는 그 단계까지의 catalog request 누적 개수다. 마지막 단계에는 request 누적 값을 따로 기록하지 않았다. cold는 empty boot라 request와 cache가 모두 0이고, load-help에서 cache 0 → 2 → 3 → 5로 오른다. reload 직후의 revision 0은 그 순간의 source 관측이고, 새 manifest handshake를 모두 반영한 후의 상태를 뜻하지 않는다.

### 상태 보존

1~11단계 CDP 관측에서 `input` DOM identity·value(`typed draft`)·focus, caret 2~7, 열린 `dialog`, React counter `8`, `boots` 1, `errors` `[]`를 확인했다. demo를 처음 로드한 뒤 보관한 이전 snapshot은 3~11단계에서 `fr Ada`를 유지했다. 11단계까지 문서 reload는 없었다.

### invalid JSON과 복구

`ja/demo.json`을 `{`로 저장하면 진단 1개(`ja/demo.json: Invalid JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)`)가 남고 표시는 직전 정상 문구 `Updated Ada`를 유지한다. 이 저장으로 catalog request는 늘지 않는다(6 유지).

valid로 저장하면 `Recovered Ada`가 커밋되고 revision이 2로 오르며 patch request 1개가 더 나간다(7).

### 부분 요청과 fresh help

선택하지 않은 pair(fr/help)를 편집하면 manifest update(revision 3)만 broadcast되고 catalog request는 0이다(request 7 유지, `fr/help` request 없음). 표시도 `Recovered Ada` 그대로다.

이어서 locale을 fr로 옮기면 그때 fr/help를 fresh compact로 받아 편집 값 `Fresh-help Ada`가 반영된다(request 8, cache 6).

### detach·rebind

`connectDev` cleanup(`stop()`) 뒤 fr/demo를 편집하면 server broadcast(revision 4)가 frame으로 도착하지만 앱 snapshot은 last-good `fr Ada`를 유지하고 request도 0이다.

`bind()`로 다시 붙이면 실제 manifest snapshot handshake 뒤 patch가 도착해 `Rebound Ada`로 catch-up하고 revision이 4가 된다(request 9). 소켓 종료 이전 `saylo:manifest` snapshot handshake는 2개다.

### 실제 소켓 종료

`vite.ws.clients`가 1개임을 확인한 뒤 `client.socket.terminate()`로 실제 연결을 끊으면, Vite 8 기본 client가 reconnect ping에 성공한 뒤 `location.reload()`한다. reload된 페이지는 `boots` 2·`loadedNamespaces` `[]`·greeting `unloaded`·input `initial draft`·counter `7`·dialog 닫힘으로 돌아가고 보존은 false다. 두 variant 모두 같다.

이것은 기본 Vite client의 reload 경로다. 투명한 물리 reconnect가 아니고, server restart나 session 교체도 이 실험이 만든 상황이 아니다.

## 해석과 한계

- 확인한 것은 기능 동작과 wire 순서다. 두 variant가 같은 12단계 값을 냈다는 관측은 두 구현이 같은 공개 wire 계약을 따른다는 뜻이고 성능 비교가 아니다. 시간을 재지 않았다.
- `layer`는 benchmark 전용 프로토타입이고 제품 진입 경로가 아니다. 위 결과를 독립 런타임의 제품 채택 근거로 쓰지 않는다.
- 남은 항목은 pending reply race, fresh session 실제 브라우저, production browser lazy, typegen, 전체 계층 비교, 성능, 메모리다.
- 제품 package·공개 API·버전·원격은 그대로다.

## 원본과 재현

원본은 [thin-layer-lazy-browser-2026-10-11.json](../benchmarks/results/thin-layer-lazy-browser-2026-10-11.json)이다. raw의 `codeHashes` 20개가 현재 source와 일치했고, fixture는 소유 temp 안에서 정리됐다.

```sh
node benchmarks/thin-layer/lazy-browser-probe.mjs --out benchmarks/results/thin-layer-lazy-browser-2026-10-11.json
```

## 상태

probe·app·raw·package script는 로컬 커밋 `51f1393`에 있고 미푸시다. 제품 package의 API·의존성·버전은 바뀌지 않았고 게시·배포는 없다.

## 후속: typegen 소비자 계약 (`26e9df0`)

여기까지가 브라우저 lazy wire다. benchmark 전용 수기 `.d.mts` façade와 실제 TypeScript·checkJs 소비자, 실제 Vite 개발 서버 typegen worker·watch 갱신을 확인한 기록은 [69](69-thin-layer-typegen.md)에 있다. 위 12단계와 판정은 그대로 유효하다.
