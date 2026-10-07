# 27. 깊은 동결 경로 공유 후 로케일 추가 재측정

일반 prebundle 설정에서 목록 표시 p95는 small 112.42ms·large 621.18ms였다. large는 250ms 목표를 넘었고, 첫 번역 선택 p95도 이전 일반 설정 run보다 높게 관측돼 전체 개선을 확인하지 못했다.

## 실행과 조건

측정 revision은 `7a27b043bf71262d7a1e74e08ed24b8e18ec1fdc`이고 시작 시 작업 트리는 깨끗했다. 직전 구현에서 빌드·검증한 dist를 재사용했다. 실제 로드한 코드 hash는 [검증된 동결 공유 run](../benchmarks/results/locale-add-shared-freeze-after.json) 및 현재 파일과 일치한다. 이번 작업에서는 결과와 문서만 변경했다.

```sh
node benchmarks/live-update/run.mjs --mode locale-add --scenario all --samples 50 --warmup 5 --calibrations 25 --out benchmarks/results/locale-add-shared-freeze.json
```

2026-10-07 KST, Node 24.18.0, Windows x64, Ryzen 5 7430U, Vite 8.3.2, React 19.3.0, HeadlessChrome 154에서 실행했다. 환경·브라우저·fixture·설정은 [이전 일반 설정 run](../benchmarks/results/locale-add-position-pool.json)과 같다. typegen·기본 dependency prebundle은 켜고 CPU·브라우저·서버 파일 상세 계측은 껐다. 기본 prebundle에는 Saylo core·React와 ReactDOM이 포함된다. prebundle을 끈 [26번 10회 계측](26-shared-catalog-freeze.md)과 시간을 직접 비교하지 않는다. 전송·DOM 상태는 계속 확인하며 상세 단계 필드는 내보내지 않는다.

규모별 warmup 5·측정 50·control 왕복 25회이다. 원시는 총 110개 고유 토큰이고 측정은 100회이다. namespace는 `bench` 하나이다. small은 초기 3개 파일·로케일, 파일당 1,000개 메시지, JSON 합 110,292 B이며 추가 파일은 36,781 B이다. large는 초기 20개 파일·로케일, 파일당 10,000개 메시지, JSON 합 7,755,280 B이며 추가 파일은 387,783 B이다.

매회 새 en-GB 디렉터리와 JSON 한 파일을 추가한다. 목록 DOM 확인 뒤 자동 선택하고 첫 번역 확인 후 en으로 복귀한다. 파일·빈 디렉터리·목록 항목 제거를 기다린 같은 baseline에서 다음 회차를 시작한다. 앱과 기존 formatter는 warm이고 새 카탈로그·probe formatter는 최초 로딩이다. 디렉터리 생성은 저장 지연에서 제외한다. 단일 장비·namespace·probe 메시지의 개발 모드 DOM commit이며 paint·전체 메시지 렌더·마우스 입력 지연·cold startup은 범위 밖이다.

저장→목록 ack는 Node의 writeFile 완료부터 목록 DOM ack body 수신까지이다. 선택 준비→번역 ack는 Node의 제어 요청 수신부터 번역 ack까지이며 제어 응답·ack 비용을 포함한다. 저장→번역 ack도 같은 Node clock의 종단 간 구간이다. 선택→commit은 브라우저 setLocale 직전부터 useLayoutEffect가 번역 DOM·select 값을 확인한 시점까지이다. 서로 다른 clock이나 control 비용을 빼지 않고 p95끼리 더하거나 GC를 차감하지 않는다. nearest-rank 50회 p95는 정렬한 48번째 값이다. 초기 준비 시간은 warm 측정과 구분한다.

## 결과

시간의 단위는 ms이다.

