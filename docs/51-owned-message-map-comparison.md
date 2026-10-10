# 51. 파서 소유 메시지 맵 최적화의 종단 간 전후 비교

[49](49-owned-message-map-freeze.md)의 맵 동결 최적화를 실제 편집·로케일 추가 경로에서 변경 전 `49fe1eb`와 변경 후 `8046a31`로 교차 실행해 대조했다. 편집과 로케일 추가 모두 pooled p95가 커졌고 성능 목표를 달성하지 못했다. 이 데이터만으로 최적화의 종단 간 이득을 주장하지 않는다.

## 조건과 방법

2026-10-10 KST, Node v24.18.0, Windows x64(10.0.26300), Ryzen 5 7430U, Vite 8.3.2, React 19.3.0 개발 모드, HeadlessChrome 154.0.0.0이다. 10k 메시지×20 로케일·namespace 1개·초기 카탈로그 7755280B이고, 로케일 추가는 라운드마다 파일 1개(10k 메시지)를 더한다. 두 variant의 선택 소스는 `packages/core/src/catalog.ts`·`diagnostics.ts` 둘뿐이며 나머지 제품 소스·entry·wire·버전은 같다.

공통 비교 하네스는 `9289db4`이다. `locale-compare.mjs`가 variant별로 외부 의존성을 junction으로 공유하고 workspace alias를 스냅샷에 연결한 fresh Vite/optimizer/브라우저에서 실행한다. 순서는 before/after/after/before(ABBA), run당 measured 25·warmup 5·control 10이고 `--server-file-stages`만 켠다. pooled quantile은 두 run의 원시 measured 표본을 합쳐 nearest-rank로 계산하며 run p95 평균이 아니다. 표본별 pairing·무작위 배정·강제 GC·부하 통제·control 차감이 없어 인과 증명이 아니다.

```sh
node benchmarks/live-update/locale-compare.mjs --experiment owned-map --mode edit --baseline 49fe1eb --current 8046a31 --server-file-stages --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/owned-map-edit-comparison-2026-10-10.json
node benchmarks/live-update/locale-compare.mjs --experiment owned-map --mode locale-add --baseline 49fe1eb --current 8046a31 --server-file-stages --samples 25 --warmup 5 --calibrations 10 --out benchmarks/results/owned-map-locale-comparison-2026-10-10.json
```

## 종단 간 결과

단위는 ms이고 각 mode·variant의 pooled 원시 measured 표본 50개의 p50/p95다. 선택→commit은 Browser 시계, 나머지는 Node 시계이며 두 시계를 서로 빼거나 구간 quantile을 더하지 않는다.

| 구간 | 변경 전 p50 / p95 | 변경 후 p50 / p95 | 목표 이내 표본 |
| --- | ---: | ---: | --- |
| 편집 저장→DOM ack | 180.34 / 212.52 | 179.73 / 300.98 | ≤100ms: 0/50 → 0/50 |
| 로케일 저장→목록 ack | 186.19 / 309.09 | 189.46 / 704.48 | ≤250ms: 46/50 → 34/50 |
| 로케일 저장→첫 번역 ack | 370.18 / 558.64 | 386.26 / 988.78 | — |
| 선택 준비→첫 번역 ack | 175.62 / 256.47 | 196.40 / 397.83 | — |
| 선택→commit(Browser) | 172.90 / 253.30 | 187.80 / 308.50 | — |

편집 저장→DOM ack와 로케일 저장→목록 ack의 p50은 거의 그대로이고 p95가 커졌다(편집 212.52→300.98, 로케일 309.09→704.48). 로케일 목록의 목표 초과 표본은 4/50→16/50으로 늘었고 편집은 전후 모두 50/50이다. control RTT는 편집 3.12/3.83→3.74/6.66, 로케일 3.15/6.91→3.00/4.44로 서로 엇갈리므로 tail 증가를 control 하나로 설명하지 않는다.

편집 목표(≤100ms)는 전후 모두 0/50, 로케일 목표(≤250ms)는 46/50→34/50으로 달성하지 못한다. 종단 간 개선은 확인되지 않는다. 표본별 pairing·무작위 배정·GC·부하 통제가 없어 tail 악화를 이 최적화의 회귀나 인과로 확정하지 않는다.

## run별 primary p95

run당 measured 25개의 primary 구간 p95다.

| run | variant | 편집 저장→DOM ack | 로케일 저장→목록 ack |
| --- | --- | ---: | ---: |
| 1 | before | 212.52 | 303.42 |
| 2 | after | 225.19 | 704.48 |
| 3 | after | 389.69 | 575.85 |
| 4 | before | 187.95 | 309.09 |

편집 before 두 run은 187.95·212.52, after 두 run은 225.19·389.69로 겹치지 않는다. 로케일도 before 303.42·309.09에 대해 after 704.48·575.85로 두 after run이 모두 크다. 표본 수가 작고 순서·장비가 고정돼 분포 차이의 원인을 가르지 못한다.

## 서버 파일 구간

`--server-file-stages`로 같은 표본에서 읽은 서버 구간 pooled p50/p95다. 구간 p95를 더하거나 CPU 시간으로 해석하지 않는다.

