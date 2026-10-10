# 56. i18next·Wuchale 계약 프로브

이 문서는 `benchmarks/thin-layer`의 Node 계약 프로브를 기록한다. 공개 i18next·i18next-icu·Wuchale 확장점과 Saylo parser·schema를 재사용한 격리 프로토타입으로 Saylo의 필수 계약 일부를 관측했다. 아래 native 항목은 이 프로브가 실제로 호출한 API의 동작 차이를 기록한다. 전체 얇은 계층 평가와 독립 런타임의 필요성 판정은 후속 과제이다.

관측은 2026-10-11(KST)이다.

## 실험 범위

- 실행 코드: [package.json](../benchmarks/thin-layer/package.json) · [i18next-layer.mjs](../benchmarks/thin-layer/i18next-layer.mjs) · [probe.mjs](../benchmarks/thin-layer/probe.mjs)
- 의존성 메이저 범위는 i18next 26·i18next-icu 2·intl-messageformat 12·wuchale 0이고 lockfile이 26.4.3·2.5.0·12.1.3·0.26.7을 고정한다.
- 프로토타입은 공개 i18next API에 ICU 서브클래스 `ValuesICU`를 붙여 `parse(values)`를 브리지하고 Saylo parser·schema·오류 클래스를 재사용한다. 카탈로그 AST를 i18next resource로 넣고 commit마다 새 엔진을 만든다. `t`는 실제 fallback 출처 로케일로 라우팅하고 필수 인자를 직접 검증한다.
- 여기서 확인한 것은 Node 계약뿐이다. Vite·브라우저 반영, 시간대, 캐시 무효화, 성능·메모리, typegen, 번들, SSR·hydration, DOM 상태 보존은 실행 증거가 없다.

## 관측 결과

저장소 루트에서 `npm --prefix benchmarks/thin-layer run probe`를 실행하면 exit 0으로 끝나고 관측 36개(`id` 중복 0)를 남긴다. `codeHashes` 6개는 실행 시점 파일과 모두 일치했다.

```json
{
  "schema": "saylo-thin-layer-contract-probe-v1",
  "observedAt": "2026-10-10T15:33:54.300Z",
  "environment": {
    "node": "v24.18.0"
  },
  "packages": {
    "i18next": "26.4.3",
    "i18next-icu": "2.5.0",
    "intl-messageformat": "12.1.3",
    "wuchale": "0.26.7"
  },
  "codeHashes": {
    "benchmarks/thin-layer/probe.mjs": "0efb53f859357da512189a030a8f60255bdbddf097498b5b15272487fb7c459e",
    "benchmarks/thin-layer/i18next-layer.mjs": "61786773b2da2428a039188794c10e03f9fa3591bc6009849fd0d32519a6bfcf",
    "benchmarks/thin-layer/package-lock.json": "d6bddc277a902507cccadc2dd1ead1d6cac81b923f2d6b6e3bdd4fd69859d7ee",
    "packages/core/dist/schema.js": "9a006afc8b2a999842bef34d61f4a91bc8610df66458ac3bc6e472bf65dd739f",
    "packages/core/dist/catalog.js": "eac4c686d9c15a49b5301ee466568acf19b0fbee0c1e5987aae6dfc0d572b7d9",
    "packages/core/dist/translator.js": "d7c0102bd58b89c38613023e24ff8d42b55e53d50397d2c4cb64c1c849f8ee5f"
  },
  "scope": "Node contract probe only: public i18next/ICU/Wuchale extension APIs and an isolated i18next AST-resource prototype reusing Saylo parser/schema. Native observations describe tested API behavior, not library defects. No Vite/browser, typegen, lazy session protocol, performance, memory, production bundle or timezone proof.",
  "prototypeCosts": [
    "Saylo parser/schema retained",
    "new i18next and ICU instances per committed snapshot",
    "incremental parsed catalog and AST resource reuse; revision instances still rebuilt",
    "separate argument validation and source-locale fallback routing",
    "public error classes reused; no UI subscription/loader/disposal API implemented"
  ]
}
```

