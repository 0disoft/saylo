# 14. 로케일 추가 서버 비용 측정

이 문서는 파서 최적화 전 계측 기록이다. 현행 코드의 같은 fixture·옵션 재계측은 [21-locale-add-server-remeasurement.md](21-locale-add-server-remeasurement.md)에 있다.

2026-10-07 기존 서버 계측을 로케일 추가 모드에 연결했다. 대규모 10회에서 목록 표시 p95는 1,808.23ms로 250ms 목표를 넘었다. 수집한 각 구간 중 새 카탈로그 파싱이 매회 가장 오래 걸렸으며 다음 최적화 대상이다. 이번 변경은 benchmark에만 있으며 제품 source·dist를 수정하지 않았다.

## 실행과 조건

```sh
node benchmarks/live-update/run.mjs --mode locale-add --server-file-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-server-files.json
```

Node 24.18.0·Windows x64·Vite 8.3.2·React 19.3.0·HeadlessChrome 154에서 warmup 2·측정 10·control 10을 실행했다. 초기 메시지 10k×20개 로케일(20개 파일·7,755,280 B), namespace 1개이고 매 회차 새로운 en-GB 디렉터리와 bench.json 한 개를 추가한다. 추가 파일은 10,000개 메시지·387,783 B다. schema와 기존 파일은 바꾸지 않는다.

원시 수치는 [요약 결과](../benchmarks/results/locale-add-server-files.json)와 [12회 sample](../benchmarks/results/locale-add-server-files.10k-20-locales.samples.json)에 있다. warmup 2회는 요약에서 제외한다. 선택한 코드 파일과 lockfile의 SHA-256, Git revision·작업 상태를 결과에 기록했다. 통계는 nearest-rank이며 10회 p95는 최대값이다.

## 수집 경계

- 기존 `profile.mjs`의 prototype wrapper와 `server-file-profile.mjs`의 Node module hook을 사용한다. product 파일에 clock이나 profiling API를 넣지 않고 실제 로드할 파일의 호출 경계만 메모리에서 감싼다.
- 디렉터리 생성과 내용 준비 뒤, 카탈로그 저장 직전에 `begin()`을 호출한다. 목록 DOM ack body를 받은 clock을 먼저 잡은 뒤 `finish()`를 호출한다. 그 이후 언어 선택·fresh full 응답·en 복귀·삭제는 해당 서버 sample에 넣지 않는다.
- `readAndCandidateMs`는 drain 진입→prepareTranslations 진입이다. 직렬화된 drain 대기·경로 검사·읽기·파싱·candidate 정리·base stat을 포함한다. 파싱 구간은 synchronous `parseCatalog` 호출과 인자 구성 전체이며 JSON·ICU·인자 추론·위치·동결을 포함한다. 아직 파서 내부 원인은 나누지 않았다.
- `translationPreparationMs`는 schema 조회·번역 검증·격리 준비다. 정상 번역이므로 실제 격리 복구 비용을 재지 않는다. `validationMs`는 이후 최종 active catalog 검증이다. 두 구간을 같은 번역 검증 비용으로 합치지 않는다.
- 경로 검사·읽기는 비동기 wall time이다. 파싱도 동기 호출의 wall time이며 GC·스케줄링 영향을 포함할 수 있다. CPU profiler 결과가 아니다.
- `candidateOtherMs`는 각 sample의 readAndCandidate에서 경로 검사·읽기·파싱 시간을 뺀 잔여다. sample별 잔여를 먼저 계산해 요약한다. 세 구간은 readAndCandidate에 포함되므로 중복 합산하지 않는다.
- 매 회차 경로 검사·읽기·파싱 호출은 정확히 1회여야 한다. 파일 이벤트는 add/change가 quiet window에서 묶여 2회 관측될 수 있다. 선택 전 수집을 끝내므로 `catalogDeltaMs: 0`은 full 로드 비용 측정값이 아니다.

종단 간 저장→목록/번역 ack, 선택 준비→번역 ack는 기존과 같은 Node monotonic clock이다. ack 비용을 포함하고 control 왕복은 빼지 않는다. browser setter→commit은 별도 clock이다. 단계 p95를 합산하거나 Node와 browser clock을 빼지 않는다. paint는 측정하지 않는다.

## 결과

| 항목 | p50 | p95 |
| --- | --- | --- |
| 저장→목록 DOM ack | 762.13ms | 1,808.23ms |
| 저장→manifest broadcast | 744.03ms | 1,787.18ms |
| 선택 준비→첫 번역 ack | 462.42ms | 877.85ms |
| 선택→첫 번역 commit(browser) | 458.70ms | 873.00ms |
| control 왕복 | 7.28ms | 14.50ms |
| queue→drain | 51.43ms | 64.01ms |
| readAndCandidate (아래 파일 구간 포함) | 579.69ms | 1,206.91ms |
| 경로 검사 | 1.44ms | 45.39ms |
| UTF-8 읽기 | 3.03ms | 191.45ms |
| 카탈로그 파싱 | 575.99ms | 1,132.23ms |
| candidate 잔여 | 1.00ms | 54.41ms |
| 번역 준비·검증 | 80.61ms | 148.24ms |
| 최종 active 검증 | 0.06ms | 0.11ms |
| registry replace | 0.13ms | 2.16ms |

측정 10회 모두 파싱 시간이 다른 개별 수집 구간보다 컸다. 각 sample에서 파싱/readAndCandidate를 계산하면 최소 80.21%였다. 이것은 읽기·candidate 구간 안의 비중이다. 전체 저장→화면 시간이나 CPU 사용률의 비중으로 사용하지 않는다. watcher 이벤트 도착과 manifest 생성·전송 등 별도로 나누지 않은 비용도 있다.

측정 10회 모두 drain 1회, 경로 검사·읽기·파싱 1회였으며 파일 이벤트는 최대 2회였다. 목록 확인 전 새 카탈로그 응답은 0개, 선택 뒤 baseline 없는 full 응답은 회차마다 1개였다. 응답 JSON의 p95는 4,421,174 B이며 WS header·압축·manifest를 포함한 물리 네트워크 총 바이트가 아니다. 입력 노드·값·React 상태를 유지했고 추가 readiness/reload는 없었다. 생성 `.d.ts`의 mtime·size도 유지했다.

## 검증과 해석

소규모 계측 모드 2회, 기존 edit+server-file-stages 2회, 계측 없는 locale-add 2회도 실제 browser에서 실행했다. default locale-add는 서버 계측 field를 출력하지 않는지 확인했다. 원시 sample의 통계·계측 호출 수·잔여 구간·wire 조건·코드 hash를 대조했다. 임시 fixture·browser profile·browser process가 종료 후 남지 않았음을 확인했다. 제품 변경이 없어 전체 test suite와 release check는 반복하지 않았다.

기존 [50회 계측 없는 run](12-locale-add-measurements.md)의 large 목록 p95 3,437.01ms와 이번 1,808.23ms는 실행 시점·부하·sample 수·계측 유무가 다르다. 성능 개선으로 해석하지 않는다. 현재 구조의 주요 수집 비용을 식별한 단일 run이며 아직 250ms 목표를 달성하지 못했다.

후속 단순 메시지 파싱 최적화와 cold 교차 비교는 [15-simple-message-parser.md](15-simple-message-parser.md)에 기록했다. locale-aware ICU 처리, 오류 위치, 중복 ID 거부와 immutable catalog 계약을 유지해야 한다. 이 14번 기록 단계에서는 parser 변경이나 선택 뒤 full 응답 최적화를 하지 않았다.
