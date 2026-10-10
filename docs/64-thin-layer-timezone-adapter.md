# 64. thin-layer 시간대 어댑터와 수정 결과

## 범위

[63](63-thin-layer-timezone.md)이 미충족으로 남긴 시간대 항목을 어댑터로 고친 기록이다. 코드·테스트·결과는 커밋 `5fec231`에, production 측정은 `905f208`에 있다. 대상은 `benchmarks/thin-layer` 프로토타입뿐이고 제품 소스·`packages/vite`·버전은 바뀌지 않았다. production build는 이 문서가 다루고 SSR·hydration·lazy·성능은 아직 범위가 아니다.

## 변경

- main adapter가 i18next-icu의 ICU plugin 대신 공개 `i18nFormat` 모듈(`ast-format.mjs`)을 직접 구현한다.
- `IntlMessageFormat` 인스턴스와 plugin 소유 bounded cache를 쓴다. message 256, number·date·plural 각 128이다.
- engine과 snapshot마다 formatter를 새로 만들고, 받은 timeZone을 canonical 이름으로 정규화한다. 옵션이 없으면 UTC다.
- 원본 AST·전역 `Intl`·정적 `IntlMessageFormat.formats`는 수정하지 않는다.
- date/time 기본값, named style, skeleton, select 안쪽 skeleton, source fallback까지 모든 경로가 같은 timeZone을 쓴다.
- `i18next-layer.mjs`의 `createLayer`가 4번째 options를 받아 전달하고, 정규화한 값만 보관해 이후 호출자 options 변경에 흔들리지 않는다.
- 직접 유지·관리하는 범위가 늘었다. IMF 인스턴스·캐시·formatter 모듈을 계속 들고 가야 하고, i18next-icu 설정 한 줄을 추가하는 방식이 아니다. 이번 기록은 그 관리 범위를 다루고 성능 비용은 재지 않았다.

## 검증

- `timezone.test.mjs` 5개 PASS: canonical alias·invalid zone 거부, 동시 요청 격리와 공유 AST·전역 formats 불변, 교체 후 old·new snapshot 분리와 invalid candidate 거부, 선택 로케일 제거 뒤 fallback, source adapter의 options mutation 무시.
- Node 3 호스트 56사례 × 2경로(default UTC·명시 host) = 336비교다. default UTC 불일치 0/0/0, 명시 host 불일치 0/0/0.
- native ICU `formats` 우회는 프로브의 별도 참고 기준이다. 63 시점 값에 그치지 않고 이번 v2 프로브에서도 같은 0/14/14를 다시 관측했다. 이번 수정 대상은 아니다.
- 기존 계약 프로브 36개 PASS다. 브라우저·시간대 주장은 그 프로브와 별개다.
- 브라우저 8단계(edit, invalid-json, recover-json, invalid-schema, recover-schema, locale-add, locale-select, locale-remove-selected) PASS다. host는 Asia/Seoul이고 각 단계에서 default UTC date·time skeleton과 retained old snapshot의 시간대가 UTC로 유지되며 DOM 상태도 보존됐다.
- 프로브 전후로 source·dist baseline 해시가 같다. metadata 해시는 dependency entry를 포함해 12개다.

## production parser 경계 위험

- `packages/vite/src/ast-formatter.ts`는 core dist `formatters.js`를 importer로 삼을 때만 `intl-messageformat`을 별 target으로 돌리고, 그 안의 ICU parser import를 `no-parser.js`로 바꾼다.
- 새 `ast-format.mjs`의 IMF는 그 경계와 무관한 별개 target이다. 이 경계만 보면 parser 제거를 입증하지 못하고, 당시에는 정적 위험이었다. 아래 production build에서 실제로 확인했다.
- AST 리소스를 쓴다는 사실만으로 parser-free가 되지 않는다.

## production build (`905f208`)

- 같은 small eager AST fixture(en·ru demo 3 메시지)를 Vite 실제 production build로 돌렸다. unminified·target esnext·lib es·write false로 만들고, single chunk를 data URL로 Node에서 import해 snapshot을 실행한다.
- 실행 단언은 greeting `Hi Ada`, source fallback plural `0 rows`, default UTC date·time skeleton `1/1/2026 / 00:30`, unknown key와 missing argument 거부다.
- 크기는 core 54300 unminified·15417 gzip, layer 188261 unminified·47449 gzip이다. fixture 관측이고 일반 package 크기 계수나 large production 측정이 아니다.
- 빌드 그래프는 core가 parser entry 1·no-parser entry 1, layer가 parser entry 2·no-parser 1이다.
- parser entry는 AST types도 export해서 그래프 존재만으로 parser 구현 보존을 증명하지 못한다. 대신 emission marker `EXPECT_ARGUMENT_CLOSING_BRACE`로 확인한다. core는 false, layer는 true다. bundle hash도 저장한다.
- core schema가 TYPE import로 index module을 그래프에 넣지만 parser 코드는 tree-shaken이다. layer는 default IMF source import가 독립이라 parser가 남고, core formatter의 private boundary가 이 경로를 덮지 않는다.
- 그래서 prototype의 production parser-free gate는 미충족이고 runtime 기본 동작만 확인됐다.

## 재현

```sh
npm --prefix benchmarks/thin-layer run test:timezone
node benchmarks/thin-layer/timezone-probe.mjs
node benchmarks/thin-layer/probe.mjs --out benchmarks/results/thin-layer-contracts-timezone-fixed-2026-10-11.json
node benchmarks/thin-layer/browser-smoke.mjs --out benchmarks/results/thin-layer-browser-timezone-fixed-2026-10-11.json
node benchmarks/thin-layer/production-probe.mjs --out benchmarks/results/thin-layer-production-parser-2026-10-11.json
```

- 원시 결과는 [timezone](../benchmarks/results/thin-layer-timezone-fixed-2026-10-11.json), [계약 프로브](../benchmarks/results/thin-layer-contracts-timezone-fixed-2026-10-11.json), [브라우저](../benchmarks/results/thin-layer-browser-timezone-fixed-2026-10-11.json), [production](../benchmarks/results/thin-layer-production-parser-2026-10-11.json)에 있다.
- `timezone-probe.mjs`는 옵션이 없으면 새 파일 이름으로 저장한다.

## 남은 목표

SSR 렌더·hydration, 브라우저 3 시간대 매트릭스, lazy·전체 계약·성능 비교와 릴리스 전달 결정이 아직 남아 있다. 실제 production build는 돌렸지만 layer가 parser marker를 실어 parser-free gate는 미충족이고, large catalog·성능·메모리는 측정하지 않았다. 판정은 Node·브라우저 기능 범위의 시간대 개선이고 전체 목표 완료가 아니다. 제품 소스·버전 변경과 push·publish는 없다.
