# 라이브 갱신 벤치마크

개발 중 카탈로그 문구를 수정했을 때 화면에 반영되기까지의 latency를 잰다. 대상은 실제 Vite watcher와 실제 브라우저 DOM commit이다.

## 실행

저장소 루트에서 실행한다. workspace를 먼저 build한 뒤 Node harness가 돈다.

```sh
npm run bench:live
```

설치된 Chrome 또는 Edge를 headless로 쓰고 임시 user-data 프로필을 따로 만든다. 추가 npm 의존성은 없다. 브라우저를 찾지 못하면 `--browser <executable>`로 실행 파일을 지정한다.

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `--scenario` | `all` | `1k-3-locales`, `10k-20-locales`, `all` 중 하나 |
| `--samples` | `50` | 시나리오별 측정 샘플 수 |
| `--warmup` | `5` | 측정에서 제외하고 버리는 warmup 수 |
| `--calibrations` | `25` | control 왕복 측정 횟수 |
| `--browser` | 자동 탐색 | Chrome/Edge 실행 파일 경로 |
| `--out` | `benchmarks/results/live-update.json` | 결과 JSON 경로 |
| `--no-typegen` | 꺼짐 | typegen을 끄고 실행 |
| `--timeout-ms` | `30000` | 단계별 대기 timeout |

## 픽스처와 측정

- `1k-3-locales`는 로케일당 메시지 1,000개 × 로케일 3개, `10k-20-locales`는 로케일당 10,000개 × 20개다. namespace는 1개다.
- 앱은 loaded base `ko` + target `en`을 싣고 `en`의 `bench` namespace에서 바뀐 키 1개와 바뀌지 않은 키 1개를 렌더한다. 매 저장마다 `en` 본문 키 1개만 수정한다.
- warm은 변경하지 않은 메시지의 formatter가 준비된 상태다. 수정된 메시지의 formatter 비용은 편집 비용에 포함한다.
- 종단 간 값은 하나의 Node `performance.now` clock으로 잰다. `writeFile` 완료 시점부터 브라우저가 DOM commit 뒤 보낸 HTTP ack body를 받은 시점까지다. 서버가 manifest를 broadcast한 시점과 브라우저가 카탈로그를 받아 commit한 시점은 별도 단계로 기록한다.
- 서버 단계는 manifest의 `ws.send` 호출 직전까지다. 브라우저 단계는 Vite가 JSON을 decode한 뒤 `saylo:catalog` 콜백을 호출한 시점부터 `useLayoutEffect`의 DOM 확인까지다. 문자열화·전송·Vite JSON decode 비용은 종단 간 값에는 포함되지만 두 단계 값에는 포함되지 않는다.
- ack 전달 비용은 종단 간 값에 포함한다. 단계별 p95를 더하거나 서버·브라우저 clock을 서로 빼서 종단 간 값을 만들지 않는다.
- no-op control 왕복도 따로 기록하며 전체 latency에서 빼지 않는다.
- 통계는 정렬 후 nearest-rank `ceil(n * p) - 1`이다.
- 문구만 수정한 편집 뒤에도 생성 `.d.ts`의 mtime과 size가 그대로인지 확인한다. 기본값에서 typegen은 켜져 있고 초기 `generated.d.ts`를 만든다.
- 실행이 끝나면 임시 fixture·프로필을 지우고 브라우저 프로세스와 그 자식, Vite를 함께 종료한다.

## 결과

결과는 [../results/live-update.json](../results/live-update.json)에 남는다. 환경(Node·OS·CPU·memory·Vite·React·브라우저 UA), git revision, UTC `measuredAt`, 시나리오 차원과 파일 바이트, 시나리오별 summary와 control 왕복 raw 값을 담는다. 시나리오별 raw sample(기본값은 warmup 포함 55개)은 결과 파일이 `samplesFile`로 가리키는 `live-update.<case>.samples.json`에 따로 둔다.

## 한계

- 수치는 warm 상태의 로컬 단일 실행이 만든 headless Chromium/Edge 개발 모드 값이다. 일반 보장이 아니며 장비·부하에 따라 달라진다.
- 기록된 run에서 두 시나리오의 save→DOM ack p95가 목표 p95 ≤ 100ms를 넘었다. small(1k×3) p95 191.25ms, large(10k×20) p95 1693.98ms다.
- startup은 Vite 서버 boot와 브라우저 boot를 따로 잰다. paint timing은 계측하지 않는다.
- 로케일 추가·삭제 latency, paint, 가상화 비교, 다른 라이브러리 비교, 번들 크기 측정은 이번 범위가 아니다.
