# 47. JSON 항목 정규식 통합 실험

키·콜론·문자열 값을 한 번의 정규식 호출로 읽는 후보를 시험했다. 편집 파서의 p95 개선이 재측정에서 유지되지 않아 **채택하지 않고 원복했다**. 제품 소스는 `e76a3a1`과 같으며, JSON 경계·오류 우선순위 회귀 테스트 하나와 실험 기록만 남긴다.

## 후보와 재현

`readJson`의 키·separator·값 정규식 호출 세 번을 캡처 그룹을 가진 호출 한 번으로 합쳤다. 문자열 값 캡처가 없으면 즉시 `INVALID_CATALOG`를 반환한다. 최초 엄격한 `JSON.parse`, 키별 `JSON.parse`, decoded 중복 검사, entry 배열, 원문 값과 위치 계산, ICU 처리·동결은 유지했다. [11](11-parser-measurements.md)의 키 디코딩 생략이나 [41](41-json-entry-visitor-trial.md)의 entry 배열 제거와는 다른 후보다. 할당량·heap 감소는 측정하지 않았다.

[재현 패치](../benchmarks/results/json-fields-experiment.patch)는 제품 `packages/core/src/json.ts`만 담는다. 기준 커밋 `e76a3a1`의 별도 checkout에 패치를 같은 경로로 복사한 뒤 다음 명령을 실행한다. 마지막 인자를 `incremental`로 바꾸면 기존 불변 메시지를 재사용하는 편집 비교다.

```sh
git apply benchmarks/results/json-fields-experiment.patch
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs e76a3a1 benchmarks/results/parse-compare-json-fields-cold.json cold
```

2026-10-10 KST, Node v24.18.0, Windows x64에서 기존 동일 프로세스 교차 비교 도구를 사용했다. 10,000개 literal/ASCII 인자 메시지에서 probe 한 개를 같은 길이로 변경한다. cold는 이전 catalog 없이 warmup 5쌍·측정 20쌍, incremental은 warmup 50쌍·측정 100쌍이다. 호출 순서를 교대하며 매쌍 전체 결과를 `assert.deepEqual`로 비교한다. stringify·동등성 검사·디스크·watcher·번역 검증·브라우저는 timing 밖이다. 상세 clock 계측·강제 GC는 없으며 OS 부하와 GC는 통제하지 않았다.

## 결과

단위는 ms, p50·p95는 nearest-rank, 쌍별 차이는 실험−기준이다. 첫 cold run 중 core 테스트를 동시에 실행했으므로 채택 판단에서 제외하고 원시만 보존했다. 나머지 세 run은 이 작업의 테스트·빌드와 겹쳐 실행하지 않았다.

| 비교 | 기준 p50 | 실험 p50 | 기준 p95 | 실험 p95 | 쌍별 차이 중앙값 | 빨라진 쌍 |
| --- | --- | --- | --- | --- | --- | --- |
| cold 최초 (판단 제외) | 105.16 | 102.82 | 183.26 | 168.79 | -0.94 | 11/20 |
| cold 재측정 | 106.61 | 102.74 | 153.35 | 155.12 | -2.54 | 13/20 |
| incremental 최초 | 39.63 | 37.42 | 68.02 | 56.10 | -2.55 | 67/100 |
| incremental 재측정 | 48.47 | 47.02 | 68.47 | 74.67 | -0.89 | 58/100 |

중앙값은 모두 낮게 관측됐지만 편집 p95는 재측정에서 증가했고 cold p95도 감소하지 않았다. 안정적인 tail 개선 근거가 부족해 원복했다. 증가 원인을 코드로 확정하지 않으며, 종단 간 성능과 기존 화면 반영 목표 달성은 이번에 측정하지 않았다.

## 검증과 원본

- 실험 상태에서 core build·core 테스트 76개·JS/TS consumer 타입 검사를 통과했다.
- 모든 비교의 warmup 포함 350쌍에서 전체 catalog 동등성이 통과했다. measured 240쌍의 개수·차이·nearest-rank 통계를 원시에서 재계산했고, 네 run의 실험 코드 hash가 모두 같았다.
- 원복 후 core build·core 테스트 76개·parser probe 테스트 1개가 통과했다. 제품 source diff는 없고 재빌드한 core 5개 모듈 중 실험본과 다른 것은 `json.js` 하나다. 패치 재적용 검사도 통과했고 임시 parser 디렉터리는 남지 않았다.
- 유지한 회귀 테스트는 값 안의 escaped quote·가짜 JSON 필드·backslash·Unicode escape·빈 문자열과, 중복 ID/ICU 오류 뒤에 있는 non-string 토큰의 우선순위·정확한 CRLF 소스 위치를 확인한다. 기존 구현에서도 통과한다.

원시: [cold 최초](../benchmarks/results/parse-compare-json-fields-cold.json), [cold 재측정](../benchmarks/results/parse-compare-json-fields-cold-confirm.json), [편집 최초](../benchmarks/results/parse-compare-json-fields-incremental.json), [편집 재측정](../benchmarks/results/parse-compare-json-fields-incremental-confirm.json).

버전 변경·push·publish·deploy는 없다. 다음에는 같은 미세 최적화를 반복하기 전에 현행 파서의 CPU profile을 확인해 실제 실행 비용이 큰 함수를 좁힌다. 기존 elapsed 구간 계측만으로 CPU 병목이나 GC 원인을 확정하지 않는다.
