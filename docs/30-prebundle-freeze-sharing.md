# 30. 개발 prebundle에서 Vite/core 깊은 동결 경로 공유

[29](29-prebundle-client-stages.md)에서 같은 Vite 동결 카탈로그 참조가 core 수락에 50/50 전달됐지만 core의 깊은 동결 신뢰는 0/50이었다. core 동결 신뢰가 모듈 지역 WeakSet에 있고, dev의 core root prebundle과 `/runtime` subpath가 다른 graph면 공유되지 않는다. Vite `freeze.ts`가 `/runtime` 대신 core root의 기존 `freezeCatalogs`를 가져오도록 한 줄 바꿨다.

## 구현

- `packages/vite/src/freeze.ts`의 `freezeCatalogs` import를 `@0disoft/saylo-core/runtime`에서 `@0disoft/saylo-core`로 바꾼다. root는 같은 함수를 이미 export한다.
- 개발 앱의 다른 core import가 root를 쓰므로, 같은 prebundle 모듈에서 Vite 동결 캐시를 공유한다.
- 깊은 동결 신뢰는 기존 모듈 지역 WeakSet으로 관리한다. 외부에서 겉만 동결한 객체는 계속 내부까지 순회한다.

## 범위

- 확인한 사실은 root를 import하는 개발 앱의 정상 prebundle에서 deep-freeze 캐시를 공유한다는 것이다(sameCatalog 50/50, trusted 50/50).
- `/runtime`만 쓰는 개발 앱과 사용자 optimizer `exclude`/`alias` 설정은 별도로 측정하지 않았다. 전체 번들 모듈 identity를 덤프해 비교하지 않았다.

## 실행

```sh
node benchmarks/live-update/run.mjs --mode locale-add --reply-stages --client-stages --scenario 10k-20-locales --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/prebundle-freeze-shared.json
```

2026-10-07 KST, 리비전 `6ee51ff`의 수정 작업 트리, measuredAt `2026-10-07T13:22:54.610Z`, 기본 prebundle·typegen 켬, warmup 5·측정 50·control 25. 구현은 `3da29d4`에 커밋했다. 50회 nearest-rank p95는 정렬 48번째 값이다.

## 결과

시간 단위는 ms이고 잔여는 표본별로 먼저 계산한다. 중첩 구간의 p95를 더하지 않는다.

| 구간 | p50 | p95 |
| --- | ---: | ---: |
| decode | 7.70 | 11.60 |
| Vite freeze | 75.20 | 92.80 |
| core acceptFreeze | 0.00 | 0.00 |
| snapshot | 20.00 | 23.00 |
| receiveToPublish | 102.70 | 126.30 |
| publishToCommit | 1.20 | 1.40 |
| receiveToCommit | 103.90 | 127.60 |
| 선택→commit | 190.00 | 449.70 |
| 목록 표시 | 205.53 | 479.11 |
| 표본별 freeze 합(Vite freeze+core acceptFreeze) | 75.20 | 92.80 |

- trust sameCatalog 50/50, trusted 50/50이다. [29](29-prebundle-client-stages.md)의 trusted 0/50과 달라졌다.
- core acceptFreeze는 0.00/0.00ms, 최대 0.10ms, 비zero 표본 2회다. 0은 실제 연산이 0이라는 뜻이 아니고 browser clock에서 측정 가능한 차이가 없었다는 뜻이다.
- 목록 250ms 이내 37/50이다. typegen 유지, 입력 state·DOM 유지, reload 없음이다.
- [29](29-prebundle-client-stages.md) run 대비 core 동결은 83.60/281.90→0/0ms, 표본별 freeze 합은 175.80/570.10→75.20/92.80ms로 관측됐다. 두 값은 서로 다른 run이다.

## 해석과 한계

- 별도 run 비교이므로 감소분 전체를 이 변경의 인과 개선으로 확정하지 않는다. 확인한 것은 개발 prebundle에서 신뢰 카탈로그의 중복 깊은 순회가 사라졌다는 기능 사실이다.
- 정상 prebundle을 유지한 단일 장비 warm 실행이다. 함수 wall time은 일시정지와 프로브 비용을 포함하며 GC를 별도로 관측하지 않았다. Node와 브라우저 clock을 섞지 않는다.
- 표본별 비교 값은 [prebundle-freeze-comparison.json](../benchmarks/results/prebundle-freeze-comparison.json)에 있다.
- 다음은 상세 계측을 끈 small/large 50회 종단 간 재측정이다.

## 검증

- `npm run build`(workspace Vite)와 workspace Vite consumer typecheck가 통과했다.
- Vite client·lazy·patch·production 테스트 43개와 하네스 14개, 합 57개가 통과했다.
- production runtime parser 제거는 유지된다. fixture의 압축 전 JS 합은 169,275→118,204 B이고 외부 FormatJS 문자열 소비는 parser를 유지하며 lazy chunk·fallback·오류 테스트가 통과했다.
- smoke 3종이 exit 0이다. [shared-smoke](../benchmarks/results/prebundle-freeze-shared-smoke.json), [edit-smoke](../benchmarks/results/prebundle-freeze-edit-smoke.json), [disabled-smoke](../benchmarks/results/prebundle-freeze-disabled-smoke.json).
- 네 패키지 전체 `check`·`pack`·release 검사는 반복하지 않았다.
- 원시 표본·요약·잔여·호출 수·wire·hash를 대조했다. 29번 실행 대비 측정 코드 hash가 바뀐 파일은 `packages/vite/dist/freeze.js` 하나다. 임시 fixture와 benchmark browser가 남지 않았다.
- 산출물: [요약](../benchmarks/results/prebundle-freeze-shared.json), [원시](../benchmarks/results/prebundle-freeze-shared.10k-20-locales.samples.json). bump·push·publish·deploy 없음.
