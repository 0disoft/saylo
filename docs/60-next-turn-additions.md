# 60. 새 카탈로그의 대기창 제거

## 범위

`32e120c`에서 `packages/vite`의 `LiveRegistry.enqueueAdded(file)`가 desired·accepted에 없는 새 경로만 `readFile`로 enqueue해 0ms 타이머로 다음 이벤트 루프 턴에 읽기를 예약한다. 경로 검사·stat·파일 읽기·파싱에 드는 시간은 남는다.

- 기존 경로 add·교체, unlink, pending `settleDisk: true`는 기존 40ms quiet window를 유지한다.
- ENOENT는 기존 40ms 재시도, 첫 게시 뒤 60ms 꼬리 metadata 재확인도 그대로 둔다.
- 원래 large 로케일 추가 목표는 250ms다.
- 본체 API·의존성·버전은 그대로이고 push·publish는 없다.

## 서버 파일 구간

[서버 파일 구간 원본](../benchmarks/results/locale-add-json-leaf-stages-2026-10-11.json)은 source `6927064` 기준 기록이다.

- queue p50 49.94ms·p95 54.05ms.
- 파일 구간 10개 중 catalogParse가 10/10회 최대이고 최대 302.30ms다.

## 최초 로딩 파서 최적화 trial 원복

cold 비교에서 이득을 확인하지 못해 두 건 모두 원복했다.

| trial | 파일 | p50 before→after | p95 before→after | faster |
| --- | --- | --- | --- | --- |
| argument-node-pool | [원본](../benchmarks/results/argument-node-pool-cold-compare-2026-10-11.json) | 77.55→88.26ms | 117.49→133.63ms | 4/20 |
| lazy-parser-diagnostics | [원본](../benchmarks/results/lazy-parser-diagnostics-cold-compare-2026-10-11.json) | 64.46→73.85ms | 133.46→152.34ms | 5/20 |

패치(`*-trial-2026-10-11.patch`)와 원시 자료는 `19dab47`에 보존했고 현재 core는 `6927064`와 동일하다. 메모리 사용량은 정량 측정하지 않았다. 최초 로딩 파서 최적화 trial들은 제거됐으므로 최초 파싱 개선을 주장하지 않는다. 채택한 source는 `32e120c` 하나다.

## 종단 간 단일 run

[로케일 추가 원본](../benchmarks/results/next-turn-locale-add-2026-10-11.json)은 sample 25·warmup 5·calibration 10, typegen ON 조건이다.

| 조건 | p50 | p95 | 목표 이내 |
| --- | --- | --- | --- |
| small 1k×3 | 72.27ms | 91.62ms | 25/25 |
| large 10k×20 | 135.88ms | 189.30ms | 24/25 |

large는 최대 402.11ms 1건이라 tail 안정을 주장하지 않는다. 한 run 성공이지 안정 달성이나 인과 증명이 아니며, 이 기록은 single current 조건의 통과이고 다른 환경을 보장하지 않는다.

## 검증과 테스트

- `npm run check` PASS(`32e120c`): 전체 build·workspace test, core 81·React 14·Svelte 14·typegen 9·Vite 95·script 5, 소비 타입 검사.
- 추가 tests-only로 malformed 신규 파일 복구를 확인한 뒤 `node --test packages/vite/test/plugin.test.mjs` 43 PASS.
- full root check와 별도 plugin 43이며 Vite 96개 full suite는 다시 돌리지 않았다.
- 새 경로에는 별도 40ms 대기창 없이 읽기를 예약하고, 유효하지 않은 신규 JSON 뒤 유효 쓰기가 watcher event 없이 와도 60ms recheck로 복구한다.
- 기존 40ms atomic·paired namespace 수렴은 계속 PASS다.
- 이 기능은 Saylo 실제 Vite 새 파일 경로다.

## 재현

```sh
npm run build
node benchmarks/live-update/run.mjs --scenario all --mode locale-add --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/next-turn-locale-add-2026-10-11.json
```

## 비교 환경

브라우저 ABBA 비교는 `packages/vite/src/index.ts`·`live-registry.ts` 두 소스만 스냅샷에서 치환한다. baseline은 `6927064`, current는 `32e120c`다. 매 run은 fresh Vite·브라우저, 측정 25·warmup 5·control 10이고 typegen을 켠다. 표본을 짝지은 비교가 아니며 실행 순서는 before/after/after/before다.

상세 계측 ABBA는 before 1 run 뒤 after 2 run에서 `finishFileSample`의 `exactly 1` path check·read·parse assertion으로 exit 1이 났다(`next-turn-locale-add-stages-failure-2026-10-11.json`, 완료된 before run은 `next-turn-locale-add-compare-2026-10-11.1-before.json`). 호출 수가 출력되지 않아 원인을 확정하지 못했고 after·pooled 결과는 없다. 파싱 1회 조건은 임의로 완화하지 않았다. 상세 계측을 끈 별도 [교차 비교](../benchmarks/results/next-turn-locale-add-comparison-2026-10-11.json)는 완료했다. 이 비교는 로케일 목록 반영 시간을 검증하며 파일 구간의 원인은 확정하지 않는다.

## 교차 측정 결과

| 지표 | before 50개 | after 50개 |
| --- | ---: | ---: |
| 목록 p50(ms) | 214.09 | 150.97 |
| 목록 p95(ms) | 417.47 | 642.02 |
| 250ms 이내 | 31/50 | 40/50 |
| 목록 최대(ms) | 1042.45 | 2499.83 |
| control 왕복 p95(ms) | 17.29 | 33.27 |
| 파일 쓰기 p95(ms) | 54.90 | 104.35 |

run p95는 before 427.52·241.77ms, after 642.02·463.31ms다. 중앙값과 목표 이내 표본은 개선됐으나 p95·최대는 커졌고 로케일 목표는 미달이다. 파일 쓰기는 비동기 쓰기 완료 콜백을 기다리는 시간이며 순수 디스크 시간으로 해석하지 않는다. control·파일 쓰기 시간도 달라졌으므로 코드의 tail 퇴행이나 전체 성능 개선을 단정하지 않는다. `32e120c`의 성능 채택은 잠정 상태로 두며, 단일 run 189.30ms를 안정 달성의 근거로 사용하지 않는다.

fresh Vite SSR [복구 5개](../benchmarks/results/next-turn-additions-recovery-2026-10-11.json)가 모두 `recovered: true`이고, 무간격 [얇은 계층 브라우저 스모크 8개](../benchmarks/results/next-turn-additions-browser-2026-10-11.json)가 PASS다. 후자는 프로토타입 비교 범위이며 전체 어댑터 검증으로 확대하지 않는다. current 단일 run의 코드 hash·표본 집계, 교차 비교 pooled 표본 재계산, 두 프로브의 hash를 확인했다.

```sh
node benchmarks/live-update/locale-compare.mjs --baseline 6927064 --current 32e120c --experiment fast-additions --mode locale-add --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/next-turn-locale-add-comparison-2026-10-11.json
```

## 남은 작업

상세 계측의 다중 읽기 한계·긴 표본 원인 확인과 대기창 제거의 채택 판단, owned-map 잠정 채택 결정, 얇은 계층 전체 비교, 미게시 변경 릴리스 결정이 남아 있다. 장기 목표의 완료를 주장하지 않는다.