| 구간 | 편집 전 | 편집 후 | 로케일 전 | 로케일 후 |
| --- | ---: | ---: | ---: | ---: |
| readAndCandidate | 55.69 / 68.59 | 46.93 / 148.41 | 104.39 / 208.48 | 106.47 / 446.26 |
| catalogParse | 50.10 / 62.00 | 40.99 / 82.51 | 98.07 / 192.24 | 100.36 / 280.27 |
| fileRead | 1.18 / 3.89 | 1.44 / 13.40 | 1.02 / 2.85 | 0.99 / 127.13 |
| candidateOther | 0.75 / 9.72 | 1.21 / 68.08 | 0.50 / 12.18 | 0.59 / 36.04 |
| pathCheck | — | — | 0.61 / 1.05 | 0.63 / 34.99 |

편집 catalogParse p50은 50.10→40.99로 낮았지만 p95는 커져 서버 파싱의 일관된 향상도 확인하지 못했다. 같은 mode의 readAndCandidate·fileRead p95 역시 커졌다(편집 68.59→148.41, 3.89→13.40). 로케일은 fileRead·pathCheck p95도 크게 늘었다. 긴 종단 간 표본에는 파싱뿐 아니라 파일 읽기와 candidateOther 지연도 포함된다. GC·OS 부하·스케줄링의 영향은 이번 계측으로 구분하지 못한다.

## 검증과 원본

- 별도 검증에서 두 mode 합계 raw 240개 = measured 200 + warmup 40, control 80개를 확인했다. 158개 timing 요약의 count·p50·p95·min·max를 원시에서 다시 계산해 일치했다.
- before/after dist 차이는 정확히 `catalog.js`·`diagnostics.js` 두 개이고 mode 간 공통 hash가 같다. 하네스·현재 dist 36개 unique hash가 일치했다.
- 표본별 path·read·parse 호출이 각 1회, drain 1회이며 fileEvents는 편집 1, 로케일 2~3이다. 임시 benchmark 디렉터리와 전용 브라우저 프로세스는 남지 않았다.
- 하네스 검사를 전 run이 통과했다. 측정 편집 표본은 patch 응답·변경 메시지 1개·position 갱신 0, 로케일은 선택 전 응답 0·선택 후 full 1개(`saylo-catalog-v1`)이다. run별 `typegenEnabled=true`·`declarationRewritten=false`이며 `.d.ts` mtime·size가 그대로다. 브라우저 하네스가 입력 노드·입력값·React state·실제 번역 DOM을 확인하고 로케일은 en 복귀·파일 삭제·목록 제거까지 마쳤다.
- 비교 도구의 구문 검사·변경 범위 정책 테스트 1개·두 mode 스모크가 통과했다. 스모크 수치는 성능 판단에 넣지 않는다. 제품 소스를 추가 변경하지 않아 전체 제품 테스트·pack·release 검사는 반복하지 않았다.

원본 aggregate: 편집 [owned-map-edit-comparison-2026-10-10.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.json), 로케일 [owned-map-locale-comparison-2026-10-10.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.json). run별 결과와 raw 표본은 아래 이름 규칙을 따른다.

| mode | run | variant | 결과 | raw 표본 |
| --- | --- | --- | --- | --- |
| edit | 1 | before | [.1-before.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.1-before.json) | [.samples.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.1-before.10k-20-locales.samples.json) |
| edit | 2 | after | [.2-after.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.2-after.json) | [.samples.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.2-after.10k-20-locales.samples.json) |
| edit | 3 | after | [.3-after.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.3-after.json) | [.samples.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.3-after.10k-20-locales.samples.json) |
| edit | 4 | before | [.4-before.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.4-before.json) | [.samples.json](../benchmarks/results/owned-map-edit-comparison-2026-10-10.4-before.10k-20-locales.samples.json) |
| locale | 1 | before | [.1-before.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.1-before.json) | [.samples.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.1-before.10k-20-locales.samples.json) |
| locale | 2 | after | [.2-after.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.2-after.json) | [.samples.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.2-after.10k-20-locales.samples.json) |
| locale | 3 | after | [.3-after.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.3-after.json) | [.samples.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.3-after.10k-20-locales.samples.json) |
| locale | 4 | before | [.4-before.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.4-before.json) | [.samples.json](../benchmarks/results/owned-map-locale-comparison-2026-10-10.4-before.10k-20-locales.samples.json) |

## 다음

[49](49-owned-message-map-freeze.md)의 최적화 채택은 이번 결과까지 포함해 잠정 상태로 두고, 이 데이터만으로 자동 원복하지 않는다. 다음은 read/candidate의 긴 표본과 GC·스케줄링 영향만 좁게 계측해 tail과 남은 candidate 비용의 원인을 가르는 것이며, 같은 broad benchmark를 반복하지 않는다.

로컬 기록이며 버전 변경·push·publish·deploy는 없다.

read/candidate 잔여 구간과 GC·타이머 지연을 좁게 계측한 후속 진단은 [52-server-runtime-tail.md](52-server-runtime-tail.md)에 있다.
