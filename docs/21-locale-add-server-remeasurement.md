# 21. 현행 파서의 로케일 추가 서버 계측

2026-10-07 KST, 현행 코드로 대규모 로케일 추가의 서버 구간을 재계측했다. 10회 모두 수집한 개별 구간 중 카탈로그 파싱이 가장 오래 걸렸다. 파싱 p50은 191.37ms, 번역 준비는 13.06ms, 최종 검증은 0.04ms였다. 제품 코드와 계측기는 변경하지 않았다.

## 실행과 범위

```sh
node benchmarks/live-update/run.mjs --mode locale-add --server-file-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-ast-freeze-server-files.json
```

직전 작업에서 빌드한 dist를 그대로 사용했다. 측정 revision은 `95d2c9807baf15bb80658a87bb40a221eb5460a5`이며 시작 시 작업 트리는 깨끗했다. 제품 코드는 단순 메시지 파싱·compact 전송·인자 스키마 공유·AST 동결 최적화를 포함한다. 기록된 코드 SHA-256을 현행 dist·측정 코드·lockfile과 대조했다.

이전 [14번 계측](14-locale-add-server-measurements.md)과 같은 large fixture·옵션이다. 초기 10k 메시지×20개 로케일·20개 파일·JSON 7,755,280 B, namespace 하나이다. 매회 새 en-GB 디렉터리와 10,000개 메시지·387,783 B의 정상 번역 JSON 한 파일을 추가한다. warmup 2회·측정 10회·control 왕복 10회이다. typegen과 기존 dependency prebundle을 켜고 CPU profiler·브라우저 상세 계측은 끈다.

Node 24.18.0, Windows x64, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U, memory 31.3GiB 환경이다. [요약](../benchmarks/results/locale-add-ast-freeze-server-files.json)과 [12회 원시 표본](../benchmarks/results/locale-add-ast-freeze-server-files.10k-20-locales.samples.json)을 보존한다. nearest-rank 통계이며 표본 10회의 p95는 최대값이다.

계측은 기존 prototype wrapper·Node module hook으로 저장 직전부터 목록 DOM ack까지 수집한다. 이후 언어 선택·full 응답·en 복귀·삭제는 서버 sample에서 제외한다. readAndCandidate는 drain 진입부터 번역 준비 진입까지이며 경로 검사·읽기·파싱과 잔여 작업을 포함한다. 파싱은 parseCatalog 동기 호출과 인자 구성의 wall time이다. 번역 준비에는 schema 조회·새 번역 검증·격리 준비가 들어가고 최종 active 검증과 구분한다. 경로 검사·읽기는 비동기 wall time이다.

## 결과

| 항목 | p50(ms) | p95(ms) |
| --- | --- | --- |
| 저장→목록 DOM ack | 330.19 | 1,092.85 |
| 저장→manifest broadcast | 311.03 | 1,056.37 |
| 선택→첫 번역 commit(브라우저) | 306.10 | 548.80 |
| 선택 준비→첫 번역 ack(Node) | 309.53 | 815.26 |
| control 왕복 | 4.30 | 7.17 |
| queue→drain | 60.30 | 106.40 |
| readAndCandidate(파일 구간 포함) | 227.99 | 968.97 |
| 경로 검사 | 2.84 | 15.08 |
| UTF-8 읽기 | 6.29 | 94.66 |
| 카탈로그 파싱 | 191.37 | 960.89 |
| candidate 잔여 | 3.96 | 27.41 |
| 번역 준비·검증 | 13.06 | 20.27 |
| 최종 active 검증 | 0.04 | 0.08 |
| registry replace | 0.13 | 0.79 |

매 sample에서 파싱/readAndCandidate 비중을 계산하면 최소 65.76%·중앙 85.52%·최대 99.17%였다. 이는 candidate 구간 안의 wall time 비중이며 전체 저장→목록 지연이나 CPU 사용률이 아니다. 중첩 지표의 p95를 합산하지 않는다. GC·스케줄링 지연은 분리하지 않았으며 파싱 tail을 특정 원인으로 단정하지 않는다.

이번 run에서 목록 250ms 이내는 0/10회였고 최소도 307.32ms였다. 선택 준비 ack와 브라우저 commit은 서로 다른 clock·완료 지점이며 Node 제어 응답·ack 비용이 포함되므로 값을 직접 빼지 않는다. 목록 ack까지의 서버 계측에서 catalogDelta가 0인 것은 선택 후 full 응답 비용이 없다는 뜻으로 사용하지 않는다.

최종 검증은 `LiveRegistry.validated`의 catalog/fingerprint 성공 기록을 재사용한다. 새 번역 검증은 앞선 번역 준비에 포함되므로 0.04ms를 전체 번역 검증 비용으로 해석하지 않는다.

## 확인한 동작과 한계

원시 12회 중 warmup 2회를 제외한 10회의 timing·control·바이트 요약, 고유 token·호출 수·sample별 candidate 잔여와 코드 hash를 대조했다. 모든 회차에서 drain 1회, 경로 검사·읽기·파싱 각 1회, 파일 이벤트 2회였다. 측정 10회 모두 선택 전 target 카탈로그 응답 0개, 선택 후 baseline 없는 compact full 응답 1개였다. 응답 객체 JSON p95는 1,241,400 B이며 물리 네트워크 총 바이트가 아니다.

실제 브라우저에서 목록 추가·언어 선택·삭제 뒤 input node·입력값·React 상태를 유지했고 document reload 없이 baseline으로 복귀했다. 생성 `.d.ts`의 mtime·size도 유지됐다. 종료 후 owned 임시 fixture/profile 디렉터리와 benchmark browser process는 남지 않았다. 제품·계측 코드 변경이 없어 전체 테스트·consumer 타입 검사·build·release check·pack은 반복하지 않았다.

이전 14번 run과 fixture·옵션은 같지만 중간 제품 변경과 부하 차이가 있어 시간 차이를 한 변경에 귀속하지 않는다. 직전 [계측 없는 50회 run](20-locale-add-remeasurement.md)의 large 목록 p95 1,056.40ms와도 sample 수·계측·부하가 다르므로 직접 전후 비교하지 않는다. 여러 namespace·잘못된 번역·전체 메시지 렌더·cold startup·paint는 이번 범위 밖이다. large의 250ms 목표는 여전히 미달이다.

## 다음 구현 후보

최종 검증과 registry 교체보다 cold 파서의 객체 생성·동결 비용을 우선 줄인다. [19번 내부 계측](19-ast-freeze-measurements.md)과 현행 코드에서 단순 AST의 상대 위치 객체가 반복 생성·동결되는 경로를 확인했다. 다음 후보는 한 파싱 호출 안에서 동일한 상대 위치 값을 공유하는 실험이다. 카탈로그의 절대 소스 위치, Unicode offset/line/column, ICU 오류 위치와 깊은 불변성을 유지하고, 별도 교차 비교로 효과를 확인한 뒤 채택한다. 이번 작업에서는 해당 최적화를 구현하지 않았다.
