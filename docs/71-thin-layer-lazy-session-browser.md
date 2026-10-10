# 71. thin-layer lazy session 브라우저

## 범위

[68](68-thin-layer-lazy-browser.md)·[70](70-thin-layer-lazy-production-browser.md) 뒤에 실제 Chromium과 두 독립 Vite 개발 서버(core·prototype)에서 공개 `virtual:saylo/lazy`의 `createDevCatalogSource`와 `connectDev`가 세션 교체와 늦은 응답을 어떻게 처리하는지 확인한 기록이다. benchmark 전용이고 제품 package·공개 API·버전은 바뀌지 않았다.

확인한 것은 실제 `socket.send`가 받은 product reply를 byte 변형 없이 보류·순서 변경했을 때 UI가 유지되는지, locale 요청 supersede 뒤 늦은 응답, 실제 서버 종료·같은 port 재시작 뒤 새 session과 옛 응답 replay다. 성능·메모리·전체 race 범위·투명한 재연결·같은 인스턴스의 새 session 브라우저는 확인하지 않았다. 기존 SSR·production 관측을 뒤집지 않는다.

관측은 2026-10-11(KST)이다.

## 코드

- 실행 코드: [lazy-session-browser-probe.mjs](../benchmarks/thin-layer/lazy-session-browser-probe.mjs) · [lazy-browser-app.jsx](../benchmarks/thin-layer/lazy-browser-app.jsx) · [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs) · [lazy-source-cache.mjs](../benchmarks/thin-layer/lazy-source-cache.mjs) · [chrome-protocol.mjs](../benchmarks/thin-layer/chrome-protocol.mjs)
- variant는 `core`와 `layer` 둘이다. `core`는 제품 `@0disoft/saylo-core/runtime`의 `createI18n`을, `layer`는 benchmark 전용 [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs)의 `createLazyLayer`를 factory로 쓴다. 두 variant는 같은 React 템플릿과 공개 dev source·`connectDev` bridge를 쓴다.
- fixture는 variant별 독립 temp·독립 Vite 개발 서버·독립 Chromium user-data-dir이다. locales en·fr·ja × namespace demo·help, baseLocale en, initialLocale fr, initialNamespaces `[]`(empty boot), timeZone UTC다. manifest·catalog 내용과 Vite 연결 이벤트는 합성하지 않는다. 제어용 barrier와 이전 응답의 재전송은 아래에 구분해 기록한다.
- wire 관측 plugin이 접속마다 `socket.send`를 감싼다. `saylo:` custom string payload만 `JSON.parse`해 event·generation·kind·request·`result.status`·sessionId·revision·`catalogVersion`·`held`·`payloadSha256`를 기록하고, 보류 모드(fr reply·ja compact)에서는 `held` 배열에 넣고 원래 send를 미룬다. `release()`는 `readyState` 1과 `hash(payload) === frame.payloadSha256`을 단정한 뒤 같은 socket으로 바이트 그대로 보낸다.
- 보류한 응답을 보내거나 재전송한 뒤 custom FIFO barrier를 쓴다. 모든 client에 `saylo-probe:barrier`를 보내고 그 id가 `read().barriers`에 들어온 후 UI 상태와 알림 수를 확인한다.
- 환경은 Node v24.18.0·Vite 8.3.2·React 19.3.0·react-dom 19.3.0·i18next 26.4.3·intl-messageformat 12.1.3, 브라우저는 HeadlessChrome/154.0.0.0이다.

## 관측 결과

variant별 12단계, 합계 24개다. 두 variant는 아래 표의 단계 값이 같다. session ID와 request ID는 각 fixture가 따로 생성한다. variant별 catalog request는 7개이고 notifications 벡터는 0/1/1/1/2/2/2/2/2/0/1/1이다.

| id | locale | text | cache | revision | notifications | 보존 |
| --- | --- | --- | ---: | ---: | ---: | --- |
| cold | fr | unloaded | 0 | 0 | 0 | true |
| load-demo | fr | fr Ada | 2 | 0 | 1 | true |
| patch-held-last-good | fr | fr Ada | 1 | 1 | 1 | true |
| newer-full-held-last-good | fr | fr Ada | 1 | 2 | 1 | true |
| newer-full-first | fr | Current Ada | 2 | 2 | 2 | true |
| older-patch-late-ignored | fr | Current Ada | 2 | 2 | 2 | true |
| locale-request-held-last-good | fr | Current Ada | 2 | 2 | 2 | true |
| newer-locale-wins | fr | Current Ada | 2 | 2 | 2 | true |
| superseded-locale-reply-ignored | fr | Current Ada | 3 | 2 | 2 | true |
| new-session-vite-reload | fr | unloaded | 0 | 0 | 0 | false |
| new-session-fresh-catalog | fr | Restarted Ada | 2 | 0 | 1 | false |
| retired-document-reply-replayed | fr | Restarted Ada | 2 | 0 | 1 | false |

