# 12. 로케일 추가 측정

이 문서는 초기 50회 run의 기록이다. 최적화 후 같은 설정의 후속 측정은 [20-locale-add-remeasurement.md](20-locale-add-remeasurement.md)에 있다.

2026-10-07 KST 로컬 단일 run에서 새 로케일 목록 표시 p95는 small 226.86ms, large 3437.01ms였다. small은 이 실행에서 250ms 목표 안에 들었고 large는 크게 넘었다. 단일 run이므로 안정적 달성이나 일반 앱 성능으로 확대하지 않는다. 기존 문구 수정과 파서 기록은 [10-performance-measurements.md](10-performance-measurements.md)·[11-parser-measurements.md](11-parser-measurements.md)를 따른다.

## 실행과 조건

Paraglide와의 소규모 10회 비교는 [13-paraglide-comparison.md](13-paraglide-comparison.md)에 별도로 기록한다. 이 문서의 50회 run과 sample 수·부하·시점이 다르므로 수치를 합치지 않는다.

```sh
npm run build
node benchmarks/live-update/run.mjs --mode locale-add --out benchmarks/results/locale-add.json
```

이번에는 직전 최적화에서 빌드한 동일 runtime을 재사용해 두 번째 명령을 실행했다. 원본은 [locale-add.json](../benchmarks/results/locale-add.json)과 그 파일이 가리키는 시나리오별 raw sample이다. 기준 revision은 8ab4e5e이고, 그 위의 locale 전용 app·channel·fixture·runner 변경은 `workingTreeStatus`·`codeHashes`로 식별한다. 제품 라이브러리 source·dist는 이 작업에서 바꾸지 않았다.

warmup 5회 뒤 측정 50회, control 왕복 25회다. CPU profiler·서버/브라우저 상세 구간 계측은 끄고, 기존 Saylo·React dependency prebundle을 사용했다. Windows x64, Node v24.18.0, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U, memory 31.3GiB 환경이다. React 개발 모드의 실제 Vite watcher·WS와 headless 브라우저 DOM commit을 사용한다. paint는 측정하지 않는다.

| fixture | 초기 로케일·파일 | 메시지/파일 | 초기 JSON 합 | 새 JSON | namespace |
| --- | --- | --- | --- | --- | --- |
| small | 3 | 1,000 | 110,292 B | 36,781 B | bench 1개 |
| large | 20 | 10,000 | 7,755,280 B | 387,783 B | bench 1개 |

처음에는 ko base와 en target을 로드하고 en의 `bench:probe` 1개를 표시한다. 매 회차마다 새 `en-GB/bench.json` 한 파일을 추가한다. 새 파일은 en 카탈로그와 같은 key·인자 계약을 갖고 probe 문구만 회차별 토큰으로 바꾼다. 앱과 기존 formatter는 warm이지만 새 target 카탈로그·그 probe formatter는 최초 로딩이다.

매 회차 새 디렉터리를 생성한 뒤 JSON을 저장한다. 디렉터리 생성·JSON 내용 준비는 저장 latency에서 제외하지만, 새 디렉터리·파일을 Vite watcher가 발견하는 과정은 저장 완료 이후 측정에 들어간다. 목록을 확인한 뒤 자동으로 `setLocale('en-GB')`를 호출한다. 최초 번역 확인 뒤 en으로 복귀하고 파일을 삭제해 목록에서 en-GB가 사라진 DOM commit을 확인한 후 빈 디렉터리도 삭제한다. 다음 회차는 en-GB가 없는 같은 baseline에서 시작한다. 서버 metadata에는 동일 pair의 version/tombstone 이력은 남지만, 클라이언트는 매번 known baseline 없는 full 요청을 보낸다.

## 완료 지점과 clock

- `saveToListAckMs`: Node의 `writeFile` Promise 완료부터 `<select>`에 en-GB option이 나타난 DOM commit을 브라우저가 확인하고 ack body가 Node에 도착할 때까지. 250ms 목표는 이 값을 기준으로 본다.
- `selectToCommitMs`: 브라우저가 `setLocale`을 호출하기 직전부터 en-GB가 선택되고 회차별 새 probe 문구가 DOM에 나타난 `useLayoutEffect`까지. 실제 선택 동작과 첫 번역의 같은 브라우저 clock 값이다.
- `selectToTranslationAckMs`: Node가 selection-ready 제어 요청을 받은 시점부터 첫 번역 DOM ack를 받을 때까지. setter 실행까지의 HTTP 제어 응답과 ack 전달 비용을 포함해 별도로 보고한다.
- `saveToTranslationAckMs`: 같은 Node clock에서 저장 완료부터 첫 번역 ack까지. 목록 ack·자동 선택 조정의 HTTP 비용도 들어가며 사람의 선택 대기 시간은 없다.
- `saveToBroadcastMs`: 저장 완료부터 새 locale을 포함한 manifest의 `ws.send` 호출 직전까지.