### 프로토타입 계약

| 계약 | 관측 |
| --- | --- |
| 이전 snapshot 고정 | 이전 `t`는 `Hi Ada`, 새 snapshot은 `Updated Ada` |
| 키 삭제 | 새 snapshot은 `UnknownMessageError`, 이전 snapshot은 옛 값 유지 |
| 부분 fallback | base 영어 plural로 `21 rows` |
| 빈 문자열 | 번역의 `""`를 그대로 반환 |
| literal 점·`__proto__`·`constructor` | `literal`·`prototype literal`·`constructor literal` |
| 예약 인자 | `{lng}`·`{ns}`에 고객 값을 넣어 `customer / order` |
| 미등록 키 | `UnknownMessageError` |
| 필수 인자 | 누락·`"2"`·`NaN` 모두 `InvalidArgumentError` |
| 잘못된 schema·ICU | commit 전 `CatalogError`, 직전 snapshot identity 유지 |
| 요청 격리 | 다른 instance의 편집이 앞 instance에 새지 않음 |
| 로케일 추가·삭제 | `ja` 선택 가능, 삭제 뒤 base로 복귀 |
| 증분 준비 | base 재파싱 없이 parsed 1·resource 1 |

### native API 동작

- i18next: cache store 이벤트(`added removed`)를 주면 resource 추가가 기존 `t`와 `getFixedT`에 바로 반영된다(`Updated Ada`).
- i18next: 생략한 base 인자를 요구하지 않고 숫자 문자열 `"2"`도 받는다. fallback ICU의 로케일 선택도 다르다. Saylo는 base로 `21 rows`를, native는 선택 로케일로 `one row`를 낸다.
- Wuchale: compiled positional은 숫자 `0`으로 동작한다. named ICU 문자열을 그대로 넣으면 literal로 남아 `{name}`이 치환되지 않아 변환이 필요하다. native runtime은 module 교체를 따라가 옛 `t`도 바뀌고, deep-frozen 복제본은 원본을 유지하며 변이도 거부한다.

## 해석과 한계

- Node 범위에서는 기존 formatter 위에서도 계약 일부가 충족됐다. 독립 formatter가 유일한 해법이라는 근거는 이 프로브에 없다.
- 비용은 남는다. Saylo parsing·schema는 그대로 필요하고 commit마다 i18next·ICU 인스턴스를 새로 만든다. lifecycle loader·UI·disposal API는 없다.
- Wuchale는 원본 데이터 형식이 달라 변환이 필요하다. 확인한 입력에서의 차이이고 ICU 전반 미지원 주장이 아니다.
- 따라서 독립 런타임 필요성이나 전체 얇은 계층 평가가 끝났다고 쓰지 않는다. 목표는 여전히 독립 라이브러리이고 구조를 갈아엎을 근거도 아직 없다.
- 공식 문서: [i18next API](https://www.i18next.com/overview/api)(`getFixedT`·`forkResourceStore`), [i18next-icu README](https://github.com/i18next/i18next-icu/blob/master/README.md)(cache store 이벤트·FormatJS 연동), [Wuchale](https://wuchale.dev/)(compiled positional data). AST resource 전달은 설치한 버전의 실제 실행으로 확인한 경로이다.

## 원본과 재현

원본은 [thin-layer-contracts-2026-10-11.json](../benchmarks/results/thin-layer-contracts-2026-10-11.json)이다.

```sh
npm --prefix benchmarks/thin-layer install --ignore-scripts
npm --prefix benchmarks/thin-layer run probe
```

## 상태

시제품과 관측 기록은 로컬 커밋 `2d5b5a2`·`23f298b`에 있다. 제품 패키지의 API·의존성과 버전은 변경하지 않았으며 원격 반영·게시는 없다.
