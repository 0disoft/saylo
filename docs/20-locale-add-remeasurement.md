# 20. AST 동결 최적화 후 로케일 추가 재측정

2026-10-07 KST, 단순 메시지 파싱·compact 전송·인자 스키마 공유·AST 동결 최적화를 포함한 로컬 코드로 로케일 추가를 재측정했다. 목록 표시 p95는 small 153.98ms, large 1,056.40ms였다. small은 이 실행에서 250ms 목표를 충족했고 large는 여전히 미달이다.

## 실행 조건

```sh
npm run build
node benchmarks/live-update/run.mjs --mode locale-add --out benchmarks/results/locale-add-ast-freeze.json
```

측정 revision은 `da3386691a3f28860f5a12ccfd77e04c50f78ad1`이고 시작 시 작업 트리는 깨끗했다. runtime source와 benchmark 코드는 이번 작업에서 변경하지 않았다. 요약은 [locale-add-ast-freeze.json](../benchmarks/results/locale-add-ast-freeze.json), 원시는 [small 표본](../benchmarks/results/locale-add-ast-freeze.1k-3-locales.samples.json)과 [large 표본](../benchmarks/results/locale-add-ast-freeze.10k-20-locales.samples.json)에 있다.

초기 [50회 기록](12-locale-add-measurements.md)과 같은 설정을 사용했다. 규모별 warmup 5회·측정 50회·control 왕복 25회, timeout 30초이다. CPU profiler·서버/브라우저 상세 계측은 끄고 Saylo·React dependency prebundle과 typegen을 켰다. Node 24.18.0, Windows x64, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U, memory 31.3GiB 환경이다.

| fixture | 초기 파일·로케일 수 | 메시지/파일 | 초기 JSON 합 | 매회 추가 JSON |
| --- | --- | --- | --- | --- |
| small | 3 | 1,000 | 110,292 B | 36,781 B |
| large | 20 | 10,000 | 7,755,280 B | 387,783 B |

namespace는 `bench` 한 개이다. 매회 새 en-GB 디렉터리와 JSON 한 파일을 만들고 목록 DOM을 확인한 뒤 자동으로 언어를 선택한다. 첫 번역을 확인하면 en으로 돌아가 파일·빈 디렉터리를 삭제하고 목록에서 사라진 상태까지 확인한다. 초기 ko/en은 로드된 상태이며 en-GB는 선택 전에 로드하지 않는다. 앱·기존 formatter는 warm이지만 추가 카탈로그와 새 probe formatter는 최초 로딩이다.

## 완료 지점과 결과

저장→목록 ack는 Node의 writeFile 완료부터 브라우저 목록 DOM commit의 ack body 수신까지이다. 선택→첫 번역 commit은 브라우저 setLocale 직전부터 새 probe 문구가 DOM에 나타난 useLayoutEffect까지이다. 선택 준비→번역 ack는 Node 제어 요청 수신부터 번역 ack 수신까지이며 제어 응답과 ack 비용을 포함한다. clock 간 차감·control 비용 차감·단계 p95 합산은 하지 않는다. 통계는 nearest-rank이며 paint와 실제 마우스 입력 지연은 측정하지 않는다.

| metric | small p50(ms) | small p95(ms) | large p50(ms) | large p95(ms) |
| --- | --- | --- | --- | --- |
| 저장→목록 DOM ack | 104.38 | 153.98 | 507.84 | 1,056.40 |
| 선택→첫 번역 commit(브라우저) | 31.20 | 44.40 | 268.40 | 360.20 |
| 선택 준비→첫 번역 ack(Node) | 34.55 | 48.50 | 271.34 | 363.55 |
| 저장→첫 번역 ack | 145.31 | 193.21 | 782.75 | 1,339.99 |
| 저장→manifest broadcast | 97.38 | 147.90 | 486.69 | 1,038.74 |
| 파일 쓰기 | 6.83 | 8.44 | 9.64 | 15.05 |
| control 왕복 | 4.08 | 12.27 | 3.87 | 6.02 |

목록 표시 250ms 이내는 small 50/50회, large 0/50회였다. large의 최소는 319.20ms, 최대는 6,869.99ms였다. 같은 실행의 manifest broadcast 최대도 6,552.60ms였으므로 선택 뒤 카탈로그 전송만으로 목록 지연을 설명할 수 없다. 상세 계측을 끈 run이며 파싱·검증·GC·스케줄링 중 어느 항목의 영향인지 확정하지 않는다.

초기 50회 run의 목록 p95는 small 226.86ms·large 3,437.01ms, 선택→첫 번역 commit p95는 64.70ms·843.70ms였다. 같은 fixture·설정의 후속 run에서 더 낮게 관측했지만 중간에 여러 제품 변경이 들어갔고 실행 부하도 다르다. 감소 전체를 AST 동결 한 변경의 효과로 귀속하지 않는다. 직전 [compact 기록](16-compact-catalog-transport.md)은 large만 10회·warmup 2·control 10·서버 계측 켬 조건이므로 이번 50회 run과 직접 전후 비교하지 않는다.

## 전송·상태 보존과 검증

측정 50회 모두 선택 전 en-GB 카탈로그 응답은 0개, 선택 후 known baseline 없는 full 응답은 정확히 1개였다. encoding은 `saylo-catalog-v1`이다. 응답 객체 JSON p95는 small 119,641 B, large 1,241,403 B이다. WS header·압축·manifest를 합친 물리 네트워크 바이트가 아니다.

실제 브라우저의 목록 추가·언어 선택·삭제 commit마다 input node identity·입력값·변경한 React component state가 유지됐다. 첫 번역 DOM·선택된 locale·매회 baseline 복귀도 확인했다. 예상치 않은 document reload는 runner가 실패로 처리하며 이번 실행은 완료했다. 두 규모에서 생성 `.d.ts`의 mtime·size는 유지됐다.

각 raw 파일의 55행·측정 50행·고유 token, 6개 timing 요약, control 25회 요약, full/선택 전 응답·input/reply 바이트와 코드 SHA-256을 대조했다. full workspace build를 통과했고 종료 후 owned 임시 fixture/profile 디렉터리와 benchmark browser process가 남지 않았음을 확인했다. 제품 변경이 없어 앞선 164개 테스트·consumer typecheck·release check·pack은 이번 작업에서 반복하지 않았다.

## 다음 작업과 한계

다음은 현재 대규모 로케일 추가의 서버 파싱·번역 준비·검증 구간을 기존 `--server-file-stages`로 다시 나누어 측정하는 작업이다. 과거 [14번 계측](14-locale-add-server-measurements.md) 뒤 파서가 바뀌었으므로 당시 비용 비중을 현재 병목으로 단정하지 않는다. 새 계측 결과로 다음 구현 대상을 정한다.

이번 기록은 단일 장비·단일 run·단일 namespace·정상 번역 한 파일·probe 한 메시지의 DOM 반영이다. 여러 namespace 추가, 잘못된 번역, 전체 메시지 렌더, cold startup과 paint의 성능을 보장하지 않는다. large의 목록 표시 목표는 미달이며 안정적 달성도 주장하지 않는다. 측정 runtime의 후속 최적화는 npm `0.1.0-alpha.1`에 아직 없다.