Node·브라우저 clock을 서로 빼지 않고, control 왕복이나 구간별 p95를 전체 latency에서 빼거나 더하지 않는다. 통계는 nearest-rank다. 언어 선택은 UI onChange와 같은 `setLocale` 경로를 자동 호출하며 실제 마우스 클릭의 입력 지연을 재는 값이 아니다.

## 결과

| metric | small p50 | small p95 | large p50 | large p95 |
| --- | --- | --- | --- | --- |
| 저장→목록 DOM ack | 132.58ms | 226.86ms | 1093.41ms | 3437.01ms |
| 선택→첫 번역 commit(브라우저) | 42.10ms | 64.70ms | 465.50ms | 843.70ms |
| 선택 준비→첫 번역 ack(Node) | 45.14ms | 70.56ms | 469.98ms | 847.56ms |
| 저장→첫 번역 ack | 183.08ms | 285.05ms | 1556.27ms | 4016.01ms |
| 저장→manifest broadcast | 127.38ms | 221.15ms | 1072.66ms | 3420.35ms |
| 파일 쓰기 | 5.22ms | 7.96ms | 16.99ms | 100.28ms |
| control 왕복 | 3.76ms | 13.08ms | 3.59ms | 5.47ms |

large의 목록 표시 max는 14275.76ms였고 fileWrite max는 252.35ms였다. 부하 프로파일을 따로 재지 않아 원인을 확정하지 않는다. 목록 표시 전의 서버 단계도 크게 관측되므로 카탈로그 전송량만으로 전체 지연을 설명하지 않는다. cold 파일은 기존 문구 수정과 달리 메시지 전체의 ICU 파싱·번역 검증을 수행한다.

측정 50회 모두 목록 ack 전 새 target 카탈로그 응답은 0개였고, 선택 후 known baseline 없는 full present 응답이 정확히 1개였다. 그 catalog 응답 객체 JSON의 p95는 small 437,413 B·large 4,421,175 B다. 새 입력 JSON p95는 36,781 B·387,783 B였다. 이 응답 크기는 AST·위치·인자 schema와 envelope를 포함한 직렬화 대상 객체이며, 실제 물리 네트워크 바이트가 아니다. manifest·WS 헤더·압축은 포함하지 않는다. 새 카탈로그 전체를 처음 받는 비용이 다음 비교·최적화에서 확인할 대상이다.

## 확인한 동작과 한계

두 raw 파일은 각각 55회(측정 50회)다. 6개 timing·control 요약, input/reply 바이트 집계, unique token·정확히 1회 full 응답·선택 전 0회 응답과 측정 코드 hash를 대조했다. 매번 목록 option과 선택된 locale·probe DOM을 확인했고, 최초 mount 후 바꾼 input 값·input node identity·component state가 목록 추가·언어 전환·삭제 뒤에도 유지됐다. 예상치 않은 페이지 reload는 측정을 실패시킨다. 생성 `.d.ts`의 mtime·size도 처음과 같았다. 마지막 회차까지 삭제와 en 복귀를 확인한 뒤 종료했고, 임시 fixture·browser profile과 해당 브라우저 프로세스는 남지 않았다.

작은 2회 locale-add smoke와 기존 edit 모드 1회 smoke도 통과했다. 제품 코드를 바꾸지 않아 기존 전체 테스트·release check·pack은 반복하지 않았다. 이번 기록은 단일 namespace·단일 새 파일·full key 수의 정상 번역이다. 여러 namespace 일괄 추가, 불완전/잘못된 번역, 처음 켠 서버, paint, UI 전체 메시지 렌더와 다른 라이브러리 비교로 확대하지 않는다. 측정 앱은 probe 한 메시지만 표시한다.

로케일 추가 기능과 입력 상태 유지는 작동하지만 대규모의 250ms 성능 목표는 미달이다. 이후 Paraglide small 비교는 [13](13-paraglide-comparison.md)에, large 로케일 추가의 서버 구간 계측은 [14](14-locale-add-server-measurements.md)에 기록했다. 다음 최적화 대상은 새 카탈로그의 cold 파싱이다. 이 측정은 로컬 checkout runtime이고 최신 최적화는 npm `0.1.0-alpha.1`에 포함되지 않았다.
