# 31. prebundle freeze 공유 이후 locale-add 재측정

## 목적

[29](29-prebundle-client-stages.md)에서 동결 신뢰 분리를 확인하고 [30](30-prebundle-freeze-sharing.md)에서 root import로 공유한 뒤, 일반 prebundle 경로에서 locale-add 시나리오를 다시 측정했다. 제품과 하네스 코드는 변경하지 않았다. 이번 작업은 측정 결과와 관련 문서 갱신을 포함한다.

## 실행

```sh
node benchmarks/live-update/run.mjs --mode locale-add --scenario all --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/locale-add-prebundle-shared-freeze.json
```

- revision: 442363a44f62f42a7a08bf260054d260369b731c
- measuredAt: 2026-10-07T13:38:56.862Z
- 상세 계측 CPU/browser/server-file/reply/client: 모두 OFF
- normal prebundle/typegen: ON
- Node 24.18.0, Vite 8.3.2, React 19.3.0, Windows x64, Ryzen 5 7430U, HeadlessChrome 154
- 규모별 55 raw(5 warm + 50 measured), control 25, 고유 raw token 110

## 입력 규모

| 규모 | 메시지 | 로케일 | JSON | 추가 |
| --- | --- | --- | --- | --- |
| small | 1k | 3 | 110292B | 36781B |
| large | 10k | 20 | 7755280B | 387783B |

namespace bench는 1이다.

## 결과

단위는 ms이다. 저장→목록/번역 ack는 Node 파일 쓰기 완료부터 DOM 확인 ack 수신까지이며 ack 전달 비용을 포함한다. Browser 선택→commit은 setLocale 직전부터 번역 DOM을 확인한 useLayoutEffect까지이다.

| 지표 | small p50 | small p95 | large p50 | large p95 |
| --- | --- | --- | --- | --- |
| 목록 saveToListAck | 86.64 | 152.13 | 189.62 | 268.54 |
| Node 선택준비→번역 ack | 30.06 | 57.73 | 186.70 | 297.57 |
| Node 저장→번역 ack | 122.14 | 233.38 | 379.11 | 663.07 |
| Browser 선택→commit | 26.60 | 54.60 | 181.00 | 284.40 |
| Node 저장→broadcast | 81.38 | 138.26 | 177.71 | 247.95 |
| fileWrite | 7.64 | 28.70 | 10.39 | 24.71 |
| control | 4.07 | 5.34 | 4.12 | 8.48 |

목록 250ms 이내 비율은 small 49/50, large 47/50이다. small 목록 p95는 목표를 충족하고 large 목록 p95는 18.54ms 초과한다. 최초 번역 선택에는 목록 250ms와 문구 편집 100ms 목표를 적용하지 않는다.

## 이전 run 비교 제한

이전 일반 run 27의 목록 p95는 small 112.42, large 621.18이고 선택 p95는 small 74.20, large 631.70이다. 두 run은 시점이 다르고 harness 차이와 부하가 있으므로, 관측된 전체 감소를 동결 공유 효과로 확정하지 않는다. 상세 계측을 켠 30과 직접 인과 비교도 하지 않는다.

## Node 동일 clock 분해

표본별 `saveToListAckMs - saveToBroadcastMs`는 같은 Node clock의 broadcast→목록 ack 구간이다. p50/p95는 small 5.42/17.94ms, large 13.57/16.25ms이다. 전송·브라우저 갱신·HTTP ack 비용이 포함된다. 각 규모에서 50/50회 저장→broadcast 구간이 그 뒤 구간보다 컸다. p95끼리 뺀 값이 아니며, Node와 Browser clock 혼용, control/GC 차감, 중첩 p95 합산은 하지 않는다. 50회 p95는 정렬 48번째 값이다.

## 시나리오와 제외 범위

매회 새 en-GB 파일 추가 → 목록 DOM 확인 → 자동 선택 → 번역 DOM 확인 → en 복귀 → 파일과 빈 디렉터리 제거를 완료한 뒤 다음 회차로 진행한다. 디렉터리 생성 시간은 제외한다. 앱은 warm 상태이고 새 카탈로그·프로브 formatter는 최초 로딩이다. paint, cold startup, 전체 메시지 렌더는 제외한다. 입력 DOM 노드·값과 React 상태, .d.ts mtime·크기는 유지하고 reload는 없다.

raw 110 전부 선택 전 응답은 0이고, 선택 후 saylo-catalog-v1 compact full은 1이며 measured 100도 동일하다. frame JSON p95는 small 119640B, large 1241403B이고 실제 network bytes는 아니다.

## 검증

원시 개수·토큰 고유성·warmup·계측 옵션·시간·control·바이트·통계·현재 코드 hash와 Node 시간 경계를 대조했다. 제품과 하네스 hash는 30 실측과 같다. 이전 27과 공통 제품 hash 차이는 `packages/vite/dist/freeze.js` 하나이다. 임시 fixture와 benchmark browser가 남지 않았다. 제품 테스트·타입 검사·build·pack·release는 입력이 바뀌지 않아 이번에 재실행하지 않았다. 버전 변경·push·publish·deploy는 없다.

## 다음 후보

large 목록이 목표에 미달하고 broadcast 전 구간이 크므로, 현행 서버의 경로 검사·읽기·파싱·번역 준비를 재계측해 다음 최적화를 결정한다. 상세 계측을 끈 이번 값만으로 파싱이나 GC를 원인으로 확정하지 않는다.

## 링크

- [locale-add-prebundle-shared-freeze.json](../benchmarks/results/locale-add-prebundle-shared-freeze.json)
- [locale-add-prebundle-shared-freeze.1k-3-locales.samples.json](../benchmarks/results/locale-add-prebundle-shared-freeze.1k-3-locales.samples.json)
- [locale-add-prebundle-shared-freeze.10k-20-locales.samples.json](../benchmarks/results/locale-add-prebundle-shared-freeze.10k-20-locales.samples.json)
- [locale-add-prebundle-shared-freeze-comparison.json](../benchmarks/results/locale-add-prebundle-shared-freeze-comparison.json)

관련 문서: [27](27-shared-freeze-locale-add.md), [30](30-prebundle-freeze-sharing.md).
