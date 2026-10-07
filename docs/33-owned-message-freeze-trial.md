# 33. 파서 소유 메시지 동결 실험

[32](32-prebundle-server-measurements.md)의 다음 후보를 구현해 비교했으나 개선을 확인하지 못해 되돌렸다. 제품 코드와 계측 하네스는 `a218fb13eb9deeda82626bb9b792f6973b008c32` 상태로 유지한다. 실험은 [패치](../benchmarks/results/owned-message-freeze-experiment.patch)로 보존한다.

## 실험 범위

새 메시지에 `freezeParsedMessage`를 적용했다. AST와 인자 스키마가 core의 깊은 순회 WeakSet에 있으면 숫자 위치 객체와 메시지 레코드를 직접 동결하고 캐시에 등록했다. 신뢰하지 않는 AST·인자는 기존 일반 동결로 순회했다. 외부 객체의 얕은 `Object.freeze`만으로 내부를 신뢰하지 않았다. `catalog.ts` 호출부와 메모리 계측 변환을 함께 바꿨고, 메시지 필드 변이 거부와 외부 얕은 동결 폴백 검사를 추가했다. 공개 export·wire·버전은 바꾸지 않았다.

## 측정 조건

Node 24.18.0, Windows x64, Ryzen 5 7430U에서 실행했다. 한 파일에 일반 텍스트와 ASCII `{name}` 메시지 10,000개를 두고 같은 길이의 probe 하나를 매회 바꿨다. 기준 커밋의 소스를 임시 디렉터리에서 빌드한 파서와 실험 파서를 같은 프로세스에서 순서를 번갈아 호출했다.

cold는 이전 카탈로그 없이 warmup 5쌍·측정 20쌍이다. incremental은 이전 불변 카탈로그를 넘기고 warmup 50쌍·측정 100쌍이다. 매쌍 파싱 결과 전체를 `assert.deepEqual`로 대조했다. 호출 wall time만 측정하고 입력 stringify·동등성 검사·디스크·watcher·번역 검증·브라우저는 제외했다. 상세 내부 프로브는 끈 비교이다. p50·p95는 nearest-rank이며 쌍별 차이는 실험−기준이다.

```sh
node benchmarks/live-update/parser-stages.mjs benchmarks/results/parser-stages-owned-message-before.json cold
# 기준 커밋에서 위 스냅샷을 수집한 다음 보존 패치를 적용한다.
git apply benchmarks/results/owned-message-freeze-experiment.patch
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs a218fb1 benchmarks/results/parse-compare-owned-message-cold.json cold
node benchmarks/live-update/parse-compare.mjs a218fb1 benchmarks/results/parse-compare-owned-message-incremental.json incremental
```

재현할 때는 기준 커밋의 별도 checkout을 사용한다. 측정 결과의 currentCodeHashes는 되돌리기 전 실험 dist이다. 이 문서가 기록하는 최종 제품 dist와 구분한다. 두 비교의 core 5개 hash는 서로 같다.

## 결과와 채택 판단

| 모드 | 기준 p50 | 실험 p50 | 기준 p95 | 실험 p95 | 쌍별 차이 중앙값 | 쌍별 차이 p95 | 빨라진 쌍 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cold | 118.04 | 120.36 | 195.72 | 221.65 | -3.82 | +128.50 | 10/20 |
| incremental | 49.76 | 50.45 | 76.64 | 86.21 | +0.80 | +24.58 | 47/100 |

단위는 ms이다. cold의 쌍별 중앙값은 낮았지만 절반만 빨랐고 전체 p50·p95는 높았다. incremental도 개선을 확인하지 못했다. 이번 표본으로 채택할 근거가 부족해 네 파일의 실험 변경을 모두 되돌렸다. 단일 장비의 실행 부하·GC·스케줄링을 통제하지 않았으므로 증가 원인을 코드로 확정하지 않는다. GC나 control을 차감하지 않으며 종단 간 로케일 추가 개선으로 확장하지 않는다.

실험 전 상세 cold 스냅샷은 별도 run이다. 10k total p50/p95는 141.07/317.35ms, messageFreeze는 55.81/237.76ms였다. 측정 20회 중 GC timestamp가 파싱 구간과 겹친 표본은 11회다. messageFreeze에는 AST 동결·절대 위치 생성·메시지 레코드 생성·일반 동결이 함께 들어 있다. 중첩 p95를 합산하거나 이 스냅샷을 교차 비교의 기준 시간으로 쓰지 않는다.

다음 작은 작업은 기존 messageFreeze 계측을 AST 동결·절대 위치 생성·레코드 동결로 분리하는 것이다. 어느 비용이 큰지 확인한 뒤 새 제품 실험을 정한다. 대규모 목록 250ms 목표는 여전히 미달이며 이번에는 종단 간 측정을 추가하지 않았다.

## 검증과 보존 자료

실험 상태에서 core build·테스트 76개·JS/TS consumer 타입 검사가 통과했다. cold 25쌍·incremental 150쌍 모두 전체 파싱 결과 동등성이 통과했다. 되돌린 뒤 core를 다시 빌드했고 카탈로그 테스트 24개와 보존 패치의 `git apply --check`가 통과했다. 최종 core dist 5개 hash와 프로브가 실험 전 스냅샷과 일치했다. 원시 표본에서 비교·구간 요약을 재계산해 대조했고, 변경한 Markdown 여섯 파일의 로컬 링크 179개·코드 fence·40KB 제한과 `git diff --check`가 통과했다. 제품 변경을 채택하지 않아 workspace 전체·pack·브라우저·release 검사는 반복하지 않았다.

- [cold 비교와 원시 쌍](../benchmarks/results/parse-compare-owned-message-cold.json)
- [incremental 비교와 원시 쌍](../benchmarks/results/parse-compare-owned-message-incremental.json)
- [실험 전 내부 계측](../benchmarks/results/parser-stages-owned-message-before.json)
- [1k 원시](../benchmarks/results/parser-stages-owned-message-before.1000.samples.json)
- [10k 원시](../benchmarks/results/parser-stages-owned-message-before.10000.samples.json)
- [되돌린 실험 패치](../benchmarks/results/owned-message-freeze-experiment.patch)

버전 변경·push·publish·deploy는 없다.