| 지표 | 소 p50 | 소 p95 | 대 p50 | 대 p95 |
|---|---|---|---|---|
| saveToListAck | 85.87 | 112.42 | 304.70 | 621.18 |
| selectToTranslationAck | 36.17 | 78.16 | 317.43 | 635.00 |
| saveToTranslationAck | 125.36 | 202.73 | 629.00 | 2067.43 |
| selectToCommit | 33.00 | 74.20 | 312.80 | 631.70 |
| saveToBroadcast | 80.65 | 106.09 | 286.91 | 605.09 |
| fileWrite | 6.04 | 8.80 | 9.46 | 14.12 |
| 대조 왕복 | 3.69 | 6.14 | 3.71 | 9.20 |

시작 시간(워밍 제외): serverStartup 소 569.60ms, 대 9463.79ms. browserBoot 소 4599.15ms, 대 9112.99ms.

목록 250ms 이내는 소 50/50, 대 9/50. 대규모 목록 min 196.48/max 1825.15ms, 선택 min 182.60/max 2791.00ms. 저장→첫 번역 ack 대규모 p95 2067.43ms, max 3162.28ms.

Wire: reply JSON p95 소 119641B, 대 1241398B. 직렬화된 JSON 프레임 바이트이며 실제 네트워크 바이트나 압축 크기가 아니다.

## 해석

| p95 | 현재 소 | 이전 소 | 현재 대 | 이전 대 |
|---|---|---|---|---|
| 목록 | 112.42 | 109.68 | 621.18 | 878.98 |
| 선택 | 74.20 | 48.00 | 631.70 | 486.80 |

small 목록은 이번 run에서 목표를 충족했고 large는 미달이다. [23](23-position-sharing-locale-add.md)보다 large 목록 p95는 낮게 관측됐지만 250ms 이내 횟수는 15/50→9/50으로 줄고 최장 시간은 커졌다. 선택 p95도 두 규모에서 높게 관측돼 전체 흐름의 일관된 개선을 확인하지 못했다. 첫 로케일 선택은 별도 지표이며 문자열 편집 반영의 100ms 목표를 적용하지 않는다.

기본 설정·환경·fixture는 같지만 이전 harness에는 현재의 계측 끔 begin/finish 호출과 ack 검증 지원이 없었다. 무작위 전후 반복 비교가 아니고 실행 부하도 분리하지 못했으므로 시간 차이 전체를 동결 공유에 귀속하지 않는다. 동결 공유의 재순회 제거는 [26](26-shared-catalog-freeze.md)에서 확인했지만 이번 run에는 상세 단계 시간이 없다. 긴 표본도 원시에 유지했고 지연 원인을 GC나 네트워크로 확정하지 않는다.

## 검증과 다음 작업

규모별 raw 55회 모두 선택 전 target 응답 0개, 선택 후 `saylo-catalog-v1` compact full 응답 1개였다. 측정 100회도 같은 조건을 유지했다. 생성 `.d.ts`의 mtime·크기, 입력 DOM 노드·값·React 상태를 유지했고 리로드 없이 복귀·삭제를 완료했다. 6개 시간 지표와 control 요약을 원시에서 재계산해 개수·토큰 고유성·warmup 플래그·wire 바이트·현재 hash를 대조했다.

제품·dist·harness 입력이 바뀌지 않아 이전 workspace 테스트·consumer 타입 검사·build·release check·독립 pack 검증 결과를 재사용했다. 이 검증들은 이번 작업에서 반복하지 않았다. 임시 fixture·profile과 benchmark browser process가 남지 않았음을 확인했다. 문서의 로컬 링크·코드 블록·40KB 이하 크기와 `git diff --check`도 확인했다.

결과는 [요약](../benchmarks/results/locale-add-shared-freeze.json), [small 원시](../benchmarks/results/locale-add-shared-freeze.1k-3-locales.samples.json), [large 원시](../benchmarks/results/locale-add-shared-freeze.10k-20-locales.samples.json)에 보존한다.

이번 작업에서 버전 변경·푸시·게시·배포는 하지 않았다.

다음은 기본 prebundle을 유지한 large 첫 선택 구간 계측이다. 먼저 서버 full 응답 생성·인코딩 경계를 추가하고, 브라우저 수신 이후→DOM commit 구간을 별도로 기록한다. 프로세스별 clock을 유지하며 결과에 따라 후속 최적화 대상을 정한다.
