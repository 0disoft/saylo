# 45. 리뷰 수정 기준 성능 측정

2026-10-10(KST) 리뷰 수정 커밋 `9cfb844`의 현행 성능 기준값을 기존 브라우저 하네스로 측정했다. 편집 반영과 로케일 추가는 각각 단일 run이고 시나리오별로 50회를 측정했으며, small(1k×3)·large(10k×20) 두 규모를 다룬다. 목표는 [06](06-validation-and-roadmap.md)의 개발 중 수정 p95 ≤ 100ms와 로케일 목록 p95 ≤ 250ms다.

## 환경과 조건

- 기준 revision `9cfb84463cedac88a10efdd32d9cc113910f9169`, KST 2026-10-10. edit run의 working tree는 깨끗했고, locale-add run은 edit 산출물 3개를 untracked로 기록했다.
- Node v24.18.0, Windows x64(10.0.26300), AMD Ryzen 5 7430U(논리 12), 메모리 31.3GiB, Vite 8.3.2. 브라우저는 HeadlessChrome 154.0.0.0, React 19.3.0 개발 모드이고 native headless 실제 DOM을 쓴다. paint timing은 없다.
- 시나리오당 1회 실행이고 순서는 small-edit → large-edit → small-add → large-add로 고정했다. OS 부하와 GC는 통제하지 않았다.
- 설정은 samples 50·warmup 5·calibrations 25·timeout 30s다. cpu·browser-stages·server-file-stages·reply-stages·client-stages 계측은 모두 끄고, 편집 모드의 기본 서버 prototype stage wrapper만 켰다.
- typegen과 일반 prebundle은 켠 상태다. 두 run 모두 `declarationRewritten: false`이고 생성 `.d.ts`의 mtime·size 변동은 0이다.
- 시나리오는 namespace 1개, 메시지 1k×3과 10k×20이다. 전체 규모 조합 cross matrix가 아니다.
- 실행은 `npm run build` 1회 뒤 `node benchmarks/live-update/run.mjs --mode edit --scenario all --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/review-fixes-2026-10-10-edit.json`, 이어서 같은 옵션에서 `--mode locale-add --out benchmarks/results/review-fixes-2026-10-10-locale-add.json`으로 바꾼 run이다.
- `save`는 파일 쓰기 완료 시점이고, `ack`는 브라우저가 DOM commit을 확인한 뒤 보낸 HTTP 응답을 Node가 받은 시점이다. 파일 쓰기 시간은 별도 기록하며, 종단 간 값에 포함된 ack 전달 비용에서 control 값을 빼지 않는다.

## 편집 반영 (save → DOM ack)

이 문서 표의 수치는 모두 ms다.

| 시나리오 | p50 | p95 | min | max | p95 목표 100ms |
| --- | --- | --- | --- | --- | --- |
| small 1k×3 | 70.07 | 80.08 | 59.12 | 99.04 | 목표 내 |
| large 10k×20 | 174.58 | 398.73 | 107.95 | 718.93 | 초과 |

두 규모 모두 50회 응답이 patch이고 full은 0회다. 응답 크기 p50/p95는 small 929B, large 934B다. small은 목표 안, large는 초과다.

## 로케일 추가

Node의 save→목록 ack, select-ready→번역 ack, save→번역 ack는 같은 Node monotonic clock이다. Browser setLocale→commit만 별도 clock이다. 서로 다른 clock끼리 빼지 않고, 개별 p95를 더하지 않는다.

| 시나리오 | save → 목록 ack p50/p95 | Node select-ready → 번역 ack p50/p95 | Browser setLocale → commit p50/p95 | 목록 p95 목표 250ms |
| --- | --- | --- | --- | --- |
| small 1k×3 | 122.61 / 251.27 | 31.82 / 62.95 | 28.20 / 46.40 | 초과 |
| large 10k×20 | 207.70 / 627.48 | 185.50 / 275.34 | 182.60 / 272.00 | 초과 |

선택 전 target 카탈로그 응답은 0회이고 선택 뒤 매회 full 1개다. 참고로 저장 → 최초 번역 ack(Node)는 small 161.12/297.57, large 430.91/772.91이다. small 목록도 p95 251.27ms로 목표를 넘는다.

## control과 서버 단계 (참고)

- control round trip(25회)은 별도 값이다. small-edit 4.55/10.91, large-edit 3.71/5.12, small-add 3.79/6.44, large-add 3.93/5.93(p50/p95 ms). 단계 p95에 더하거나 빼지 않는다.
- large 편집의 server 단계 후보는 readAndCandidate p95 236.35ms이고, 브라우저 receive → commit p95는 44.0ms다. readAndCandidate 경계에는 직렬 drain 대기·경로 검사·read·parse·candidate 필터·base stat이 섞여 있어 CPU 파서 병목으로 확정하지 않는다. 단계 p95는 더하지 않는다.

## 검증

- raw는 measured 200·warmup 20·control 100으로 완비됐다.
- 22개 summary metric의 p50/p95/min/max를 raw에서 nearest-rank로 재계산해 일치했고, control 4개 summary도 재계산과 일치했다.
- 36개 unique code hash가 현재 `dist`·하네스와 일치했고 mode 간 같았다.
- 목표 내 샘플 수는 small-edit 50/50, large-edit 0/50, small-list 47/50, large-list 35/50이다.
- 임시 benchmark 디렉터리 0개, 전용 Chrome 프로세스 0개를 확인했다.
- product·harness 소스는 바꾸지 않았다. 수행한 build와 하네스는 exit 0이고, 별도 전체 `test`·`check`는 이번 범위가 아니다.

## 한계와 다음

- 단일 run·고정 순서·native headless 측정이고 OS 부하와 GC를 통제하지 않았다.
- startup·boot는 시나리오당 단일 관측이며 typegen 생성 시간은 따로 재지 않았다.
- 최초 번역은 매회 en-GB 카탈로그를 새로 추가한 뒤 최초 전환을 측정했다. 재방문 cache·heap·selector 효과는 재지 않았다.
- fixture가 `useI18n`을 쓰므로 여기서 `useI18nSelector`의 렌더 감소 효과를 주장하지 않는다.
- 과거 측정과 직접 인과 비교하지 않고, Paraglide 현재 우열도 주장하지 않는다.
- 다음은 readAndCandidate의 읽기·후보 대기 구간을 나눠 재는 것과, selector 렌더 횟수·캐시 heap 비용을 별도 후속으로 두는 것이다.

## 원본

- 결과·설정: [edit JSON](../benchmarks/results/review-fixes-2026-10-10-edit.json), [locale-add JSON](../benchmarks/results/review-fixes-2026-10-10-locale-add.json)
- raw 표본: [edit 1k](../benchmarks/results/review-fixes-2026-10-10-edit.1k-3-locales.samples.json), [edit 10k](../benchmarks/results/review-fixes-2026-10-10-edit.10k-20-locales.samples.json), [add 1k](../benchmarks/results/review-fixes-2026-10-10-locale-add.1k-3-locales.samples.json), [add 10k](../benchmarks/results/review-fixes-2026-10-10-locale-add.10k-20-locales.samples.json)
