# 29. 기본 prebundle의 client 수신 이후·publication·commit 계측

[28](28-full-reply-stages.md)에 이어 client 내부 경계를 나눴다. 정상 prebundle을 유지한 대규모 50회에서 수신→첫 store publication→DOM commit을 분리했다. 같은 Vite 동결 카탈로그 참조가 core 수락에 50/50 전달됐지만 core의 깊은 동결 신뢰는 0/50이었다. source·dist는 바꾸지 않았다.

## 구현과 경계

- `--client-stages`는 locale-add 전용이고 `--reply-stages`를 요구한다. `optimizeDeps.include`는 원래 목록(`react`, `react-dom/client`, `@0disoft/saylo-core`, `@0disoft/saylo-react`) 그대로이고 optimizer `rolldownOptions`에 benchmark transform만 더한다.
- 같은 transform을 Vite plugin과 optimizer rolldown plugin 두 경로에 붙인다. optimizer 내부 계측 변환이 적용된 파일은 `packages/core/dist/loading-registry.js`와 `packages/core/dist/translator.js`이다. 이 목록은 계측이 붙은 파일이고 전체 번들 모듈 목록이 아니다.
- helper 상태는 `Symbol.for('saylo.benchmark.client-stages')` 전역 키로 benchmark 안에서만 공유하며 제품 freeze cache를 바꾸지 않는다.
- 신뢰 관측은 Vite `freezeCatalogs` 반환 참조의 동일성과 core `isDeepFrozen`을 읽기만 한다. malformed outcome의 원래 오류를 앞지르지 않도록 guard를 뒀다.
- receipt는 reply hot listener(Vite WS `JSON.parse` 이후)에서 시작하고, publication은 `instance.subscribe` 첫 호출(React 구독 이전), commit은 `useLayoutEffect`의 DOM 확인 시점이다.

중첩 구간의 p95를 더하지 않고 표본별 잔여를 먼저 계산한다. Node와 브라우저 clock을 섞지 않는다. 함수별 값은 일시정지와 프로브 비용을 포함한 동기 wall time이고 GC는 별도로 관측하지 않았다. 0.00ms는 해당 browser clock에서 측정 가능한 차이가 없었다는 뜻이다.

## 실행

```sh
node benchmarks/live-update/run.mjs --mode locale-add --reply-stages --client-stages --scenario 10k-20-locales --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/locale-add-client-stages.json
```

2026-10-07 KST, 리비전 `4d2783c`, measuredAt `2026-10-07T13:06:35.789Z`, warmup 5·측정 50·control 25이고 raw 55 → 50 measured, nearest-rank p95는 정렬 48번째 값이다. 10k 메시지×20 로케일, namespace 1개, 라운드마다 새 en-GB JSON 387,783 B. 제품 dist 해시는 [28번 run](../benchmarks/results/locale-add-reply-stages.json)과 같고 두 JSON에서 다른 해시는 benchmark 하네스뿐이다.

## 결과

시간 단위는 ms이다. 잔여는 표본별로 먼저 계산한다.

| 구간 | p50 | p95 |
| --- | ---: | ---: |
| decode | 10.20 | 11.90 |
| Vite freeze | 88.40 | 288.20 |
| core accept(중첩) | 83.70 | 281.90 |
| core acceptCheck | 0.00 | 0.10 |
| core acceptFreeze | 83.60 | 281.90 |
| snapshot(중첩) | 27.70 | 50.90 |
| translator(중첩) | 20.80 | 42.60 |
| signature(중첩) | 6.00 | 11.90 |
| clientOther | 0.70 | 0.90 |
| receiveToPublish | 218.60 | 603.10 |
| publishToCommit | 1.40 | 1.80 |
| receiveToCommit | 219.90 | 604.40 |
| 선택→commit | 335.90 | 716.10 |
| saveToListAck | 316.30 | 627.45 |
| 표본별 freezeSum(Vite freeze+core acceptFreeze) | 175.80 | 570.10 |

- trust sameCatalog 50/50, trusted 0/50. 선택 전 target 응답 0, 선택 후 compact full 응답 1.
- 표본별 freezeSum이 decode+snapshot+clientOther+publication-to-commit보다 50/50회 컸다.
- 목록 250ms 이내 7/50. 로케일 첫 선택에는 목록 목표를 적용하지 않는다.
- 최악 표본 10k-20-locales:75 총 2,986.10(Vite freeze 1,383.90 + core freeze 1,424.50, publication→DOM 1.40). 긴 표본은 원시에 유지한다.

## 해석

- 참조는 같은데 core의 깊은 동결 신뢰가 없다. core 동결 신뢰는 모듈 지역 WeakSet이다. core root의 `optimizeDeps.include`, Vite client의 `/runtime` import 경로와 실제 trusted false 관측을 근거로, 이번 실행에서 두 경로의 신뢰 집합이 분리된 것으로 판단한다. 전체 번들 graph를 덤프해 모듈 identity를 비교한 것은 아니다.
- benchmark helper의 전역 상태 공유는 계측 전용이고 제품 신뢰 표시를 대신하지 않는다.
- publication이 React 구독 이전이라 수신 이후 시간 대부분이 publication 이전 동기 처리에 있다. 이번 값만으로 React·GC·네트워크를 원인으로 확정하지 않는다.
- 단일 장비 실행이고 28번 run과 옵션·부하가 다르므로 두 run의 시간 차이를 계측 추가나 코드에 귀속하지 않는다.

## 검증

- 하네스 테스트 14개(reply 5 + browser 5 + client 4)가 통과했고, 기존 core loading·Vite lazy 관련 테스트 33개도 이번 실행으로 통과했다.
- 회귀 smoke 4종이 exit 0이다. [client-stages 소형](../benchmarks/results/locale-add-client-stages-smoke.json), [full browser 회귀](../benchmarks/results/client-stages-full-browser-regression-smoke.json), [edit 회귀](../benchmarks/results/client-stages-edit-regression-smoke.json), [계측 끔](../benchmarks/results/client-stages-disabled-smoke.json).
- 호환되지 않는 CLI 조합 3종(`--client-stages` 단독, `--reply-stages`+`--client-stages`+`--browser-stages` 병용, 기본 edit 모드의 `--reply-stages`+`--client-stages`)이 거부된다. CPU 옵션은 이번에 검증하지 않았다.
- 원시 요약·잔여·request identity·trust 카운트·현재 hash와 제품 dist hash를 확인했고 임시 fixture·Chrome process가 남지 않았다.
- 제품 전체 check·build·release check·pack은 제품 입력이 바뀌지 않아 재실행하지 않았다. bump·push·publish·deploy 없음.
- 산출물: [요약](../benchmarks/results/locale-add-client-stages.json), [원시](../benchmarks/results/locale-add-client-stages.10k-20-locales.samples.json).

## 다음 제품 수정안

- core root 배럴이 이미 `export * from './runtime.js'`로 `freezeCatalogs`를 재export하므로, Vite `freeze.ts`가 `/runtime` 대신 root를 가져와 같은 prebundle 경로를 공유하는 후보를 검토한다. 아직 구현하지 않았다.
- root 엔트리는 `parseCatalog`를 포함하므로 production `astRuntime`의 parser 제거를 깨지 않는지 먼저 검증한다.
- 전역 WeakSet을 제품에 도입하는 방안과 `Object.isFrozen`으로 외부 얕은 동결을 신뢰하는 방안은 쓰지 않는다.
- 이번 커밋은 계측과 문서만 다루고 제품 최적화는 없다.
