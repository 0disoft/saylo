# 63. 얇은 계층 시간대 계약 프로브

## 범위

[57](57-thin-layer-browser-probe.md)이 남긴 얇은 계층 평가 항목 중 시간대를 Node에서 관측한 기록이다. 대상은 현행 카탈로그 계층(`benchmarks/thin-layer/catalog-layer.mjs`)과 i18next-icu 공개 설정의 시간대 처리다. 브라우저·SSR hydration·성능은 범위 밖이고 제품 소스는 바뀌지 않았다.

## 조건

- Node v24.18.0에 i18next 26.4.3, i18next-icu 2.5.0, intl-messageformat 12.1.3(설치본 실측)이다.
- `UTC`·`Asia/Seoul`·`America/Los_Angeles`를 각각 독립 child의 `TZ`로 넣는다. child는 `Intl.DateTimeFormat().resolvedOptions().timeZone === process.env.TZ`를 단정해 시간대 적용을 확인한다.
- 고정 순간 2개(`2026-01-01T00:30Z`·`2026-06-30T23:30Z`)에 인자 타입 2개(ms number·`Date`)와 실행 경로 14개를 곱해 호스트당 56건, 전체 168건을 관측한다.
- 메시지 13개는 `{at, date}`·`{at, time}`, skeleton 2개, select 안쪽 skeleton 1개, named date/time style 4개씩이다. select는 date·time 두 분기를 실행한다. `datefull`은 ru 번역본에서 빼 fallback en 소스 경로를 함께 본다.
- 전역 `Intl`, 정적 `formats` 객체, 원본 AST는 수정하지 않는다.

## 결과

기준은 core `createTranslator`를 UTC로 돌린 값이다. 함께 돌린 호스트 시간대 값은 현행 계층이 호스트와 일치하는지 보는 비교 대상이다.

| 호스트 | 사례 | 계층 ≠ UTC | 공개 named ≠ UTC |
| --- | --- | --- | --- |
| UTC | 56 | 0 | 0 |
| Asia/Seoul | 56 | 42 | 14 |
| America/Los_Angeles | 56 | 42 | 14 |

- 현행 계층은 모든 사례에서 호스트 시간대 값과 일치한다. 시간대는 전적으로 호스트에서 온다.
- 현행 계층에는 시간대 옵션이 없다. `createCatalogLayer`의 init에 `timeZone`이 없고 `ValuesICU.parse`도 `options.values`만 넘긴다.
- UTC가 아닌 두 호스트에서 계층 값은 UTC 기준값과 42건씩 어긋난다. 날짜만 쓰는 id는 순간 1개에서만 어긋나 2건, 시간을 쓰는 id는 두 순간 모두 어긋나 4건이다.

### 공개 formats 우회

`IntlMessageFormat.formats`의 named date/time style 전부에 `timeZone: 'UTC'`를 덮은 별도 인스턴스와 비교했다.

- named `short`·`medium`·`long`·`full`과 `{at, time}` 기본값은 UTC 기준값과 맞는다.
- 남는 gap은 14건이다. `{at, date}` 기본값 2건, `{at, date, ::yyyyMMdd}` 2건, `{at, time, ::HHmm}` 4건, select 안쪽 skeleton 6건이다.
- `formats` 옵션으로 named style과 medium을 쓰는 기본 time은 고정할 수 있지만, style 없는 기본 date와 skeleton은 이 설정에서도 호스트 시간대를 쓴다.

## 설치본 근거

- `benchmarks/thin-layer/node_modules/i18next-icu/dist/es/index.js`는 `new IntlMessageFormat(res, transformedLng, this.formats, { ignoreTag: true })`로 만든다. 호출마다 넘길 수 있는 자리가 `formats` 하나뿐이다.
- 같은 패키지 `index.d.ts`의 `IcuConfig`에는 `memoize`·`memoizeFallback`·`formats`·`bindI18n`·`bindI18nStore`·`parseErrorHandler`·`parseLngForICU`·`escapeVariables`만 있고 formatter 주입 옵션이 없다.

## 해석

- 이번 결과는 현행 prototype의 시간대 부족분이다. vendor 결함이나 시간대 지원 불가 증명이 아니다.
- 우회 후보는 둘이다. i18next-icu 공개 확장점에 맞춘 custom `i18nFormat` 구현, 또는 인스턴스별 AST 적응이다. 둘 다 아직 구현하지 않았다.
- 어느 쪽이든 원본 AST·전역 `Intl`·정적 `formats`를 고치면 안 되고 cache·snapshot·요청 격리 검증이 함께 필요하다.
- 판정: 얇은 계층의 시간대 계약은 미충족이다.

## 검증·원시 결과

- 프로브가 실행 전후로 프로브·`catalog-layer`·`package-lock`·core formatter/translator 소스·dist와 의존성 진입 파일 해시를 대조해 변경이 없음을 확인했고, 그 해시를 결과 파일에 남겼다.
- [원시 결과](../benchmarks/results/thin-layer-timezone-2026-10-11.json)에 호스트별 56행 전체가 있다.
- 재현은 `node benchmarks/thin-layer/timezone-probe.mjs`이고 출력 경로는 `--out`으로 바꾼다.

## 남은 목표

얇은 계층의 시간대 항목은 미충족으로 남는다. lazy·production·전체 계약·성능 비교와 릴리스 전달 결정도 그대로다. 이번 기록은 Node 관측 하나이며 전체 목표 완료가 아니다.

## 후속 (`5fec231`)

이 문서의 42·14건은 v1 프로브(`saylo-thin-layer-timezone-v1`) 기준이고, 그 수치가 지금도 현재 gap이라는 뜻이 아니다. 프로브는 v2로 바뀌어 기본 UTC를 기대값으로 삼고 default UTC·명시 host 불일치가 0이다. 이 문서의 원래 측정을 재현하려면 `a35af08`·`eb1986a` 시점 스크립트를 쓴다. 수정 내용과 새 관측은 [64](64-thin-layer-timezone-adapter.md)를 따른다.
