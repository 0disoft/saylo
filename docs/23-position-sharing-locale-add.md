# 23. 상대 위치 공유 후 로케일 추가 재측정

2026-10-07 KST, 상대 위치 공유를 포함한 코드로 로케일 추가를 재측정했다. 목록 표시 p95는 small 109.68ms, large 878.98ms였다. large는 50회 중 15회가 250ms 이내였지만 p95 목표는 여전히 미달이다. 반면 첫 번역 선택 p95는 직전 run보다 높게 관측돼 전체 흐름의 일관된 개선은 확인하지 못했다.

## 실행과 조건

```sh
node benchmarks/live-update/run.mjs --mode locale-add --out benchmarks/results/locale-add-position-pool.json
```

직전 구현에서 빌드·검증한 dist를 재사용했다. 측정 revision은 `9729fc98c6d6f284bba0605265ad9080b317ae7f`이고 시작 시 작업 트리는 깨끗했다. 제품·benchmark 코드는 이번 작업에서 변경하지 않았다. [요약](../benchmarks/results/locale-add-position-pool.json)과 [small 원시](../benchmarks/results/locale-add-position-pool.1k-3-locales.samples.json), [large 원시](../benchmarks/results/locale-add-position-pool.10k-20-locales.samples.json)를 보존한다.

직전 [20번 50회 run](20-locale-add-remeasurement.md)과 같은 설정이다. 규모별 warmup 5·측정 50·control 왕복 25, timeout 30초이다. typegen·기존 dependency prebundle은 켜고 CPU·서버/브라우저 상세 계측은 끈다. Node 24.18.0, Windows x64, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U, memory 31.3GiB이다. fixture·설정·환경·브라우저 버전은 이전 결과와 대조했다.

| fixture | 초기 파일·로케일 수 | 메시지/파일 | 초기 JSON 합 | 추가 JSON |
| --- | --- | --- | --- | --- |
| small | 3 | 1,000 | 110,292 B | 36,781 B |
| large | 20 | 10,000 | 7,755,280 B | 387,783 B |

namespace는 `bench` 하나이다. 매회 새로운 en-GB 디렉터리와 정상 번역 JSON 한 파일을 추가하고 목록 DOM 확인 뒤 자동 선택한다. 첫 번역 확인 후 en으로 복귀하고 파일·빈 디렉터리와 목록 항목을 제거한 같은 baseline에서 다음 회차를 시작한다. 앱·기존 formatter는 warm이고 추가 카탈로그와 새 probe formatter는 최초 로딩이다.

## 결과와 완료 지점

저장→목록 ack는 Node의 writeFile 완료부터 목록 DOM commit의 ack body 수신까지이다. 선택→첫 번역 commit은 브라우저 setLocale 직전부터 새 probe DOM을 확인한 useLayoutEffect까지이다. 선택 준비→번역 ack는 Node 제어 요청 수신부터 번역 ack 수신까지이며 제어 응답·ack 비용을 포함한다. 서로 다른 clock을 빼지 않고 control 비용 차감·중첩 p95 합산도 하지 않는다. nearest-rank 통계이며 paint와 실제 마우스 입력 지연은 측정하지 않는다.

| metric | small p50(ms) | small p95(ms) | large p50(ms) | large p95(ms) |
| --- | --- | --- | --- | --- |
| 저장→목록 DOM ack | 84.76 | 109.68 | 318.32 | 878.98 |
| 선택→첫 번역 commit(브라우저) | 28.90 | 48.00 | 274.30 | 486.80 |
| 선택 준비→첫 번역 ack(Node) | 32.46 | 51.36 | 278.17 | 561.42 |
| 저장→첫 번역 ack | 121.10 | 163.12 | 617.91 | 1,295.89 |
| 저장→manifest broadcast | 78.74 | 104.67 | 299.76 | 857.91 |
| 파일 쓰기 | 6.78 | 9.21 | 14.15 | 37.27 |
| control 왕복 | 4.00 | 5.66 | 3.72 | 5.01 |

목록 250ms 이내는 small 50/50회, large 15/50회였다. large 목록 최소/최대는 176.11/1,083.15ms였다. small은 이번 run에서 목표를 충족했지만 단일 run으로 안정적 달성을 주장하지 않는다.

| p95 비교 | 직전 small(ms) | 현재 small(ms) | 직전 large(ms) | 현재 large(ms) |
| --- | --- | --- | --- | --- |
| 목록 표시 | 153.98 | 109.68 | 1,056.40 | 878.98 |
| 선택→첫 번역 commit | 44.40 | 48.00 | 360.20 | 486.80 |

측정 코드 hash 중 직전 run과 달라진 파일은 core의 catalog.js·simple-message.js·diagnostics.js 세 개였다. 위치 공유의 범위와 parser-only 비교는 [22](22-relative-position-sharing.md)를 따른다. 실행 부하·GC·스케줄링은 통제하지 않았으므로 목록 감소 전체나 선택 지연 증가를 위치 공유 한 변경의 효과로 확정하지 않는다. control p95도 small 12.27→5.66ms·large 6.02→5.01ms였고 large fileWrite p95는 15.05→37.27ms로 실행 조건의 관측값이 달랐다.

## 상태 보존·전송·검증

모든 회차에서 목록 추가·언어 선택·삭제 후 input node identity·입력값·변경한 React 상태를 유지했다. 최초 번역 DOM과 선택된 locale, en 복귀와 목록 제거도 확인했고 document reload 없이 실행을 완료했다. 생성 `.d.ts`의 mtime·size는 두 규모 모두 유지됐다.

측정 50회 모두 선택 전 새 target 카탈로그 응답은 0개, 선택 후 known baseline 없는 compact full 응답은 정확히 1개였다. encoding은 `saylo-catalog-v1`이고 응답 객체 JSON p95는 small 119,638 B·large 1,241,400 B이다. 물리 네트워크 바이트나 위치 공유에 따른 wire 크기 개선으로 해석하지 않는다.

각 raw의 55행·측정 50행·고유 token·6개 timing과 control 25회 요약·바이트·응답 횟수·현재 코드 hash를 대조했다. 종료 후 owned 임시 fixture/profile 디렉터리와 benchmark browser process는 남지 않았다. 제품 변경이 없어 직전의 166개 테스트·consumer 타입 검사와 build·release check·pack은 이번 작업에서 반복하지 않았다.

## 다음 작업과 한계

다음은 첫 언어 선택의 full 응답 디코딩·동결·snapshot 생성 구간을 benchmark에서 나눠 측정하는 작업이다. 기존 브라우저 계측은 patch 편집을 전제로 하며 locale-add 모드를 지원하지 않으므로, full 응답을 다루는 계측 경계를 추가해야 한다. 계측 결과로 다음 최적화 대상을 정하며 현재 수치만으로 브라우저 디코딩을 확정 병목으로 단정하지 않는다.

목록 목표는 large에서 여전히 미달이다. 단일 장비·단일 namespace·정상 번역 한 파일·probe 한 메시지의 DOM commit만 확인했다. 여러 namespace 추가, 잘못된 번역, 전체 메시지 렌더·cold startup·paint와 다른 라이브러리 우열로 확대하지 않는다. 상대 위치 공유는 아직 npm 게시본에 없다.
