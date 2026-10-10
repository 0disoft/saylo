# 57. 얇은 계층 브라우저 프로브

이 문서는 `benchmarks/thin-layer`의 브라우저 기능 스모크를 기록한다. 실제 Vite 8 개발 서버·React 19·headless Chrome 154에서 eager full-registry 연결로 편집·오류 복구·로케일 추가·선택·삭제 흐름이 동작하고 입력·DOM 상태가 보존되는지 확인했다. 확인한 것은 기능 동작뿐이고 성능·메모리·번들·SSR·hydration·시간대·lazy·재연결·세션은 판정하지 않는다.

관측은 2026-10-11(KST)이다.

## 실험 범위

- 실행 코드: [browser-smoke.mjs](../benchmarks/thin-layer/browser-smoke.mjs) · [browser-app.jsx](../benchmarks/thin-layer/browser-app.jsx) · [catalog-layer.mjs](../benchmarks/thin-layer/catalog-layer.mjs)
- 하니스는 임시 fixture에 실제 `@0disoft/saylo-vite` 플러그인으로 Vite 개발 서버를 띄우고 headless Chrome을 붙여 `/__thin` 미들웨어로 명령·ack·trace를 주고받는다.
- `browser-app.jsx`는 `virtual:saylo`의 `baseLocale`·`initialCatalogs`·`initialLocale`를 받아 `catalog-layer.mjs`의 AST 얇은 계층을 만들고 Saylo eager transport·parser·schema를 재사용한다. 즉 full registry를 eager로 받는 연결이다.
- 구독은 테스트 전용 serial bridge(React `useSyncExternalStore`)이고 제품 loader·session 구현이 아니다. 브라우저 앱 profile은 watcher 대상에서 제외한다.
- 시나리오 사이에는 150ms 간격을 둔다.
- 의존성은 i18next 26.4.3·i18next-icu 2.5.0·intl-messageformat 12.1.3·Vite 8.3.2·React 19.3.0이고 브라우저는 HeadlessChrome/154.0.0.0이다.

## 관측 결과

`npm --prefix benchmarks/thin-layer run browser`는 exit 0으로 끝나고 관측 8개를 남긴다. `codeHashes` 10개는 현재 소스 파일과 모두 일치했다.

| id | 표시 문구 | locale | locales | 진단 |
| --- | --- | --- | --- | ---: |
| edit | Updated Ada | fr | en, fr | 0 |
| invalid-json | Updated Ada | fr | en, fr | 1 |
| recover-json | Recovered Ada | fr | en, fr | 1 |
| invalid-schema | Recovered Ada | fr | en, fr | 2 |
| recover-schema | Ready Ada | fr | en, fr | 2 |
| locale-add | Ready Ada | fr | en, fr, ja | 2 |
| locale-select | こんにちは Ada | ja | en, fr, ja | 2 |
| locale-remove-selected | Hello Ada | en | en, fr | 2 |

8개 관측 모두 `preserved`가 `true`이고 이전 snapshot 문구는 `Bonjour Ada`다. invalid-json은 직전 정상 문구(`Updated Ada`)를 유지한 채 진단 1개를 남기고 recover-json이 `Recovered Ada`를 커밋한다. invalid-schema도 직전 snapshot을 유지하고 recover-schema 뒤에 `Ready Ada`가 반영된다.

### ack 검사

각 ack에서 `input` DOM identity·value(`typed draft`)·focus, 열린 `dialog`, counter `8`, 이전 snapshot `Bonjour Ada` 유지 검사를 통과했다. `fallbackPlural`은 모든 관측에서 `0 rows`이고, count 0에서 영어 base plural을 선택 로케일(fr) 포맷과 구분하는 값이다. `locale-remove-selected` 뒤 표시는 `Hello Ada`로, 선택 로케일이 없어지면 source 로케일 fallback으로 돌아간다. 진단 문구는 invalid JSON의 `fr/demo.json: Invalid JSON: Expected property name or '}' in JSON at position 1 (line 1 column 2)`와 schema 오류의 `fr/demo.json [greeting]: Translation introduces argument "unexpected" absent from the base message.`다.

## 초기 연결 오류

초기 재실행 중에는 브라우저 연결 단계의 fetch 오류로 진행하지 못했다. 하니스가 공개 runtime 엔트리(`@0disoft/saylo-core/runtime`)와 `@0disoft/saylo-vite/client`를 prebundle 대상에 넣고 `catalog-layer.mjs`가 공개 specifier를 쓰도록 바로잡은 뒤, 최종 소스에서 스모크를 연속 2회 PASS로 확인했다. 제품 패키지 코드·의존성은 바꾸지 않았다.

## 해석과 한계

- eager full-registry 연결이다. lazy·재연결·세션 프로토콜, 운영 빌드, SSR·hydration, 시간대, 메모리, 성능 비교는 확인하지 않았다.
- 처음에는 시나리오 사이 간격 없이 시도했으나 invalid JSON 복구 단계에서 timeout이 났다. 브라우저 앱 profile을 watcher 대상에서 빼고 150ms 간격을 둔 뒤 8개가 통과했으며 원인은 확정하지 않는다.
- 무간격 연속 실패·복구에는 결함이 남아 있다. 별도의 실제 Vite SSR source·watcher 실험(gap 0/60/0ms)에서 invalid JSON 진단 직후 valid 저장이 gap 0 두 run에서는 watcher change 1개·`Initial`·revision 0으로 복구되지 않았다. gap 60 run(실제 86.17ms)에서만 change 2개·`Recovered`·revision 1로 복구됐다([원본](../benchmarks/results/rapid-recovery-2026-10-11.json)). 브라우저·i18next 없이 재현돼 watcher 이벤트 단계의 문제로 보인다. 설치된 Vite bundle에는 change 이벤트 50ms throttle이 있지만, 이를 끈 대조 실험을 하지 않아 정확한 인과는 확정하지 않는다.
- 이 스모크만으로 독립 런타임 필요성이나 전체 얇은 계층 평가를 판정하지 않는다.

## 원본과 재현

원본은 [thin-layer-browser-2026-10-11.json](../benchmarks/results/thin-layer-browser-2026-10-11.json), 무간격 복구 재현은 [rapid-recovery-2026-10-11.json](../benchmarks/results/rapid-recovery-2026-10-11.json)이다.

```sh
npm --prefix benchmarks/thin-layer install --ignore-scripts
npm --prefix benchmarks/thin-layer run browser
node benchmarks/thin-layer/rapid-recovery.mjs
```

## 상태

브라우저 스모크와 코드 분리는 로컬 커밋 `f3dd7a1`·`568232f`·`57261fb`에 있고 미푸시다. 제품 패키지의 API·의존성·버전은 변경하지 않았으며 게시·배포는 없다. 무간격 복구 결함은 제품 수정 없이 재현 기록만 남겼다.
