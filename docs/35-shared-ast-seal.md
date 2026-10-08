# 35. AST 동결 헬퍼 모듈화

[34](34-message-freeze-stages.md)가 다음 후보로 지목한 `freezeMessageAst` 내부 `seal` 헬퍼의 호출별 생성을 없애는 단일 최적화를 채택했다. `seal`을 `packages/core/src/diagnostics.ts` 모듈 범위로 옮겨 새 AST마다 같은 함수를 재사용한다. 깊은 동결 순회, `WeakSet` 신뢰, FormatJS 복잡한 ICU의 일반 동결, 공개 API는 그대로다.

## 변경 범위

`freezeMessageAst` 안에 있던 `seal`을 모듈 스코프로 옮겼다. 함수 본문(`Object.freeze`와 `frozen.add`)과 호출 순서는 바뀌지 않는다. 이 경로는 파서가 소유한 새 AST에만 쓰므로 외부 입력의 일반 동결과 오류 의미도 유지한다. 공개 entry·버전·게시본은 변하지 않는다.

## 조건과 경계

```sh
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs cbd6871 benchmarks/results/parse-compare-shared-ast-seal-cold.json cold
node benchmarks/live-update/parse-compare.mjs cbd6871 benchmarks/results/parse-compare-shared-ast-seal-incremental.json incremental
```

기준 리비전은 `cbd6871`이다. 2026-10-08(KST) Node 24.18.0에서 실행했다. 한 파일에 일반 문구·ASCII `{name}` 메시지 10,000개를 두고 같은 프로세스에서 두 파서를 교차 호출한다. 매회 `probe` 값 하나만 같은 길이로 바꾼다. warmup을 포함한 모든 pair에서 두 파서의 파싱 결과 전체를 `deepEqual`로 대조한다(cold 25쌍, incremental 150쌍, 모두 일치). cold는 이전 카탈로그 없이 새로 파싱하고 incremental은 직전 불변 카탈로그를 재사용한다. `stringify`·동등성 검사·디스크·watcher·번역 검증·브라우저는 timing에서 제외한다.

cold는 warmup 5쌍·측정 20쌍, incremental은 warmup 50쌍·측정 100쌍이다. p50·p95는 nearest-rank다. GC·control을 차감하지 않고 중첩 p95를 합산하지 않는다. 서로 다른 시점의 run과 인과 비교하지 않는다.

## Cold 교차 비교

| 파서 | p50(ms) | p95(ms) | min(ms) | max(ms) |
| --- | --- | --- | --- | --- |
| 기준 리비전 | 178.4783 | 332.6223 | 96.3825 | 359.4802 |
| `seal` 모듈화 | 151.7772 | 323.8107 | 98.7914 | 357.4289 |

20쌍 중 13쌍이 빨랐고 pair별 after−before 중앙값은 -26.1658ms였다. pair차 p95는 +24.8066ms다.

## Incremental 교차 비교

| 파서 | p50(ms) | p95(ms) | min(ms) | max(ms) |
| --- | --- | --- | --- | --- |
| 기준 리비전 | 48.1476 | 88.6328 | 32.1344 | 156.1319 |
| `seal` 모듈화 | 47.5307 | 80.2430 | 27.5103 | 246.9130 |

100쌍 중 53쌍이 빨랐고 pair별 차이 중앙값은 -0.7381ms다. pair차 p95는 +30.1070ms다.

## 해석과 한계

두 비교의 파싱 p50·p95가 낮게 관측됐고 구현도 내부 헬퍼 이동으로 작아 이번 변경을 채택했다. cold pair차 중앙값은 -26.1658ms, incremental은 -0.7381ms였다. 두 비교 모두 pair차 p95가 양수이고 incremental 최장 시간은 156.1319→246.9130ms로 늘었다. 단일 장비에서 GC·부하를 통제하지 않아 시간 차이를 헬퍼 생성 비용으로 확정하지 않는다. 안정적 tail 개선이나 일반적인 속도 개선을 주장하지 않는다. 실제 언어 목록 250ms 목표의 개선은 측정하지 않았다.

## 검증

core build, core 테스트 75개, consumer 타입 검사를 통과했다. `node --test benchmarks/live-update/parser-probe.test.mjs` 1개가 통과했다. cold·incremental 원시 표본에서 요약·pair차·dist 5개 hash·임시 디렉터리 정리까지 대조를 마쳤다. 제품 dist 5개 중 `diagnostics.js`만 기준 리비전과 다르고 `catalog.js`·`json.js`·`simple-message.js`·`schema.js`는 이전 baseline과 같다.

공개 API·wire 변경이 없어 workspace 전체·pack·브라우저·release 검사는 반복하지 않았다.

문서 표를 결과 JSON과 대조했다. 변경한 Markdown 여섯 파일의 로컬 링크 186개·코드 fence·40KB 제한과 `git diff --check`가 통과했다.

## 다음 작업

다음은 상세 계측을 끈 large locale-add 실제 목록 시간 재측정이다. 제품 변경 후 250ms 목표 충족 여부를 확인한다.

## 자료

- [cold 비교](../benchmarks/results/parse-compare-shared-ast-seal-cold.json)
- [incremental 비교](../benchmarks/results/parse-compare-shared-ast-seal-incremental.json)

공개 API·버전·게시 변화는 없고 push·publish도 없다.
