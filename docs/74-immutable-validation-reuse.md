# 74. 불변 검증 재사용 (`5586bf2`)

## 범위

[73](73-thin-layer-runtime-cost.md) 뒤에 core `validateTranslation`이 이미 통과시킨 불변 schema·catalog pair를 다시 검사하지 않도록 바꾼 기록이다. 제품 source 변경은 `packages/core/src/schema.ts` 하나다.

확인한 것은 이 변경의 계약과 검증 통과 상태, 최신 조건 스모크 측정이다. 종단 간 목표의 장기 안정, 아키텍처 교체, 남은 작업 완료는 주장하지 않는다. 관측은 2026-10-11(KST)이고 Node v24.18.0·Vite 8.3.2·headless Chromium이다.

## 코드

- `validatedCatalogs = new WeakMap<CatalogSchema, WeakSet<ParsedCatalog>>()`를 두고 `validateTranslation` 진입부에서 `isDeepFrozen(base)`·`isDeepFrozen(translation)`이 모두 참이고 그 identity pair가 이미 수용된 경우에만 즉시 반환한다.
- 전체 검증을 끝까지 통과한 뒤에만 pair를 기록한다. mutable·shallow frozen 입력은 캐시하지 않고 매번 검사하며, 새 불변 identity는 먼저 검사한 뒤 성공하면 기록한다. 기존 per-argument `validatedArguments` WeakMap은 그대로 둔다. weak 참조라 snapshot을 붙잡지 않는다.
- 공개 API·의존성·버전은 그대로다. 이 변경과 테스트는 로컬 커밋 `5586bf2`(미푸시)이다.

## 검증

부모가 돌린 결과는 core 82·Vite 101·typegen 9(합 192)에 thin-layer contracts 64를 더해 256 PASS이고 core build·consumer typecheck도 PASS다. 이 문서 작성자는 테스트를 재실행하지 않았다.

## 관측 결과

### 격리 런타임 비용

[73](73-thin-layer-runtime-cost.md)과 같은 probe를 `5586bf2`에서 다시 돌렸다. 자식 8개 × 38 commit = 304 commit이고 worker마다 옛 snapshot 8개를 검증해 합계 64개다.

| key | variant | commit p50 73→74 | commit p95 73→74 | steady heap | retained heap |
| --- | --- | --- | --- | --- | --- |
| 1k | core | 1.48→1.51ms | 2.25→2.41ms | 0.48MB | 0.52~0.55MB |
| 1k | layer | 4.18→3.43ms | 6.20→5.17ms | 0.79~0.80MB | 1.01MB |
| 10k | core | 13.01→14.55ms | 16.46→23.49ms | 2.19MB | 4.35~4.57MB |
| 10k | layer | 30.43→23.23ms | 40.50→34.24ms | 1.49~1.52MB | 7.70~7.72MB |

- 두 raw는 시각 간격이 있어 같은 시점의 paired ABBA가 아니다. 10k core p95는 16.46→23.49ms로 올랐고 layer는 40.50→34.24ms로 내렸다. 그래서 "모두 빨라졌다"고 결론내지 않는다. heap delta는 73과 비슷한 범위이고 크기별 방향도 같다.

### CPU 표본 (`ad7b55e`)

- full-worker 1ms 표본이고 imports·fixture parse·생성자 warm-up·copy/freeze·refresh·단언·보유 snapshot·GC·idle을 포함한다. count와 timeDelta는 정확한 함수 CPU 시간이 아니다.
- core 1454표본 중 `validateTranslation` self 270(18.6%)·inclusive 274, layer 2205표본 중 self 522(23.7%)·inclusive 529다. 참고 표본으로만 쓰고 원인이나 CPU 시간 귀속에 쓰지 않는다.
- 이 profile의 `packages/core/dist/schema.js` hash는 변경 전(baseline) 파일이다.

### 종단 간 스모크

