# 37. seal 공유 전후 locale-add 격리 비교

## 목적

[35](35-shared-ast-seal.md)가 `freezeMessageAst` 내부 `seal`을 모듈 범위로 옮긴 뒤, [36](36-shared-ast-seal-locale-add.md)의 상세 계측 OFF large 재측정에서 목록 표시 p95가 767.54ms로 커졌다. 36은 시점이 다른 단일 run이라 이 차이를 `seal` 모듈화의 이득이나 퇴행으로 확정하지 못했다. 이번에는 변경 전 `cbd6871`과 공유 헬퍼 실험 `4f6b5cd`를 가까운 시점·같은 조건의 격리 스냅샷으로 순차 실행해 대조하고 `seal` 공유가 종단 간 로케일 추가에서 이득이 있는지 확인한다. 비교 도구 `benchmarks/live-update/locale-compare.mjs`를 새로 추가했다.

## 실행

```sh
node benchmarks/live-update/locale-compare.mjs --baseline cbd6871 --current 4f6b5cd --out benchmarks/results/locale-add-seal-comparison.json
```

최종 도구의 기본값은 `--baseline cbd6871`·`--current 28d7fe5`·`--samples 25`·`--warmup 5`·`--calibrations 10`이다. `28d7fe5`와 실측의 `4f6b5cd`는 제품 소스가 같다. 위 재현 명령은 실측 ref를 명시한다. 이 비교 뒤 제품은 원복되어 현재 core source는 `cbd6871` 상태이고 `4f6b5cd`는 이전 실험 ref다. 2026-10-08(KST) Node 24.18.0, Windows x64, Ryzen 5 7430U, Vite 8.3.2에서 실행했다.

- 순서는 before/after/after/before(AB/BA 블록)이고 회차마다 fresh Vite·browser·임시 fixture를 만든다.
- run당 large(10k×20, namespace 1) 1개에 measured 25 + warm 5 + control 10이다. 네 run을 합쳐 raw 120, measured 100, control 40이다.
- 상세 계측 CPU profile·browser·server-file·reply·client는 모두 OFF, 기본 prebundle·typegen은 ON이고 `declarationRewritten`은 false다.
- 회차마다 en-GB 파일 1개·메시지 10,000개를 추가한다. 초기 카탈로그 20파일 7,755,280B, 추가 카탈로그 387,783B다. compact full 응답의 직렬화 JSON 크기는 각 run 결과에 기록하며 실제 네트워크 바이트는 아니다.

## 조건과 경계

- 도구는 두 ref의 `packages` diff가 `packages/core/src/diagnostics.ts` 하나인지, checkout의 packages 작업 트리가 clean인지 검사한다.
- `benchmarks/.live-update-compare-*/` 아래 before/after 스냅샷을 만든다. `package.json`·`package-lock.json`을 복사하고 외부 의존 node_modules는 junction으로 공유하되 `@0disoft/saylo-*` alias는 각 스냅샷의 패키지를 가리킨다. core `src`와 `tsconfig.json`을 복사한 뒤 각 ref의 `diagnostics.ts`로 교체하고 같은 tsc로 빌드하며, 하네스 mjs·jsx·html을 복사한다. 따라서 원래 checkout의 제품 source·dist는 바뀌지 않고 두 스냅샷은 `diagnostics.ts`만 다르다.
- 도구는 common codeHash 36개에서 before run은 서로 같고 after run은 `packages/core/dist/diagnostics.js` 하나만 다른지 검사한다. 명시 역사 ref로 checkout이 원복된 뒤에도 두 스냅샷을 다시 만들 수 있게 guard를 두었고, 원복 뒤 같은 명령이 다시 실행되는 것을 확인했다. 수집기 `run.mjs` 코드는 바꾸지 않았다.
- 풀링은 variant별 measured 50개를 원시값 그대로 모아 nearest-rank quantile로 요약한 값이다. run p95의 평균이 아니다. warm 10개는 제외하고 control 20개는 따로 요약한다.
- 저장→목록/번역 ack는 Node 파일 쓰기 완료부터 ack 수신까지이고 ack 전달 비용을 포함한다. Browser 선택→commit은 `setLocale` 직전부터 번역 DOM을 확인한 `useLayoutEffect`까지다. 프로세스 시계는 서로 빼지 않고 GC·control을 차감하지 않으며 중첩 p95를 더하지 않는다.
- 표본별 paired 비교나 무작위 배정이 아니고 고정 순서 단일 장비이며 GC·부하를 통제하지 않아 인과 증명이 아니다. 스냅샷 구조와 기본 prebundle이 일반 checkout과 path·모듈 위치가 달라 36의 767.54ms와 직접 성능 비교하지 않는다.
- 네 run 결과 JSON의 `gitRevision`은 상위 harness checkout인 `4f6b5cd`를 가리킨다. 실제 측정 대상은 `snapshotSourceRevision`과 `snapshotVariant`로 구분하며 before는 `cbd6871`, after는 `4f6b5cd`다.

## 결과

단위는 ms이고 pooled measured 50개 기준이다.

