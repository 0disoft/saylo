# 50. 메시지 맵 동결 최적화 뒤 실제 갱신 측정

`8046a31`의 대규모 편집·로케일 추가를 실제 Vite watcher와 headless 브라우저로 재측정했다. 편집 저장→DOM ack p95는 **453.15ms**, 로케일 저장→목록 ack p95는 **629.54ms**로 목표 100ms·250ms를 넘었다. [49](49-owned-message-map-freeze.md)의 파서 비교 이득이 이번 종단 간 실행에서도 나타났다고 판단할 근거는 없다.

## 조건

2026-10-10 KST, Node v24.18.0, Windows x64(10.0.26300), Ryzen 5 7430U, Vite 8.3.2, React 19.3.0 개발 모드, HeadlessChrome 154.0.0.0이다. 10k 메시지×20 로케일·namespace 1개·초기 카탈로그 7755280B이며 mode별 warmup 5·측정 50·control 25·timeout 30s다. 부하·GC는 통제하지 않았다.

앞선 core 검증과 같은 dist 5개 hash를 확인해 build를 재사용했다. 제품·하네스 소스는 바꾸지 않았다. [46](46-review-fixes-server-file-stages.md)과 같은 `--server-file-stages`만 켜고 CPU·브라우저·reply·client 상세 계측은 껐다. typegen·일반 prebundle은 유지했다. edit → locale-add를 별도 프로세스에서 순차 실행했고 각 mode는 한 run이다.

```sh
node benchmarks/live-update/run.mjs --mode edit --scenario 10k-20-locales --server-file-stages --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/owned-map-2026-10-10-edit-server-files.json
node benchmarks/live-update/run.mjs --mode locale-add --scenario 10k-20-locales --server-file-stages --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/owned-map-2026-10-10-locale-add-server-files.json
```

## 측정 결과

아래는 ms 단위 p50/p95다. Node와 Browser 시계는 별도이며 단계 quantile을 더하거나 control을 빼지 않는다.

| 구간 | p50 | p95 | 목표 이내 표본 |
| --- | ---: | ---: | --- |
| 편집 저장→DOM ack (Node) | 165.82 | 453.15 | ≤100ms: 0/50 |
| 로케일 저장→목록 ack (Node) | 163.97 | 629.54 | ≤250ms: 45/50 |
| 로케일 저장→첫 번역 ack (Node) | 349.00 | 964.56 | — |
| 선택 준비→첫 번역 ack (Node) | 176.85 | 406.32 | — |
| setLocale 직전→번역 commit (Browser) | 173.90 | 360.50 | — |

| 내부 구간 p50/p95 | 편집 | 로케일 추가 |
| --- | ---: | ---: |
| queueToDrain | 48.27 / 58.85 | 49.32 / 55.58 |
| readAndCandidate | 43.91 / 154.01 | 86.85 / 387.83 |
| catalogParse (candidate 안) | 39.83 / 121.63 | 79.91 / 337.04 |
| fileRead (candidate 안) | 1.42 / 31.00 | 0.94 / 4.66 |
| candidateOther (표본별 잔여) | 0.68 / 16.72 | 0.49 / 19.45 |
| translationPreparation | 12.19 / 29.50 | 7.75 / 17.46 |
| registryReplace | 7.02 / 19.37 | 0.08 / 0.15 |
| catalogDelta | 17.87 / 77.80 | 0 / 0 |
| control RTT | 3.57 / 4.47 | 4.31 / 8.42 |

catalogParse는 각 mode의 50/50 표본에서 읽기·후보 하위 네 구간 중 가장 컸다. 전체 응답의 최대 구간이나 CPU 비중이라는 뜻은 아니다. 로케일 추가의 수집 phase는 파일 추가→목록 ack이며, catalogDelta 0은 최초 선택의 full 응답이 이 phase 밖이라는 뜻이다.

이전 46의 같은 설정 p95는 편집 182.64ms·목록 389.94ms였다. 이번 값은 더 크지만 두 코드를 같은 시기에 교차 실행한 비교가 아니다. 바꾸지 않은 구간도 달라졌다. 예를 들어 편집 fileRead p95는 1.36→31.00ms, catalogDelta는 21.22→77.80ms이고 control도 두 mode 모두 증가했다. 원인을 코드 회귀·GC·OS 부하 중 하나로 확정하거나 control 차감으로 보정하지 않는다. 파서 미시 비교와 이번 결과를 합쳐 일반적인 화면 반영 향상을 주장하지 않는다.

## 검증과 다음

- measured 100·warmup 10·control 50개를 확인했다. 33개 timing 요약의 p50/p95/min/max를 원시에서 재계산해 일치했고 wire byte 요약도 대조했다.
- 36개 unique 코드 hash가 현재 dist·하네스와 일치하고 mode 간 같았다. 46 대비 차이는 core의 `catalog.js`·`diagnostics.js` 두 개뿐이다.
- 110개 raw 표본 모두 path·read·parse 호출이 각 1회이고 후보 window의 네 구간 분해가 일치했다. drain은 각 1회다.
- 브라우저 하네스가 입력 노드·입력값·React state와 실제 번역 DOM을 확인했다. `.d.ts`의 mtime·size는 그대로였다. 측정 편집은 patch 50·full 0·upsert 1·position 갱신 0이며, 로케일 추가는 선택 전 응답 0·선택 후 compact full 50이다. en 복귀·파일 삭제·목록 제거도 완료했다.
- 임시 benchmark 디렉터리와 전용 Chrome/Edge 프로세스가 남지 않았다. 제품 입력이 같아 build·제품 테스트·pack·release는 반복하지 않았다.

변경 전 `49fe1eb`와 변경 후 `8046a31`의 종단 간 대조는 [51](51-owned-message-map-comparison.md)에 기록했다. `locale-compare.mjs`에 두 소스 변경에 맞는 `owned-map` 비교 범위를 추가해 편집·로케일 추가를 같은 하네스·의존성으로 교차 실행했고, 두 mode 모두 pooled p95가 커져 목표를 달성하지 못했다. 이번 측정만으로 최적화를 되돌리거나 새로운 브라우저 병목을 확정하지 않는다.

원본: [편집 결과](../benchmarks/results/owned-map-2026-10-10-edit-server-files.json), [편집 raw](../benchmarks/results/owned-map-2026-10-10-edit-server-files.10k-20-locales.samples.json), [로케일 결과](../benchmarks/results/owned-map-2026-10-10-locale-add-server-files.json), [로케일 raw](../benchmarks/results/owned-map-2026-10-10-locale-add-server-files.10k-20-locales.samples.json).

버전 변경·push·publish·deploy는 없다.