- large 편집(10k×20 locales, 단일 키) 25표본 × 2 run은 saveToAck p95 70.35ms·61.91ms, pooled 66.16ms로 100ms 이내 49/50이다(첫 run 최대 100.54ms).
- small 편집(1k×3) 25표본은 p95 108.61ms로 100ms 목표에 미달한다(23/25). 느린 두 표본은 108.61·183.96ms이고 receiveToCommit 3.8·3.6ms, queueToDrain 16.04·19.56ms, candidate interval 28.23·107.97ms다. 원인은 확정하지 않는다.
- 시계는 Node `performance.now`이고 file write resolved → DOM commit ack body received다. HTTP ack 비용을 포함하고 control 왕복은 따로 보고하며 stage p95에 더하거나 빼지 않는다.
- 편집 fixture가 보는 상태는 input node identity·value, React component state, 정확한 DOM 문구와 wire receipt다. focus·caret·modal 전반 검사는 아니다.
- locale-add small(1k×3) 목록 p95 84.29ms(250ms 이내 25/25)이고 selectToTranslationAck p95 32.33ms다. large(10k×20) 목록은 run1 137.09ms(24/25)·run2 159.75ms(25/25)이고 50표본 pooled p95 159.75ms로 250ms 이내 49/50이다. large selectToTranslationAck p95는 267.80·262.38ms로 목록 수치와 별개다.

## 해석과 한계

- 재사용은 깊게 동결된 identity pair에만 적용된다. 새 identity·mutable·shallow 입력은 기존 경로로 재검사한다.
- 검증 통과는 이 변경의 gate이고 위 수치는 제한된 조건의 측정이다. small 편집이 목표에 미달하므로 편집 목표 전체 충족이나 안정 달성을 주장하지 않는다.
- 격리 런타임 비용 raw와 73은 같은 시점 쌍 비교가 아니고, CPU 표본은 변경 전 source의 참고 자료다.
- 후속 browser raw 네 개의 `codeHashes` 152개(37·37·39·39)와 after runtime raw 12개·lazy contracts raw 13개가 현재 파일과 일치함을 확인했다.

## 원본과 재현

- 격리 런타임 비용 [thin-layer-runtime-cost-validation-cache-2026-10-11.json](../benchmarks/results/thin-layer-runtime-cost-validation-cache-2026-10-11.json)
- CPU 표본 [thin-layer-runtime-cpu-2026-10-11.json](../benchmarks/results/thin-layer-runtime-cpu-2026-10-11.json)(core·layer cpuprofile 포함)
- 편집 [large](../benchmarks/results/validation-cache-edit-large-2026-10-11.json)·[large-repeat](../benchmarks/results/validation-cache-edit-large-repeat-2026-10-11.json)·[small](../benchmarks/results/validation-cache-edit-small-2026-10-11.json), 로케일 [add](../benchmarks/results/validation-cache-locale-add-2026-10-11.json)·[add-large-repeat](../benchmarks/results/validation-cache-locale-add-large-repeat-2026-10-11.json)
- 두 large 편집 raw의 `gitRevision`은 `ad7b55e`(당시 HEAD, `schema.ts` 수정 중 작업 트리)이고 그 raw의 `schema.js` hash는 `5586bf2` 시점 파일과 같다. small 편집·large locale 반복은 `c5bfabc`, 첫 locale 측정은 `5586bf2`를 기록하며 측정한 제품 코드는 같다.

```powershell
npm run build
node benchmarks/live-update/run.mjs --mode edit --scenario 10k-20-locales --samples 25 --calibrations 10 --out benchmarks/results/validation-cache-edit-large-repeat-2026-10-11.json
node benchmarks/live-update/run.mjs --mode locale-add --scenario 10k-20-locales --samples 25 --calibrations 10 --out benchmarks/results/validation-cache-locale-add-large-repeat-2026-10-11.json
node benchmarks/thin-layer/runtime-cost-probe.mjs --iterations 30 --out benchmarks/results/thin-layer-runtime-cost-validation-cache-2026-10-11.json
```

## 상태

제품 source 변경은 `5586bf2`에 있고 공개 API·의존성·버전은 그대로다. CPU raw는 `ad7b55e`, after runtime·lazy contracts raw는 `5586bf2`, repeat·locale·small raw는 `9093d46`에 있다. 모두 미푸시이고 원격 반영은 없다.
