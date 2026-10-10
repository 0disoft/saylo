# 65. thin-layer AST-only production formatter

## 범위

[64](64-thin-layer-timezone-adapter.md)가 미충족으로 남긴 production parser-free gate를 닫은 기록이다. 코드는 커밋 `d04c841`에 있다. 대상은 `benchmarks/thin-layer` benchmark helper이고 제품 package·공개 API는 바뀌지 않았다.

## helper (`ast-runtime.mjs`)

- benchmark 전용 Vite plugin이고 `apply`는 build 한정이다.
- 전용 formatter `ast-format.mjs`의 `intl-messageformat` import만 virtual 모듈로 rewrite한다. 다른 문자열 기반 IMF 소비 경로는 그대로 둔다.
- 공급한 IMF entry 소스의 `@formatjs/icu-messageformat-parser` import를 공식 `no-parser.js`로 바꾼다. vendor helper dependency는 원래 source 파일 위치 기준으로 resolve한다.
- 지원하지 않는 import·entry·vendor 경계는 넘기지 않고 명시적으로 throw한다.

## 결과

같은 3메시지 en·ru eager fixture를 실제 Vite production build 4개로 만들었다. unminified·target esnext·lib es·write false이고 single chunk를 data URL로 Node에서 실행한다.

| variant | unminified (bytes) | gzip (bytes) | parser entry | no-parser entry | marker |
| --- | --- | --- | --- | --- | --- |
| core | 54300 | 15417 | 1 | 1 | false |
| layer | 188261 | 47449 | 2 | 1 | true |
| layer-ast | 136211 | 35363 | 1 | 2 | false |
| layer-ast-mixed | 199618 | 50008 | 2 | 2 | true |

- 네 출력 모두 greeting `Hi Ada`, fallback plural `0 rows`, default UTC date·time skeleton `1/1/2026 / 00:30`, unknown key·missing argument 거부가 통과한다.
- `layer-ast-mixed`는 unrelated raw string `IntlMessageFormat`도 함께 실행해 `External Ada`를 확인했다. 그 경로의 parser는 남는다.
- marker는 emission marker `EXPECT_ARGUMENT_CLOSING_BRACE`다. `layer-ast`는 marker가 없고 no-parser entry가 2개다. index entry가 그래프에서 완전히 사라지는 것은 아니다. index는 TYPE export도 있어 남을 수 있고, marker 부재와 no-parser 그래프가 함께 tested formatter의 AST 경계를 지지한다.
- 크기는 fixture 관측이다. general bundle 계수나 성능·메모리 측정이 아니다.
- [3메시지 원시 결과](../benchmarks/results/thin-layer-production-ast-runtime-2026-10-11.json)는 `d04c841` 시점의 실행 기록이다.

## 비용·남은 목표

- source dependency rewrite는 추가 build glue다. main 유지보수 대상이고 future IMF major에서 CI로 검증해야 한다.
- 판정: prototype의 standalone runtime AST-only와 tested small fixture의 production parser-free gate는 닫혔다.
- SSR hydration·lazy·전체 계약·large scale 성능·production browser는 아직 남아 있다.
- 재현은 `node benchmarks/thin-layer/production-probe.mjs --out benchmarks/results/thin-layer-production-ast-runtime-2026-10-11.json`이다.

## 확장 format 벡터 (`fc4b7ba`)

- probe에 선택 옵션 `--vectors`를 넣었다. 옵션이 없으면 기본 3메시지 fixture라 원래 재현 동작은 그대로다. 위 small fixture 수치는 당시 기록으로 보존한다. harness 소스 지문이 바뀌었으므로 이전 실행을 현재 소스의 실행 기록으로 취급하지 않는다.
- `--vectors`는 서로 다른 메시지 11개와 실행 경로 12개를 더한다. decimal, currency number skeleton, percent named, datefull, date skeleton, default time, ordinal 22nd, selection Alpha, 중첩 plural의 날짜 분기와 select·time 분기, literal `<b>` tag, reserved `lng`·`ns`·`count` 문자열이다.
- 실제 production build 4개를 그대로 실행해 출력마다 12개, 모두 48개 format 비교가 통과한다. 원래 greeting·plural·date·오류 단언과 mixed `External Ada`도 계속 통과한다.
- parser marker는 core·`layer-ast` false, `layer`·`layer-ast-mixed` true로 small fixture와 같다.
- 확장 fixture 크기는 core 70477 unminified·16968 gzip, `layer` 203551·49161, `layer-ast` 151501·37056, `layer-ast-mixed` 214908·51716이다. 위 small fixture 값과 섞어 읽지 않는다.
- [원시 결과](../benchmarks/results/thin-layer-production-ast-vectors-2026-10-11.json). 재현은 `node benchmarks/thin-layer/production-probe.mjs --vectors --out benchmarks/results/thin-layer-production-ast-vectors-2026-10-11.json`이다.
- 제품 source는 바뀌지 않아 root check 전체는 돌리지 않았다.