`cache`는 `catalogSource.getCatalogs()` 길이다. 1~9단계는 input DOM identity·value `typed draft`·focus·caret 2~7·열린 dialog·counter `8`·`boots` 1·`errors` `[]`·`diagnostics` `[]`를 유지하고 보존은 true다. 10~12단계는 Vite 기본 reload 뒤 `boots` 2·input `initial draft`·counter `7`·dialog 닫힘으로 보존은 false다.

### 늦은 patch와 full compact

fr/demo를 `Obsolete {name}`(patch, `catalogVersion` 2)과 `Current {name}`(full compact, `catalogVersion` 3)으로 편집해 두 응답을 모두 보류한다. 서버 history는 직전 1개만 보존하므로 `known` `catalogVersion` 1로 들어온 v3 요청에 full compact를 돌려주는 것이 정상이다. 이 프로브의 첫 시도는 v3도 patch로 가정해 timeout으로 끝났지만 제품 결함이 아니었고 whole compact를 보류하는 방식으로 바로잡았다. 실패 시도의 raw는 남기지 않았다. v3를 먼저 release하면 `Current Ada`로 1회 commit하고 notifications는 2가 되며, 그 뒤 늦은 v2 patch를 release해도 UI와 notifications는 그대로다.

### locale supersede

ja locale API 요청의 compact를 보류한 채 fr locale API로 supersede하면 older-ja는 `SupersededRequestError`로 rejected, newer-fr은 fulfilled다. 늦은 JA 응답 뒤에도 UI는 fr `Current Ada`·notifications 2를 유지한다. 다만 늦은 응답이 source cache에서도 무조건 폐기되는 것은 아니다. 유효한 JA 응답은 cache를 2→3으로 올릴 수 있고 raw도 3이다. 이 실험이 검증하는 것은 UI publish 방지다.

### 세션 교체

실제 old `vite.close()` 뒤 watcher가 없는 동안 fr/demo를 `Restarted {name}`로 수정하고, 새 Saylo plugin(새 UUID)과 새 Vite를 같은 port에 start한다. 수동 페이지 navigate 없이 기본 Vite reconnect ping이 doc을 reload한다. 새 doc은 `boots` 2·`initial draft`·counter `7`·dialog 닫힘·cache 0이고 new SID는 old SID와 다르다. namespace demo를 로드하면 base en+fr reply 2개가 compact·`known` 없음·`catalogVersion` 1·SID new로 오고 표시는 `Restarted Ada`다. 그 뒤 실제 old v2 patch raw bytes를 new socket으로 controlled replay하면(자연 발생이 아니라 명시 fault injection) 새 doc UI는 `Restarted Ada`·notifications 1을 유지한다. 이것은 같은 i18n 인스턴스의 SID adoption도, pending flight가 세션 경계를 넘어 이어지는 것도 아니다.

## 해석과 한계

- 확인한 것은 늦은 응답과 세션 교체에서의 UI 관측이다. 성능·메모리·전체 race 범위·투명한 재연결·같은 인스턴스의 새 session 브라우저는 증거가 아니다.
- 새 session은 Vite 기본 client의 reload 경로로 열린다. [01](01-product-and-scope.md)이 적은 대로 Vite 재시작·재연결 reload는 상태 보존 보장 범위 밖이다.
- `layer`는 benchmark 전용 프로토타입이고 제품 진입 경로가 아니다. 제품 package·공개 API·버전·원격은 그대로이고 기존 SSR·production 결과를 뒤집지 않는다.

## 원본과 재현

원본은 [thin-layer-lazy-session-browser-2026-10-11.json](../benchmarks/results/thin-layer-lazy-session-browser-2026-10-11.json)이다. raw의 `codeHashes` 18개가 현재 source와 일치했고 소유 temp fixture는 정리됐다. variant별 delivery는 `release-on-original-socket` 3건과 `controlled-replay-on-new-socket` 1건이다.

```sh
node benchmarks/thin-layer/lazy-session-browser-probe.mjs --out benchmarks/results/thin-layer-lazy-session-browser-2026-10-11.json
```

## 상태

probe·raw·package script(`probe:lazy-session-browser`)는 로컬 커밋 `3a4251c`에 있고 기존 앱 템플릿을 재사용했다. 미푸시이며 제품 package의 API·의존성·버전은 바뀌지 않았다.