| 지표 | before p50 | before p95 | after p50 | after p95 |
| --- | --- | --- | --- | --- |
| 목록 saveToListAck | 208.81 | 547.74 | 252.49 | 682.94 |
| Node 선택준비→번역 ack | 185.81 | 320.33 | 216.18 | 296.96 |
| Node 저장→번역 ack | 396.51 | 818.26 | 477.54 | 901.37 |
| Browser 선택→commit | 183.00 | 236.40 | 212.60 | 293.50 |
| Node 저장→broadcast | 190.58 | 516.74 | 233.94 | 665.45 |
| fileWrite | 11.08 | 17.10 | 12.14 | 18.66 |
| control | 4.04 | 5.98 | 3.73 | 5.60 |

목록 250ms 이내는 before 38/50, after 23/50이다. 두 variant 모두 목록 250ms 목표는 미달이다.

run별 목록 표시값은 다음과 같다.

| run | variant | 측정시각(UTC) | 목록 p50 | 목록 p95 |
| --- | --- | --- | --- | --- |
| 1 | before | 2026-10-08T10:54:27Z | 217.52 | 595.13 |
| 2 | after | 2026-10-08T10:55:07Z | 252.89 | 682.94 |
| 3 | after | 2026-10-08T10:55:49Z | 246.72 | 543.92 |
| 4 | before | 2026-10-08T10:56:27Z | 199.75 | 524.96 |

두 블록 모두 after 목록 p50·p95가 before보다 크다. pooled 목록도 같은 방향이다. Browser 선택→commit p95는 before 236.40ms·after 293.50ms로 after가 크고, Node 선택준비→번역 ack p95는 before 320.33ms·after 296.96ms로 before가 커 지표별로는 엇갈린다.

## 해석과 결정

`seal` 공유의 이득을 목록 표시에서 확인하지 못했고 두 블록 모두 after 목록 p50·p95가 크게 관측됐다. 지표별로는 엇갈리고 표본별 paired가 아니므로 코드 퇴행의 인과를 확정하지 않는다. 성능 최적화로 유지할 근거가 부족해 35의 `seal` 공유 제품 변경을원복했다. `packages/core/src/diagnostics.ts`의 `seal`은 다시 `freezeMessageAst` 내부 함수이며 core 제품 소스는 `cbd6871` 상태다.

이 비교의 pooled before 목록 p95 547.74ms는 원복 대상 격리 비교 값이고 현행 일반 단일 run의 최신 p95가 아니다. 36의 단일 after 767.54ms와도 조건·스냅샷·run 형태가 달라 직접 비교하지 않는다.

## 검증

추가한 도구의 스모크는 `--smoke`로 small(1k-3-locales) before/after 각 1회와 control 1회를 돌리고 두 ref의 `diagnostics.js` hash 차이, 입력 폼 상태·`.d.ts` 유지, 임시 fixture 정리를 확인했다. 본 비교의 네 run은 도구가 instrumentation OFF·typegen ON·`declarationRewritten` false, 선택 전 응답 0회·선택 후 `saylo-catalog-v1` compact full 1회, 표본별 Node 경계 부등식, 요약 재계산, codeHash 차이 규칙, 임시 스냅샷 정리를 검사했다.

원복 뒤 core build, core 테스트 75개, consumer JS/TS 타입 검사를 통과했고 최종 core `diagnostics` dist SHA가 이 비교의 before와 같다. 네 run 120 raw, pooled measured 100, control 40에서 표본 수·토큰 고유성·warmup 위치·옵션·Node 타이밍 경계·요약·풀링·frame 바이트·wire JSON 바이트 요약·common hash 36개(단 `packages/core/dist/diagnostics.js` 하나만 variant 차이)·임시 스냅샷 정리를 독립 대조했다. 제품 원복은 커밋 `d408500`으로 마무리했고, 원복 뒤 `node benchmarks/live-update/locale-compare.mjs --baseline cbd6871 --current 4f6b5cd --smoke`가 before/after 각 1회 small 표본으로 통과해 과거 제품 스코프 재현 명령 지원을 확인했다. 이 스모크는 성능 주장에 쓰지 않는다. `node --check`도 통과했다. workspace 전체 검사·pack·release는 재실행하지 않았고 공개 API·버전·push·publish·deploy는 없다.

문서의 pooled·run 표를 결과 JSON과 대조했다. 변경한 Markdown 다섯 파일의 로컬 링크 171개·코드 fence·40KB 제한과 `git diff --check`가 통과했다.

## 다음 작업

대규모 목록 목표는 여전히 미달이고 두 variant 모두 충족하지 못하므로 구조적 병목 개선이 필요하다. 이번 비교로 다음 최적화 후보를 확정하지 않는다.

## 링크

- [pooled 비교](../benchmarks/results/locale-add-seal-comparison.json)
- [1 before](../benchmarks/results/locale-add-seal-comparison.1-before.json)·[표본](../benchmarks/results/locale-add-seal-comparison.1-before.10k-20-locales.samples.json)
- [2 after](../benchmarks/results/locale-add-seal-comparison.2-after.json)·[표본](../benchmarks/results/locale-add-seal-comparison.2-after.10k-20-locales.samples.json)
- [3 after](../benchmarks/results/locale-add-seal-comparison.3-after.json)·[표본](../benchmarks/results/locale-add-seal-comparison.3-after.10k-20-locales.samples.json)
- [4 before](../benchmarks/results/locale-add-seal-comparison.4-before.json)·[표본](../benchmarks/results/locale-add-seal-comparison.4-before.10k-20-locales.samples.json)

관련 문서: [35](35-shared-ast-seal.md), [36](36-shared-ast-seal-locale-add.md).
