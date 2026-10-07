# 25. 첫 언어 선택의 core 응답 수락 계측

앞선 [24](24-full-selection-browser-stages.md)는 언어 선택 전체 구간을 나눴지만 core 수락 경로 내부는 열지 않았다. 이번 측정은 `acceptOutcome` 안쪽을 check·deep freeze·기타로 쪼개고, 첫 언어 선택(en-GB 추가) 시점에 core 응답 수락이 전체 선택 시간에서 얼마를 차지하는지 계측한다. 2026-10-07 KST, 리비전 `576161f`(`576161fea0a32c23f0ad8bb111b9cc45c1bced20`), 벤치마크 변경분은 측정 시점에 커밋되지 않은 상태이다.

## 실행과 조건

```text
node benchmarks/live-update/run.mjs --mode locale-add --browser-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-accept-stages.json
```

시나리오는 로케일당 10,000 메시지, 로케일 20개, 네임스페이스 1개, 초기 카탈로그 파일 20개(7,755,280바이트)이다. 회차마다 en-GB 디렉터리와 카탈로그 1개(10,000 메시지)를 새로 만들고, 목록 옵션 커밋 후 자동으로 로케일을 선택한다. 라운드마다 en으로 리셋하고 로케일 제거를 기다린 뒤 다음 표본을 시작한다.

Saylo prebundle은 끄고 React/ReactDOM은 prebundle했으며 typegen은 켠다. `declarationRewritten`은 false이다. 환경은 Windows, Node v24.18.0, AMD Ryzen 5 7430U, 논리 CPU 12개, Vite 8.3.2, React 19.3.0, HeadlessChrome 154.0.0.0이다. CPU·서버 프로파일링은 하지 않았다. 제품 소스/dist는 이전 연구와 동일하고 해시도 일치하며, 신규로 `packages/core/dist/catalog-loader.js` 해시(`77ba98db0821dd70dab644232d3ddd2bd71d4fc122544693e752f7eeca68297c`)를 기록했다.

## 계측 경계

- `decodeMs`: compact 디코딩과 검증. WebSocket `JSON.parse`는 제외한다.
- `freezeMs`: Vite `freezeCatalogs`.
- `acceptMs`: core `acceptOutcome` 전체.
- `acceptCheckMs`: 메타데이터·세션·키·상태·버전·페이로드 검사와 base 지문 검사(기준 로케일을 선택할 때만). 이번 실행은 en-GB를 선택하므로 base 지문 계산을 실행하지 않는다.
- `acceptFreezeMs`: outcome/key 복사 후 core `diagnostics.freeze`(깊은 순회).
- `acceptOtherMs`: 표본별 accept에서 check와 freeze를 뺀 값.
- `snapshotMs`: translator와 signature를 포함하고, `snapshotOtherMs`가 표본별로 그 둘을 뺀다.
- `selectionOtherMs`: 표본별 브라우저 select-to-commit에서 decode, Vite freeze, accept, snapshot을 뺀 나머지. 전송·서버·WS 파싱·기타 작업·React 커밋이 섞여 있어 순수 네트워크가 아니다.
- `translatorMs`: 언어 간 인자 호환성 처리를 포함한다.
- 이전 연구의 `selectionOther`는 accept를 빼지 않아 경계가 다르므로 직접 비교하지 않는다.

표본 10개에 nearest-rank를 쓰므로 p95는 최댓값과 같다. 이 문서의 표는 p50·최소·최대만 싣는다. 중첩된 구간의 p95를 더하지 않으며, Node와 브라우저 시계를 서로 빼거나 제어 왕복·GC를 차감하지 않는다. 함수별 계측은 런타임 일시정지와 GC를 포함한 동기 경과 시간이며 CPU 전용 시간이 아니다. 선택 잔여와 종단 간 구간에는 비동기 대기도 포함한다. 계측의 시계 호출·counter 비용도 포함한다.

## 결과

stage 요약(ms):

| 단계 | p50 | 최소 | 최대 |
| --- | --- | --- | --- |
| decodeMs | 9.20 | 5.90 | 22.80 |
| freezeMs(Vite) | 42.30 | 35.50 | 53.80 |
| acceptMs | 66.00 | 60.00 | 341.90 |
| acceptCheckMs | 0.00 | 0.00 | 0.10 |
| acceptFreezeMs | 66.00 | 59.90 | 341.90 |
| snapshotMs | 19.30 | 16.20 | 38.30 |
| translatorMs | 13.90 | 11.50 | 32.60 |
| signatureMs | 5.20 | 4.20 | 7.40 |
| acceptOtherMs | 0.00 | 0.00 | 0.20 |
| snapshotOtherMs | 0.00 | 0.00 | 0.20 |
| selectionOtherMs | 86.50 | 73.50 | 118.60 |

구간 요약(ms):

| 구간 | p50 | 최소 | 최대 |
| --- | --- | --- | --- |
| saveToListAckMs | 201.24 | 179.98 | 237.62 |
| selectToTranslationAckMs | 254.56 | 202.18 | 535.21 |
| saveToTranslationAckMs | 463.77 | 394.91 | 735.07 |
| selectToCommitMs | 248.50 | 199.10 | 530.90 |
| saveToBroadcastMs | 184.13 | 166.64 | 217.96 |
| fileWriteMs | 12.60 | 8.80 | 16.55 |

