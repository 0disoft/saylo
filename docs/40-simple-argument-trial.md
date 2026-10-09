# 40. 단순 메시지 인자 수집 실험

[15](15-simple-message-parser.md)의 단순 파싱 경로에서 인자 수집을 합쳐 일반 AST 재순회를 없애는 실험을 했다. cold 신규 파싱의 p50·p95가 모두 증가해 성능 근거가 부족하다고 보고 되돌렸다. 제품 코드와 계측 하네스는 `cbf30aa7b915038efa6b5f7e369142877adad688` 상태로 유지한다. 실험은 [패치](../benchmarks/results/simple-arguments-experiment.patch)로 보존한다.

## 실험 범위

`parseSimpleMessage`에 선택적 Set 인자를 추가하고 ASCII 인자 이름을 만나는 순서대로 수집했다. 파싱이 성공했을 때만 `inferSimpleArguments`로 수집 결과를 받아 일반 AST walk를 생략했다. Set은 중복을 제거하고, 기존 일반 ICU 경로와 같은 JSON schema signature와 per-parse 캐시를 공유했다. 단순 경로가 실패하면 수집한 prefix를 버리고 기존 FormatJS 파싱과 `inferArguments`로 되돌아가 충돌과 오류 위치를 그대로 검증했다. 공개 export·버전·wire 형식은 바꾸지 않았고 `parser-probe`의 계측 경계도 함께 수정했다.

되돌린 파일은 `packages/core/src/simple-message.ts`, `packages/core/src/schema.ts`, `packages/core/src/catalog.ts`, `packages/core/test/simple-message.test.mjs`, `benchmarks/live-update/parser-probe.mjs` 다섯 개다. 되돌린 뒤 core dist도 다시 빌드했다.

## 측정 조건

Node v24.18.0, Windows x64에서 실행했다. cold는 2026-10-09T07:57:34.713Z, incremental은 2026-10-09T07:58:43.423Z에 기록됐다. 한 파일에 일반 텍스트와 ASCII `{name}` 메시지 10,000개를 두고 probe 하나만 매회 같은 길이 값으로 바꿨다. 기준 커밋 `cbf30aa`의 소스를 임시 디렉터리에서 빌드한 파서와 실험 파서를 같은 프로세스에서 순서를 번갈아 호출했다.

cold는 이전 카탈로그 없이 warmup 5쌍·측정 20쌍이다. incremental은 이전 카탈로그를 재사용하고 warmup 50쌍·측정 100쌍이다. 매쌍 파싱 결과 전체를 `assert.deepEqual`로 대조했다. 호출 wall time만 측정하고 입력 stringify·동등성 검사·디스크·watcher·번역 검증·브라우저는 제외했다. p50·p95는 nearest-rank이며 쌍별 차이는 실험−기준이다. p95들을 합산하거나 GC·control 시간을 차감하지 않는다.

```sh
git apply benchmarks/results/simple-arguments-experiment.patch
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs cbf30aa benchmarks/results/parse-compare-simple-arguments-cold.json cold
node benchmarks/live-update/parse-compare.mjs cbf30aa benchmarks/results/parse-compare-simple-arguments-incremental.json incremental
```

재현할 때는 기준 커밋의 별도 checkout을 사용하고 보존 패치를 그 checkout의 같은 경로로 복사한다. 결과의 `baselineRevision`은 `cbf30aa7b915038efa6b5f7e369142877adad688`이다. `currentCodeHashes`는 되돌리기 전 실험 dist를 가리키며 cold·incremental이 같다.

```text
catalog.js        fd4f90aabdce544ec23f9f18cfe6929325b9c5da59638de21802f68e47162ea2
simple-message.js d451f910d0e82577a95e51ed2e58cc91d4835e8bc57447c5f1af5b1598c28fe5
schema.js         fa82dfd0b7ece567b8f01b9e27cd6a297356f2fa415bef079048b8bf76bb8c17
json.js           ab6c3ba9b7a534e453b9468baa8a6513da3e5fc1ab82f660f12df793f0cdf80b
diagnostics.js    3d512b1fba5b545937309dced114bd52da5a67b1e4f2fe01deef33080c923ed7
```

## 결과와 채택 판단

| 모드 | 기준 p50 | 실험 p50 | 기준 p95 | 실험 p95 | 쌍별 차이 중앙값 | 쌍별 차이 p95 | 빨라진 쌍 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 98.46 | 117.02 | 183.20 | 207.63 | +11.62 | +53.64 | 4/20 |
| incremental | 41.36 | 40.18 | 61.25 | 60.20 | −0.90 | +13.38 | 54/100 |

단위는 ms이다. cold는 신규 파싱 p50·p95가 모두 증가했고 20쌍 중 4쌍만 빨랐다. 최대값은 284.12ms에서 222.94ms로 낮아졌지만 집계는 나빠졌다. incremental은 집계 p50·p95가 소폭 낮고 100쌍 중 54쌍이 빨랐으나, 쌍별 p95가 +13.38ms이고 최대값이 76.56ms에서 140.43ms로 약 1.8배가 됐다. min은 24.12ms에서 21.12ms로 낮아졌다. 집계가 조금 좋아진 모드가 있어도 cold 신규 경로의 증가와 단일 run의 흔들림을 함께 보면 실험 비용을 정당화할 근거가 부족하다. 제품 3개·테스트·probe의 변경을 모두 되돌렸다.

단일 장비의 실행 부하·GC·스케줄링을 통제하지 않았으므로 증가 원인이나 회귀를 코드로 확정하지 않는다. 화면 반영이나 로케일 추가 목표에서 이 실험의 효과를 판단하지도 않는다. 다음 작업은 특정 최적화로 확정하지 않고 다른 구조적 병목 후보를 검토하는 것으로 둔다.

## 검증과 보존 자료

실험 상태에서 core build·테스트 76개·consumer 타입 검사가 통과했다. catalog·simple·probe 관련 선택 테스트 33개도 통과했으나 서로 겹치므로 합산하지 않는다. generated 121 combinations를 인자 계약 reference와 대조했고 cross-path 공유·수집 순서·prototype 이름·충돌·불변성을 확인했다. cold 25쌍(warmup 5·측정 20)·incremental 150쌍(warmup 50·측정 100) 모든 pair에서 전체 파싱 결과 deepEqual이 성공했다. 새 live·browser·release 검증이나 성능 목표 달성·게시는 하지 않았다.

원복 뒤 core build와 `parser-probe.test.mjs`를 통과했다. 제품·probe 작업 트리에 diff가 없고 변경한 세 dist 모듈의 해시가 실험본과 다르며, 변경하지 않은 JSON·diagnostics 해시는 같음을 확인했다. 원시 쌍의 개수·차이·nearest-rank 요약과 두 run의 코드 해시를 대조했고, `git apply --check`로 보존 패치의 재적용 가능 여부를 검사했다. 임시 parser 디렉터리는 정리됐다.

- [cold 비교와 원시 쌍](../benchmarks/results/parse-compare-simple-arguments-cold.json)
- [incremental 비교와 원시 쌍](../benchmarks/results/parse-compare-simple-arguments-incremental.json)
- [되돌린 실험 패치](../benchmarks/results/simple-arguments-experiment.patch)

버전 변경·push·publish·deploy는 없다.
