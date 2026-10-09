# 49. 파서 소유 메시지 맵 동결

이미 깊게 동결된 메시지를 담은 최종 맵의 재순회를 생략하도록 로컬 적용했다. 두 번의 편집 파서 교차 비교에서 p50·p95와 쌍별 차이 중앙값이 모두 낮게 관측됐다. 신규 파싱은 지표가 엇갈려 일관된 개선을 주장하지 않는다. 실제 watcher·화면 반영은 아직 재측정하지 않았다.

## 변경과 신뢰 범위

`catalog.ts`가 성공한 메시지 맵을 내부 `freezeOwnedMessageMap`으로 동결하고 깊은 동결 신뢰 WeakSet에 등록한다. 최종 카탈로그 자체는 기존 일반 `freeze`로 마무리한다. 맵에 대해 다시 `Object.values` 배열을 만들고 메시지마다 신뢰 여부를 검사하는 순회를 제거했다. `Object.freeze`가 맵을 동결하는 비용은 남으며 heap·총 할당량은 측정하지 않았다.

이 함수는 파서가 소유한 새 맵에만 사용한다. 새 메시지는 기존 `freeze`를 마치고, 재사용 메시지는 깊게 동결한 이전 카탈로그에서만 가져온다. 위치가 바뀐 재사용 메시지도 새 레코드를 기존 `freeze`로 동결한다. 진단 오류가 있으면 맵 최종화 전에 실패한다. 따라서 맵 동결 시 모든 자식은 이미 신뢰할 수 있으며 빈 맵도 안전하다. 일반 `freeze`와 외부 얕은 동결 객체의 재귀 순회는 유지한다. 외부 입력이 이 내부 함수의 사전조건을 충족한다고 가정하지 않는다.

공개 entry·타입·wire·버전은 바꾸지 않았다. 개별 메시지 직접 동결 실험([33](33-owned-message-freeze-trial.md))이나 일반 for-in 동결 실험([19](19-ast-freeze-measurements.md))과 다르다. CPU 근거는 [48](48-parser-cpu-profile.md)이며 해당 CPU 표본의 동결 비중 전부를 이 최종 맵 비용으로 보지 않는다. `parser-probe.mjs`는 최종 맵·카탈로그 동결을 모두 기존 `freezeMs` 경계 안에서 측정하도록 갱신했다.

## 같은 프로세스 교차 비교

기준은 `49fe1eb`, Node v24.18.0, Windows x64이다. 10,000개의 plain/ASCII 인자 메시지에서 probe 하나를 같은 길이로 변경하고, 기준 파서와 변경 파서를 호출 순서를 교대하며 대조한다. cold는 warmup 5쌍·측정 20쌍, incremental은 warmup 50쌍·측정 100쌍이다. 매쌍 전체 parsed catalog 동등성을 검사한다. 입력 stringify·동등성 검사·디스크·watcher·브라우저는 timing 밖이고 상세 clock 계측·강제 GC는 없다. OS 부하·GC는 통제하지 않았다. 실행 순서는 cold → incremental → cold 재측정 → incremental 재측정이다.

```sh
npm run build --workspace=@0disoft/saylo-core
node benchmarks/live-update/parse-compare.mjs 49fe1eb benchmarks/results/parse-compare-owned-map-cold.json cold
node benchmarks/live-update/parse-compare.mjs 49fe1eb benchmarks/results/parse-compare-owned-map-incremental.json incremental
```

재측정은 같은 명령의 출력 이름에 `-confirm`을 붙여 별도 Node 프로세스에서 실행했다. 단위는 ms, quantile은 nearest-rank이며 차이는 변경−기준이다.

| 모드 | 기준 p50 | 변경 p50 | 기준 p95 | 변경 p95 | 쌍별 차이 중앙값 | 빨라진 쌍 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| cold 최초 | 213.58 | 183.26 | 430.55 | 351.92 | -36.31 | 14/20 |
| incremental 최초 | 58.07 | 45.77 | 123.28 | 86.54 | -10.27 | 79/100 |
| cold 재측정 | 168.93 | 200.40 | 565.77 | 430.53 | -4.05 | 10/20 |
| incremental 재측정 | 50.67 | 41.35 | 99.27 | 85.97 | -8.62 | 82/100 |

편집에서는 두 run 모두 중앙값과 p95가 낮았고 각각 79/100·82/100쌍이 빨랐다. 이를 중복 순회 제거의 편집 경로 근거로 삼아 채택했다. cold 재측정의 p50은 증가했고 개선 쌍은 절반이므로 신규 파싱의 일관된 이득은 확인하지 못했다. 최초 run의 최장 호출도 cold 434.34→486.58ms, incremental 237.79→381.25ms로 늘었다. 재측정 최장값은 낮아졌지만 전체 tail의 안정적 개선이나 종단 간 목표 달성은 주장하지 않는다. 고정 순서·단일 장비·부하 차이가 있어 CPU 시간이나 인과 증명으로도 해석하지 않는다.

## 검증과 원본

- core build, core 테스트 77개, JS/TS consumer 타입 검사 통과.
- parser probe 1개, Vite patch/wire 9개, typegen 5개 테스트 통과. core를 포함해 테스트는 총 92개이며 pack·release·브라우저 검사는 실행하지 않았다.
- 새 회귀 테스트는 빈 맵·복잡한 ICU·literal prototype ID·신규/재사용/위치 변경 메시지의 깊은 불변성, 맵 추가·삭제 거부, 얕게 동결된 이전 카탈로그의 오염 AST를 신뢰하지 않는 동작을 확인한다. 기존 외부 얕은 동결·JSON 중복·ICU 오류 위치·Unicode·schema·snapshot 검사도 유지했다.
- warmup 포함 350쌍 모두 결과 전체 deepEqual이 통과했다. measured 240쌍의 차이·p50/p95/min/max를 원시에서 다시 대조했고, 네 run의 core 5개 코드 hash가 모두 같으며 현재 dist와 일치했다. 임시 parser 디렉터리는 남지 않았다.

원시: [cold 최초](../benchmarks/results/parse-compare-owned-map-cold.json), [cold 재측정](../benchmarks/results/parse-compare-owned-map-cold-confirm.json), [편집 최초](../benchmarks/results/parse-compare-owned-map-incremental.json), [편집 재측정](../benchmarks/results/parse-compare-owned-map-incremental-confirm.json).

로컬 변경이며 npm 게시본에는 아직 반영하지 않았다. 다음은 일반 prebundle·typegen을 유지한 실제 대규모 편집 반영과 로케일 추가의 재측정이다. 버전 변경·push·publish·deploy는 없다.
