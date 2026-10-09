# 46. 리뷰 수정 기준 서버 파일 구간 계측

2026-10-10(KST) large(10k×20)의 읽기·후보 구간을 분리 계측했다. 기존 `--server-file-stages` 옵션을 그대로 쓰고 제품·하네스 소스는 바꾸지 않았다. 기준 revision은 `abc1e0e5a1900493348edca73b32b70f69347459`이고 `src`는 `9cfb844`와 같다.

## 환경과 조건

- KST 2026-10-10, Node v24.18.0, Windows x64(10.0.26300), AMD Ryzen 5 7430U(논리 12), 메모리 31.3GiB, Vite 8.3.2, React 19.3.0 개발 모드, HeadlessChrome 154.0.0.0이다.
- 시나리오는 large 10k×20, namespace 1개, 카탈로그 7755280B다. samples 50·warmup 5·calibrations 25·timeout 30s.
- `--server-file-stages`만 켜고 cpu·browser-stages·reply-stages·client-stages는 껐다. typegen과 일반 prebundle은 켠 상태이고 `.d.ts`의 mtime·size는 변하지 않았다.
- 기존 빌드의 36개 hash를 대조해 재사용했다. 순서는 edit → locale-add로 고정했고 mode별 single run이며 부하·GC는 통제하지 않았다.
- 실행은 직전 기준값 측정의 빌드를 재사용한 뒤 `node benchmarks/live-update/run.mjs --mode edit --scenario 10k-20-locales --server-file-stages --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/review-fixes-2026-10-10-edit-server-files.json`, 이어서 같은 옵션에 `--mode locale-add`와 `--out benchmarks/results/review-fixes-2026-10-10-locale-add-server-files.json`을 준 run이다. 이번에 `npm run build`는 실행하지 않았다.

## 서버 파일 구간 (large 10k×20)

표의 수치는 ms다. pathCheck·fileRead·catalogParse·candidateOther는 readAndCandidate 안에 포함되므로 p95를 더하지 않고 wall time을 CPU 시간으로 보지 않는다.

| 구간 | edit p50 | edit p95 | locale-add p50 | locale-add p95 |
| --- | --- | --- | --- | --- |
| readAndCandidate | 38.95 | 57.48 | 88.97 | 282.45 |
| pathCheck | 0.60 | 0.83 | 0.58 | 1.30 |
| fileRead | 1.00 | 1.36 | 0.99 | 6.68 |
| catalogParse | 35.28 | 47.62 | 87.20 | 280.54 |
| candidateOther | 0.53 | 8.61 | 0.51 | 14.47 |

catalogParse는 edit p50/p95 35.28/47.62ms, locale-add 87.20/280.54ms다. 나머지 구간은 작고, candidateOther는 readAndCandidate 안의 표본별 잔여다.

## 별도 구간 (참고)

| 구간 | edit p50/p95 | locale-add p50/p95 |
| --- | --- | --- |
| queueToDrain | 47.58 / 52.61 | 46.02 / 55.48 |
| translationPreparation | 9.45 / 12.94 | 7.10 / 11.78 |
| registryReplace | 6.00 / 8.32 | 0.07 / 0.13 |
| catalogDelta | 13.76 / 21.22 | 0 / 0 |
| receive → commit (Browser) | 28.30 / 34.50 | — |
| setLocale 직전 → commit (Browser) | — | 156.20 / 290.90 |
| control RTT (Node, 25회) | 2.84 / 3.59 | 3.22 / 3.60 |

locale-add의 catalogDelta 0은 값이 싸다는 뜻이 아니라 최초 선택의 full 응답이 profiledPhase 밖이라는 뜻이다. profiledPhase는 파일 추가 → 목록 ack 구간이다. Node 내부 서버 단계는 `performance.now`의 각 함수 시작/종료이고 파일 쓰기 resolved → DOM ACK 수신이라는 일괄 시계 창이 아니며, 그 종단간 값은 별도다. Browser clock은 Node clock과 별개이고 control을 빼지 않으며 단계 p95를 합산하지 않는다. locale의 setLocale 직전 → commit 값에는 전송·로딩이 포함된다.

## 관측 요약

- 개별 파싱(catalogParse)이 표본 50/50에서 edit·locale-add 양쪽 가장 큰 구간이다.
- 총 지연은 edit save → DOM ack p95 182.64ms(목표 100 초과), locale 목록 p95 389.94ms(목표 250 초과)다.
- 45의 398.73ms·627.48ms보다 낮지만 같은 소스에 계측 차이와 단일 run이 겹쳐 성능 개선 근거가 아니다.
- parse의 CPU 시간·GC가 원인이라는 확정은 하지 않는다. candidate 잔여도 조건에 따른 측정 잔여이고 base stat·queue 등 세부 원인을 구분하지 않는다.

## 검증

- raw는 measured 100·warmup 10·control 50이다.
- 33개 metric summary(overall 11·server 12·file 8·control 2)의 p50/p95/min/max를 raw에서 nearest-rank로 재계산해 전부 일치했다.
- 36개 unique code hash가 현재 `dist`·하네스와 일치하고 mode 간 같았다.
- 100개 표본 모두 path·read·parse 호출이 각 1회이고, candidate window가 path+read+parse+잔여 분해와 일치했다.
- parse가 가장 큰 개별 구간인 표본은 edit 50/50·locale 50/50이다. 표본별 parse/candidate window 비율(전체 응답 시간이나 CPU 비율이 아님)은 edit min 69.40%·p50 93.84%·max 95.19%, locale min 82.20%·p50 97.42%·max 99.79%다.
- `.d.ts`는 다시 쓰이지 않았다. edit는 patch 50·full 0·changed 1, locale은 선택 전 응답 0·선택 후 full 50이다. max drain은 둘 다 1이고 max file event는 edit 1·locale 2다.
- 임시 benchmark 디렉터리 0개, 전용 Chrome 프로세스 0개를 확인했고 제품·하네스 소스는 바꾸지 않았다.

## 한계와 다음

- 단일 run·고정 순서이고 부하·GC를 통제하지 않았다. wall time이지 CPU 시간이 아니며 단계 p95를 더하지 않는다.
- 다음은 미시 파서 하네스로 반복 순회·객체 생성 비용을 줄일 최소 후보를 찾는 것이다. 11의 키 디코딩 실험과 37·40·41처럼 이미 되돌린 후보는 근거가 없으면 다시 넣지 않고, 구체 후보나 성능 이득을 여기서 확정하지 않는다.
- JSON·파서 계약은 유지한다. 정확한 후보는 소스를 읽기 전에 확정하지 않는다. selector·heap 최적화는 이번에 재지 않았다.

## 원본

- 결과·설정: [edit JSON](../benchmarks/results/review-fixes-2026-10-10-edit-server-files.json), [locale-add JSON](../benchmarks/results/review-fixes-2026-10-10-locale-add-server-files.json)
- raw 표본: [edit 10k](../benchmarks/results/review-fixes-2026-10-10-edit-server-files.10k-20-locales.samples.json), [add 10k](../benchmarks/results/review-fixes-2026-10-10-locale-add-server-files.10k-20-locales.samples.json)
