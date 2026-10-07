# 32. prebundle 서버 파일 단계 계측

[31](31-prebundle-freeze-locale-add.md)의 상세 계측을 끈 large 목록 p95는 268.54ms로 250ms 목표를 넘었다. 현행 서버를 재계측했고 제품 source·dist와 하네스는 바꾸지 않았다.

## 계측 조건

```sh
node benchmarks/live-update/run.mjs --mode locale-add --server-file-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-prebundle-server-files.json
```

gitRevision은 `7306fb115f4c87182a66d429b439a3667565b8ae`, measuredAt은 `2026-10-07T13:49:34.594Z`이고 시작 시 작업 트리는 깨끗했다.

초기 규모는 10k 메시지 × 20개 로케일·파일, JSON 7,755,280 B이다. namespace는 bench 하나이고 매회 en-GB JSON 387,783 B를 추가한다. warmup 2회·측정 10회·control 10회이며 원시는 12회다. nearest-rank 10회 p95는 최댓값이다. 기본 prebundle·typegen을 켜고 server-file 상세 계측만 켰다. CPU·browser·reply·client 상세 계측은 껐다. 환경은 Node 24.18.0, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Windows x64, Ryzen 5 7430U이다.

계측 범위는 저장 직전부터 목록 DOM ack까지이다. 초기 boot·선택 후 full 응답·en 복귀·파일 제거는 해당 서버 구간에서 제외한다. 생성 선언의 mtime·크기와 입력 DOM 노드·값·React 상태를 유지했고 reload 없이 복귀·제거를 완료했다.

## 계측 훅

Node 훅은 `packages/typegen/dist/catalog-files.js`를 메모리에서 변환하고 `LiveRegistry`·`CatalogRegistry`의 메서드를 감싼다. `readAndCandidate`는 drain부터 prepareTranslations 진입까지이며 경로 검사·파일 읽기·파싱·후보 필터·기준 파일 stat·직렬화 대기를 포함한다. 파싱은 parseCatalog 호출과 인자 구성의 동기 wall time이고 경로 검사·읽기는 비동기 wall time이다. 번역 준비에는 schema 조회·새 번역 검증·격리 준비가 들어가며 최종 active 검증과 구분한다. candidateOther는 각 표본의 readAndCandidate에서 경로 검사·읽기·파싱 시간을 뺀 잔여이다.

구간이 중첩되므로 p95를 합산하지 않는다. wall time은 프로브 비용과 일시정지를 포함하며 순수 CPU 시간으로 해석하지 않는다. GC·스케줄링 지연은 별도로 관측하지 않았다. Node와 Browser clock을 섞거나 control·GC 비용을 차감하지 않는다.

## 결과

| 구간 | p50 | p95 |
| --- | --- | --- |
| 목록 | 230.40 | 390.49 |
| save→broadcast | 215.57 | 373.78 |
| browser 선택→commit | 201.60 | 402.60 |
| Node 선택준비→ack | 205.14 | 407.16 |
| Node 저장→번역 ack | 445.15 | 656.50 |
| control | 2.90 | 5.28 |
| queue→drain | 47.85 | 54.24 |
| readAndCandidate | 137.86 | 308.22 |
| path | 0.65 | 3.22 |
| UTF8 read | 1.09 | 8.04 |
| parse | 133.78 | 306.39 |
| candidateOther | 1.24 | 16.57 |
| translationPrep | 9.52 | 12.27 |
| final validate | 0.04 | 0.05 |
| registry replace | 0.09 | 0.17 |

단위는 ms이다. 중첩된 readAndCandidate를 제외한 개별 구간 중 파싱이 10/10회 가장 컸다. 표본별 파싱/readAndCandidate 비중은 최소 84.43%·p50 95.99%·최대 99.41%였다. candidate 안의 wall time 비중이며 전체 지연이나 CPU 비중을 나타내지 않는다.

목록 250ms 이내는 7/10회이고 최소 199.73ms·최대 390.49ms로 p95 목표는 미달이다. 원시 개수·계측 옵션·유한 시간·호출 수·요약·바이트·Node 시간 경계·control·코드 hash를 대조했다. 원시 12회 모두 drain 1회, 파일 이벤트 2회, 경로 검사·읽기·파싱 각 1회였다. catalogDelta가 0인 것은 선택 후 full 로드가 수집 구간 밖이기 때문이다. 선택 전 응답 0개·선택 후 compact full 1개를 확인했다. 직렬화 JSON 프레임 p95는 1,241,400 B이며 실제 네트워크 바이트는 아니다. 측정 코드 hash는 31번 일반 run과 모두 같다.

## parser-only 재검증

재사용 증거는 [기존 cold 내부 계측](../benchmarks/results/parser-stages-position-pool-cold.json)과 [10k 원시](../benchmarks/results/parser-stages-position-pool-cold.10000.samples.json)의 측정 20회이다. core의 catalog·json·diagnostics·schema·simple-message 5개 파일 SHA가 현행과 같았다. 원시 요약을 다시 대조했고 messageFreeze가 JSON·AST 파싱·인자 추론·messageLoopOther보다 큰 경우는 17/20회였다. messageFreeze p50/p95는 39.17/94.92ms, AST 파싱은 20.19/56.79ms, 인자 추론은 22.07/41.30ms, JSON은 30.21/72.66ms였다. messageFreeze는 AST 동결·절대 위치 생성·메시지 레코드 생성·동결을 포함한다. 일반 객체 동결만의 순수 비용으로 귀속하지 않는다. 표본·fixture·프로브가 달라 서버 run과 합산하거나 인과 비교하지 않는다.

## 다음 실험

다음 후보는 파서가 직접 만든 새 메시지·숫자 위치 객체의 구조를 활용해 일반 Object.values 순회를 줄이는 작은 실험이다. AST·인자 스키마의 깊은 동결 신뢰, UTF-16 소스 위치·Unicode·ICU 오류 의미와 외부의 얕은 동결을 내부까지 순회하는 동작을 유지한다. cold/incremental 교차 비교로 채택 여부를 판단한다. 이번 작업에서는 최적화를 구현하지 않았다.

제품과 하네스가 바뀌지 않아 테스트·타입 검사·build·pack·release는 재실행하지 않았다. 임시 fixture와 benchmark browser가 남지 않았다.

## 링크

- [결과 요약](../benchmarks/results/locale-add-prebundle-server-files.json)
- [원시](../benchmarks/results/locale-add-prebundle-server-files.10k-20-locales.samples.json)
- [분석](../benchmarks/results/locale-add-prebundle-server-files-analysis.json)

과거 [21](21-locale-add-server-remeasurement.md)과 [31](31-prebundle-freeze-locale-add.md)에는 부하·코드·계측·표본 차이가 있어 전체 시간을 인과 비교하지 않는다. 버전 변경·push·publish·deploy는 없다.
