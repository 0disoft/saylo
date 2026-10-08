# 36. AST 동결 seal 공유 이후 large locale-add 재측정

## 목적

[35](35-shared-ast-seal.md)가 `freezeMessageAst` 내부 `seal`을 모듈 범위로 옮긴 뒤, 상세 계측을 끈 상태로 large locale-add를 다시 측정해 실제 언어 목록 250ms 목표의 충족 여부를 확인한다. 제품과 하네스 코드는 이번에 변경하지 않았다.

## 실행

```sh
node benchmarks/live-update/run.mjs --mode locale-add --scenario 10k-20-locales --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/locale-add-shared-ast-seal.json
```

- revision `28d7fe5a22e1d578a392cec21bc7e3ab6cf14f1d`, measuredAt `2026-10-08T08:33:04.988Z`
- 상세 계측 CPU profile·browser·server-file·reply·client: 모두 OFF
- 기본 prebundle·typegen: ON, `declarationRewritten` false
- 규모: large(10k×20) 1개, raw 55(5 warm + 50 measured), control 25
- Node 24.18.0, Vite 8.3.2, React 19.3.0, Windows x64, Ryzen 5 7430U, HeadlessChrome 154
- 서버 startup 3450.56ms, 브라우저 boot 4986.78ms

## 입력 규모

메시지 10,000개 × 로케일 20개, namespace 1개다. 초기 카탈로그 20파일 7,755,280B이고 회차마다 en-GB 파일 1개·메시지 10,000개를 추가하며 추가 카탈로그는 387,783B다.

## 결과

단위는 ms다. 저장→목록/번역 ack는 Node 파일 쓰기 완료부터 DOM 확인 ack 수신까지이며 ack 전달 비용을 포함한다. 선택 준비→번역 ack와 저장→broadcast도 Node clock이고, Browser 선택→commit은 `setLocale` 직전부터 번역 DOM을 확인한 `useLayoutEffect`까지다.

| 지표 | p50 | p95 |
| --- | --- | --- |
| 목록 saveToListAck | 291.47 | 767.54 |
| Node 선택준비→번역 ack | 246.76 | 602.00 |
| Node 저장→번역 ack | 554.72 | 1156.26 |
| Browser 선택→commit | 243.50 | 598.10 |
| Node 저장→broadcast | 270.31 | 739.49 |
| fileWrite | 20.80 | 78.85 |
| control | 3.88 | 5.17 |

목록 p95 767.54ms는 250ms 목표를 넘어 미달이고 목록 250ms 이내는 50회 중 11회다. 표본별 `saveToListAckMs - saveToBroadcastMs`(같은 Node clock의 broadcast→목록 ack 잔여)는 p50 21.47ms·p95 42.50ms이고, 50/50회 저장→broadcast 구간이 뒤 구간보다 컸다. 50회 p95는 정렬 48번째 값이며 중첩 p95를 더하지 않고 control·GC를 차감하지 않으며 Node·Browser clock을 섞지 않는다.

## 해석과 한계

목록 p95가 직전 상세 계측 OFF 재측정 [31](31-prebundle-freeze-locale-add.md)의 large 268.54ms보다 크게 관측됐고 p50도 189.62→291.47ms로 커졌다. 두 run은 시점이 다르고 단일 장비에서 순차 실행했으며 부하와 GC를 통제하지 않았다. 목록 표본은 최소 154.94ms·최대 2389.88ms로 편차가 크다. 상세 계측을 껐으므로 이 차이를 파싱·GC 또는 `seal` 모듈화의 효과·퇴행으로 확정하지 않는다. 한 run이라 감소 효과를 확인하지 못했고, 이 값 하나로 [35](35-shared-ast-seal.md) 제품 변경을 되돌리거나 추가 최적화를 적용하지 않는다.

## 검증

55 raw(5 warm + 50 measured)·control 25에서 원시 수, 토큰 고유성, 옵션, 시간 유한성, Node 경계, 바이트, 요약, 모든 hash를 대조하고 임시 fixture와 benchmark Chrome 프로세스 정리까지 확인했다. 55 raw 모두 선택 전 응답 0회·선택 후 `saylo-catalog-v1` compact full 1회였고 `.d.ts`는 다시 쓰이지 않았다. en 복귀·파일 삭제와 입력 노드값·React state 보존, reload 없음도 하네스가 확인했다. 이전 31 run과 공통 hash 36개 중 `packages/core/dist/diagnostics.js` 하나만 다르고 core 5개 hash는 [35](35-shared-ast-seal.md) parse-compare와 모두 같다. 독립 원시 대조는 [locale-add-shared-ast-seal-analysis.json](../benchmarks/results/locale-add-shared-ast-seal-analysis.json)에 있다. 제품·하네스 변경이 없어 build·테스트·타입 검사·pack·release는 재실행하지 않았다. push·publish·deploy도 없다.

문서 표를 결과 JSON과 대조했다. 변경한 Markdown 다섯 파일의 로컬 링크 162개·코드 fence·40KB 제한과 `git diff --check`가 통과했다.

## 다음 작업

변경 전후를 가까운 시점의 같은 조건으로 직접 대조해 `seal` 모듈화가 종단 간 퇴행인지 확인하는 비교 측정이다. 현재 노이즈의 원인은 확정하지 않고 실효성 미확인으로 둔다.

## 링크

- [locale-add-shared-ast-seal.json](../benchmarks/results/locale-add-shared-ast-seal.json)
- [locale-add-shared-ast-seal.10k-20-locales.samples.json](../benchmarks/results/locale-add-shared-ast-seal.10k-20-locales.samples.json)
- [locale-add-shared-ast-seal-analysis.json](../benchmarks/results/locale-add-shared-ast-seal-analysis.json)

관련 문서: [31](31-prebundle-freeze-locale-add.md), [35](35-shared-ast-seal.md).
