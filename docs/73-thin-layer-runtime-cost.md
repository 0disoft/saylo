# 73. thin-layer 런타임 비용과 snapshot 보유 heap

## 범위

[72](72-thin-layer-sync-construction.md) 뒤에 benchmark 전용 동기 layer(`createLazyLayerSync`)와 제품 core `createI18n`을 같은 fixture에서 격리 측정한 기록이다. 측정 항목은 동기 생성 시간, 같은 폭 단일 메시지 편집 30회의 commit 시간, 1500회 hot read 시간, 각 강제 GC 시점의 heap이다.

확인한 것은 두 라이브러리의 Node 격리 비용이다. 종단 간 편집 100ms·로케일 250ms 목표와 브라우저 메모리·RSS·peak, Vite wire 디코딩, React·DOM, 모듈 로딩은 측정하지 않았다. 관측은 2026-10-11(KST)이고 Node v24.18.0이다.

## 코드

- 실행 코드: [runtime-cost-probe.mjs](../benchmarks/thin-layer/runtime-cost-probe.mjs) · layer 구현 [lazy-layer.mjs](../benchmarks/thin-layer/lazy-layer.mjs) · [lazy-source-cache.mjs](../benchmarks/thin-layer/lazy-source-cache.mjs) · [catalog-layer.mjs](../benchmarks/thin-layer/catalog-layer.mjs) · [ast-format.mjs](../benchmarks/thin-layer/ast-format.mjs)
- 실행 프로세스가 `--expose-gc` 자식 프로세스 8개를 순차 실행한다. key 1k·10k마다 `core, layer, layer, core` ABBA 순서다. layer 자식은 core에 없는 `getProbeStats()`로 resourceDictionaries·instances를 함께 보고한다.
- fixture는 namespace 1개, 로케일 2개(en base·ru target), 준비된 불변 catalog 2개다. 생성자 앞에서 base schema cache를 두 variant에 같게 warm up하고 untimed warm-up 1회를 둔다.
- 편집은 같은 폭으로 item0 메시지 하나를 교체한다. 메시지 parse·O(N) dictionary 복사·source 동결은 timing 밖이고, `refresh()`와 번역 단언 3개가 timed다.
- heap은 task·microtask를 drain하고 `globalThis.gc()`를 강제한 뒤 잡는다. 편집 30회 뒤 8개 옛 snapshot을 보유한 상태와 해제한 상태를 같은 최종 source version에서 비교한 값이 `retained`다.

## 관측 결과

| key | variant | commit p50 | commit p95 | steady heap delta | retained delta | hot read 1500회 | 생성 3회 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1k | core | 1.48ms | 2.25ms | 0.43~0.45MB | 0.55MB | 19.0·19.4ms | 2.02~2.88ms |
| 1k | layer | 4.18ms | 6.20ms | 0.75~0.76MB | 1.02~1.04MB | 39.1·39.4ms | 5.17~8.02ms |
| 10k | core | 13.01ms | 16.46ms | 2.18MB | 4.59~4.71MB | 18.6·19.4ms | 8.82~11.01ms |
| 10k | layer | 30.43ms | 40.50ms | 1.50MB | 7.72MB | 38.0·41.6ms | 33.86~51.76ms |

- commit p50·p95는 retained phase 8개를 뺀 60표본(core·layer 각 2 run × 30)이다. commit과 hot read는 같은 프로세스에서 `refresh()`·`t()` 경계로 잰 wall time이다.
- source 로드는 두 variant 모두 38회(= 30편집 + 8보유)다. layer 두 run의 stats는 resourceDictionaries 40·instances 39로 같다.
- heap delta는 자식마다 자기 `before` 기준 상대값이다. `before` 절대값은 1k에서 core 약 8.5MB·layer 약 8.8MB, 10k에서 core 약 23.4MB·layer 약 24.4MB다.

## 해석과 한계

- 같은 조건에서 layer가 더 느리다. commit p50은 1k 4.18 대 1.48ms(약 2.8배), 10k 30.43 대 13.01ms(약 2.3배)이고 hot read 1500회와 생성 시간도 layer가 크다. layer는 benchmark 전용 프로토타입이고 제품 진입 경로가 아니다.
- 보유 snapshot 메모리 증가는 layer가 더 크다. 8개 보유 delta는 1k 1.02~1.04 대 0.55MB, 10k 7.72 대 4.59~4.71MB다.
- live steady delta는 크기마다 방향이 다르다. 10k는 layer 1.50MB가 core 2.18MB보다 낮고, 1k는 layer 0.75~0.76MB가 core 0.43~0.45MB보다 높다. 그래서 "layer는 항상 메모리를 더 쓴다"고 일반화하지 않는다.
- heap delta는 library-only byte가 아니다. 두 variant의 절대 baseline이 다르고 입력 그래프도 계속 변한다. 누수·광범위 scale·production 크기 판정이 아니다.
- ABBA 순서는 관측 설계다. 기계 scheduler·JIT·다른 프로세스 부하가 run마다 같다는 주장이 아니고, p50·p95 차이를 원인 귀속에 쓰지 않는다.

## 원본과 재현

원본은 [thin-layer-runtime-cost-2026-10-11.json](../benchmarks/results/thin-layer-runtime-cost-2026-10-11.json)이다. `summaries`가 위 표이고 `observations` 8개가 자식 run별 원자료다. raw의 `codeHashes` 12개는 관측 시점 파일과 일치하는 것을 확인했다. 그 뒤 제품 source가 바뀌면 hash는 다시 달라진다.

```powershell
node benchmarks/thin-layer/runtime-cost-probe.mjs --iterations 30 --out benchmarks/results/thin-layer-runtime-cost-2026-10-11.json
```

benchmark workspace script `probe:runtime-cost`는 같은 probe를 기본 `out`(current 파일)으로 돌린다.

## 상태

코드·원시 결과는 로컬 커밋 `6979c84`에 있고 미푸시다. 제품 package·공개 API·버전은 바뀌지 않았고 이 측정은 아키텍처 교체나 성능 채택을 결정하지 않는다. 이 문서는 `6979c84` 시점의 역사 baseline이고, 그 뒤 제품 source 변경에 따른 재측정은 다음 문서에서 다룬다.

## 후속: 불변 검증 재사용 (`5586bf2`)

이 baseline 뒤 재측정과 검증 재사용 변경은 [74](74-immutable-validation-reuse.md)에 있다. 74가 재는 `packages/core/dist/schema.js` hash는 이 문서의 baseline과 다르다.
