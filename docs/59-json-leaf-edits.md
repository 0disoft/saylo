# 59. JSON leaf 편집 fastpath

## 배경

`packages/core`에 이전 성공 파싱의 JSON leaf 범위를 재사용하는 편집 경로를 넣었다. 커밋은 `5558185`(검증된 JSON span 재사용)와 `432ca35`(provenance를 compact id와 `Uint32Array` span으로 보관)다. `packages/vite`의 `1ab93d5`는 최신 batch가 대기 중일 때 이전 읽기의 token이 이미 최신 batch로 교체됐다면 중복 disk drain을 예약하지 않는 변경이다.

## 적용 범위

fastpath는 편집된 leaf가 단일 문자열 토큰이고 이전 성공 파싱 provenance와 일치할 때만 cache를 쓴다. 다음은 cache 대상이 아니며 full strict parse로 되돌아간다.

- 키 추가·삭제·이름 변경
- 값 여러 개 동시 변경
- 객체·배열 구조 변경
- 문자열 토큰으로 검증되지 않는 invalid JSON
- provenance가 없는 foreign catalog

변경된 문자열의 ICU와 인자 계약도 기존 검증 경로를 따른다. ICU·스키마 위반을 cache로 숨기지 않는다. provenance는 성공 파싱만 `WeakMap`에 남기고 실패 파싱은 기록하지 않는다. 보관한 span·id의 메모리 증가량은 정량 측정하지 않았으므로 이득으로 세지 않는다. cold 이득도 주장하지 않는다.

## 파서 paired 비교

[../benchmarks/results/json-leaf-compare-2026-10-11.json](../benchmarks/results/json-leaf-compare-2026-10-11.json)는 single-process parser-only 비교다. 메시지 10k, before/after 교차 순서이고 입력 stringify·deep equality는 timing에서 제외한다. 파일의 top-level `codeHashes`는 현행 dist(`packages/core/dist/json.js` `acc8f2e9`, `catalog-json.js` `9012d701`)와 일치하고 `beforeRef`는 `78b23b7`이다.

| 모드 | before p95(ms) | after p95(ms) | faster 쌍 |
| --- | ---: | ---: | ---: |
| same-length | 44.02 | 12.09 | 100/100 |
| variable-length | 152.23 | 83.73 | 99/100 |
| cold | 92.41 | 92.58 | 10/20 |

cold는 after 최대 1011.08ms의 outlier 1건을 포함하고 p95는 사실상 그대로다.

## 종단 간 편집 run

[../benchmarks/results/json-leaf-final-edit-2026-10-11.json](../benchmarks/results/json-leaf-final-edit-2026-10-11.json)는 source `1ab93d5`, 측정 25·warmup 5·calibrations 10, typegen ON의 save→HTTP DOM ack run이다.

| 시나리오 | p50(ms) | p95(ms) | 100ms 이내 |
| --- | ---: | ---: | ---: |
| small 1k×3 | 16.31 | 80.12 | 25/25 |
| large 10k×20 | 67.36 | 95.25 | 24/25 |

large p95는 목표 100ms 안이고 최대는 124.11ms다. 두 시나리오 모두 patch 25회만 반영했고 full 응답은 0회이며 `.d.ts`는 다시 쓰지 않았다. 편집 벤치마크가 검사하는 입력 노드·값과 컴포넌트 state도 보존됐다. single run이라 편집 목표의 안정 달성은 주장하지 않는다.

## 로케일 추가 run

[../benchmarks/results/json-leaf-final-locale-add-2026-10-11.json](../benchmarks/results/json-leaf-final-locale-add-2026-10-11.json)는 같은 옵션의 list save→ack run이다.

| 시나리오 | p50(ms) | p95(ms) | 250ms 이내 |
| --- | ---: | ---: | ---: |
| small 1k×3 | 83.23 | 135.22 | 25/25 |
| large 10k×20 | 196.64 | 268.58 | 23/25 |

large는 250ms 목표에 미달이다.

## 복구·브라우저 프로브

- fresh Vite SSR 복구 5개 케이스가 모두 `recovered: true`다([../benchmarks/results/json-leaf-recovery-2026-10-11.json](../benchmarks/results/json-leaf-recovery-2026-10-11.json)).
- 얇은 계층 브라우저 스모크는 `--gap-ms 0` 8개 시나리오 PASS다([../benchmarks/results/json-leaf-browser-2026-10-11.json](../benchmarks/results/json-leaf-browser-2026-10-11.json)). 이 프로브는 프로토타입 비교 범위이므로 Saylo adapter 전반 검증으로 확장하지 않는다.

## 검증 범위

현행 `npm run check` PASS 기록은 모든 build, workspace test, 소비자 typecheck, React typecheck, scripts와 Vite 테스트 94개를 포함한다. `parser-probe`도 1 PASS다. 본체 source API와 의존성 버전은 그대로이고 로컬 커밋만 했으며 push·publish는 없다. 원시 결과는 `9743a38`에 함께 커밋됐다.

## 남은 작업

원래 목표는 아직 닫히지 않았다. 로케일 추가 성능, 얇은 계층 전체 평가, 릴리스 선택이 남아 있다. 이 문서는 완료 판정이 아니다. 시점이 다른 `json-leaf-edit`(large p95 87.04ms)·`json-leaf-compact-edit`(large p95 117.61ms)는 역사 기록으로 남기고 위 최신 run을 우선한다.

## 원본과 재현

```sh
npm run build
node benchmarks/live-update/json-leaf-compare.mjs
node benchmarks/live-update/run.mjs --scenario all --mode edit --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/json-leaf-final-edit-2026-10-11.json
node benchmarks/live-update/run.mjs --scenario all --mode locale-add --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/json-leaf-final-locale-add-2026-10-11.json
node benchmarks/thin-layer/rapid-recovery.mjs --assert-recovered --out benchmarks/results/json-leaf-recovery-2026-10-11.json
node benchmarks/thin-layer/browser-smoke.mjs --gap-ms 0 --out benchmarks/results/json-leaf-browser-2026-10-11.json
```