wire와 제어:

| 항목 | p50 | 최소 | 최대 |
| --- | --- | --- | --- |
| catalogReplyBytes | 1,241,400 | 1,241,399 | 1,241,401 |
| addedCatalogBytes | 387,783 | 387,783 | 387,783 |
| controlRoundTripMs | 3.02 | 2.48 | 3.88 |

표본별 비율(최소 / p50 / 최대):

| 비율 | 최소 | p50 | 최대 |
| --- | --- | --- | --- |
| acceptFreezeMs / selection | 24.94% | 28.13% | 64.40% |
| selectionOtherMs / selection | 16.03% | 37.45% | 45.03% |

서버 기동 4,516.73ms, 브라우저 부팅 8,642.84ms이다.

저장→목록 ack는 10/10회가 250ms 이내였지만 Saylo prebundle을 끈 이번 계측 실행의 관측이다. 일반 설정의 목록 목표를 달성했다는 근거로 사용하지 않는다.

## 해석

core freeze는 수집한 동기 구간 중 가장 컸다. `acceptFreezeMs`는 10/10 표본에서 decode, Vite freeze, snapshot을 모두 넘었고, `acceptMs`와 거의 같아 수락 시간 대부분을 차지했다. p95(=최댓값)는 341.90ms이다. 반면 `acceptCheckMs`는 p50 0.00ms, p95(=최댓값) 0.10ms로 대부분 시계 정밀도 아래였다. `acceptOtherMs`와 `snapshotOtherMs`도 p50 0.00ms, 최대 0.20ms로 작게 관측됐다. 0.00ms는 해당 작업이 없다는 뜻이 아니다.

원인 기제는 확인됐다. Vite `freezeCatalogs`는 `Object.isFrozen` 검사와 자체 순회를 쓰고, core `diagnostics.freeze`는 core가 순회한 객체를 모듈 로컬 WeakSet에 기록한다. Vite가 얼린 데이터는 이 core WeakSet에 없으므로 core가 같은 트리를 다시 순회한다. 이는 검증된 기제이자 측정된 고비용 단계이지, 모든 일시정지의 원인 증명도 아니고 측정된 개선도 아니다.

`selectionOtherMs` 중앙값 86.50ms는 전송·서버·WS 파싱·기타 클라이언트 작업·React 커밋이 섞인 잔차이며 순수 네트워크가 아니다. 실행 간 성능 인과 주장은 하지 않는다. p95 급등에 대한 설명은 확인되지 않았다.

## 검증

원시 실행 12건(웜업 2 + 측정 10) 모두 8개 지표를 각 1회 호출했고, 선택 전 응답은 0건, 선택 후 compact 전체 응답은 1건이다. 입력 node/value/React 상태를 제어했고, 생성된 `.d.ts`는 mtime·크기가 바뀌지 않았으며, 전체 페이지 리로드가 없고 다음 표본 전에 리셋·제거가 이뤄졌다.

원시 카운트, 고유 토큰, nearest-rank 요약, 잔차/호출 수, wire, 해시를 네 차례 실행으로 확인했다. 소규모 전체 스모크(측정 2 + 웜업 1)는 [../benchmarks/results/locale-add-accept-stages-smoke.json](../benchmarks/results/locale-add-accept-stages-smoke.json), 편집 패치 회귀(2+1)는 [../benchmarks/results/accept-stages-edit-regression-smoke.json](../benchmarks/results/accept-stages-edit-regression-smoke.json), 비활성 스모크(1+0)는 [../benchmarks/results/accept-stages-disabled-smoke.json](../benchmarks/results/accept-stages-disabled-smoke.json)에 있다. 하네스 테스트 5건이 통과했고, 계측된 accept 의미론, stale/payload/schema 거부, 외부에서 얕게 얼린 카탈로그의 깊은 freeze, 변경된 dist의 fail-closed, 편집/비활성 동작, 중첩 잔차 검증을 포함한다. 제품 테스트와 소비자 타입체크는 제품 입력이 바뀌지 않은 이전 단계에서 통과해 여기서 재사용했으며, 빌드·릴리스·팩은 다시 돌리지 않았다.

결과는 [요약](../benchmarks/results/locale-add-accept-stages.json)과 [원시 표본](../benchmarks/results/locale-add-accept-stages.10k-20-locales.samples.json)에 있다. 임시 fixture·프로필·benchmark 브라우저가 남지 않았음을 확인했다. 문서의 로컬 링크·코드 블록·40KB 이하 크기와 `git diff --check`도 확인했다.

## 다음 작업

다음 단계는 신뢰된 전송 카탈로그에 대한 중복 깊은 순회를 피하는 것이다. Vite와 core가 core 소유의 깊은 동결 경로·신뢰 추적을 공유하도록 한다. core가 순회하지 않은 객체를 `Object.isFrozen`만으로 신뢰 목록에 넣지 않는다. 외부의 얕게 얼린 객체도 깊게 동결하고, AST 불변성과 schema·오류 의미를 유지한다. 이후 동일 계측과 옵션으로 이번 실행과 비교한다.

이번 과제는 계측까지이고 최적화는 구현하지 않았다. 한계는 단일 머신, 단일 네임스페이스, 헤드리스 개발 모드, 렌더링된 프로브 메시지 1개이며, 페인트와 콜드 스타트는 제외한다.
