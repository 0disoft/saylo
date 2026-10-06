# 13. Paraglide 비교 측정

2026-10-07 같은 장비에서 Paraglide 2.25.4의 문구 수정 반영을 처음 측정했다. 이 기록은 설치된 버전·설정·fixture에서 관측한 결과이며 전체 제품의 우열을 판정하지 않는다. i18next/Wuchale 위 얇은 계층으로 Saylo 계약을 충족하는 실험은 별도로 남아 있다.

## 문구 수정 조건

Node 24.18.0·Windows·Vite 8.3.2·React/ReactDOM 19.3.0·HeadlessChrome 154, warmup 2·측정 10·control 10이다. 두 실행은 동시에 돌리지 않았다. Paraglide는 React Fast Refresh 6.1.2, message-format plugin 4.4.5와 기본 개발 출력 `locale-modules`를 쓴다. 도구 의존성은 benchmark 디렉터리에만 추가했다.

Saylo와 같은 fixture 생성기를 쓴다. small은 메시지 1k×로케일 3개(110,292 B), large는 10k×20개(7,755,280 B)이고 namespace는 1개다. 영어 `probe` 값 하나를 바꾸고 번역 두 개를 표시한다. 문법은 일반 문자열과 단순 `{name}`이며 ICU 전체 비교가 아니다.

측정은 Node의 `writeFile` 완료부터 React DOM commit 후 HTTP ack body 수신까지다. ack 전달 비용을 포함한다. control 왕복은 빼지 않고 paint는 측정하지 않는다. 10회 nearest-rank p95는 최대값이므로 분포의 안정적 추정으로 보지 않는다.

Paraglide는 기본 `emitTsDeclarations: false`의 JS/JSDoc 추론 경로다. Saylo는 선언 파일 생성이 켜져 있지만 문구 편집 뒤 다시 쓰지 않는다. 동일한 typegen 작업량을 비교한 실험이 아니다. Paraglide project 메타를 만드는 사전 compile과 Vite boot는 반영 시간에서 제외하고 따로 기록했다. compiler hook 완료와 다음 회차 전 100ms 안정 구간을 기다려 편집을 겹치지 않게 했다. cold startup 비교에는 사용할 수 없다.

실행 방법과 상세 조건은 [benchmark 안내](../benchmarks/paraglide/README.md)를 따른다. 결과는 [Paraglide 소규모](../benchmarks/results/paraglide-edit-small.json), [Saylo 동일 횟수](../benchmarks/results/saylo-comparison-edit.json)에 있다. 원시 sample에는 warmup도 남긴다. 실행 코드 SHA-256과 lockfile·버전·작업 상태로 코드를 식별한다.

## 결과

Paraglide 소규모의 저장→DOM ack p50은 5,273.74ms, p95는 7,912.07ms였다. control 왕복 p95는 12.14ms였다. 측정 10회 모두 document reload 0회이며 원래 입력 노드·입력값·React 상태를 유지했다. 최초의 전체 시나리오 실행에서도 small p95 8,310.38ms·상태 유지 10/10을 관측했다. 그 실행은 다음 large 시나리오에서 실패해 요약 메타를 저장하지 못했으며 [raw sample](../benchmarks/results/paraglide-edit.1k-3-locales.samples.json)만 보존한다. 이후 harness는 성공한 시나리오마다 메타를 저장하도록 보완했다.

Saylo의 동일 횟수 small 실행은 p50 71.98ms·p95 127.64ms, large는 p50 250.72ms·p95 342.83ms였다. 이 run에서도 100ms 목표를 넘었으므로 과거 50회 실행의 목표 이내 수치로 대체하지 않는다. 두 도구의 실행 시점·부하와 타입 생성 방식이 다르므로 배수 개선이나 일반적 우위를 주장하지 않는다.

## 대규모 실패 관측

Paraglide large는 Vite와 browser가 시작되기 전 fixture 사전 compile에서 실패했다. 설치된 하위 의존성은 `@inlang/sdk` 3.1.0·`@lix-js/sdk` 0.19.0이다. worker가 `Lix transaction.commit did not settle within 60000ms`를 반환했고, 최종 오류는 `LIX_WRITE_OUTCOME_UNKNOWN`이었다. command·코드 revision·cause·의존성 lockfile·관측 시점은 [실패 기록](../benchmarks/results/paraglide-edit-large.failure.json)에 있다.

이 오류는 한 번 관측한 초기 준비 실패다. 저장→화면 반영의 timeout도 아니고 Paraglide의 일반적 규모 한계도 아니다. 이 시나리오의 p50·p95나 Saylo 대비 속도를 계산하지 않는다. harness의 `--timeout-ms`는 browser/channel 대기 timeout이며 Lix의 내부 60초 deadline을 바꾸지 않는다. 오류의 정확한 원인과 다른 SDK·compiler 설정에서의 동작은 미확인이다.

## 로케일 추가 조건

로케일 추가는 초기 small fixture에서 매 회차 새 en-GB의 bench.json을 만들고 settings.locales를 함께 갱신한다. Node clock은 파일과 settings의 **두 저장 완료 뒤**부터 목록 option DOM 확인 ack까지다. Saylo는 settings 변경 없이 카탈로그 파일 하나만 쓰므로 저장 파일 수는 다르다. 디렉터리 생성·내용 준비는 두 harness 모두 저장 latency에서 제외한다.

목록 ack 뒤 선택 준비 요청을 서버가 받은 시점부터 첫 번역 DOM ack까지를 같은 Node clock으로 잰다. Paraglide는 기본 `setLocale()`의 전체 document navigation을 그대로 사용한다. browser clock은 document가 바뀌므로 setter→commit 구간을 계산하지 않는다. 초기 boot에서만 en을 `reload:false`로 설정하며 측정 중에는 기본 setter를 사용한다. [공식 로케일 문서](https://paraglidejs.com/basics)는 기본 내비게이션과 `reload:false` 예외 경로를 구분한다.

Paraglide의 generated locale 함수는 선택 전에 브라우저에 전달될 수 있다. Saylo는 미로드 target을 선택 뒤 처음 full catalog로 받는다. 따라서 선택→번역 수치는 이 두 구성의 사용자 흐름을 관측한 값이며 동일한 cold fetch 비용 비교가 아니다. Paraglide의 catalog wire 바이트는 측정하지 않는다. p95 합산과 프로세스/document 간 clock 차감은 하지 않는다.

초기 입력 노드·값·React 상태는 실행 첫 document에서만 만든다. reload 후 재주입하지 않는다. warmup에서 상태를 잃으면 후속 측정도 최초 기준 상태 대비 보존 실패로 기록한다. 목록 갱신·선택의 reload를 구분하며 en 복귀·삭제 뒤 지연된 reload는 document 총수에만 포함한다. 삭제 option과 compiler idle까지 확인하고 다음 추가를 시작한다.

## 로케일 추가 결과

두 도구 모두 small에서 warmup 2·측정 10·control 10을 실행했다. 결과는 [Paraglide](../benchmarks/results/paraglide-locale-small.json)와 [Saylo](../benchmarks/results/saylo-comparison-locale-small.json)에 있으며 각각 원시 sample 파일을 가리킨다.

| 구간 | Saylo p50 / p95 | Paraglide p50 / p95 |
| --- | --- | --- |
| 저장 완료→목록 DOM ack | 136.14 / 183.04ms | 4,801.88 / 7,447.99ms |
| 선택 준비→첫 번역 DOM ack | 41.69 / 69.32ms | 107.60 / 199.00ms |
| 저장 완료→첫 번역 DOM ack | 180.91 / 245.45ms | 4,919.45 / 7,636.68ms |
| control 왕복 | 2.96 / 5.84ms | 5.22 / 8.32ms |

Paraglide는 측정 10회 모두 목록 갱신에서 1회, 선택에서 1회 document reload가 있었다. 두 단계의 최초 입력 노드·값·React 상태 보존은 각각 0/10이었다. warmup·en 복귀·삭제를 포함한 전체 document 수는 49개였다. 같은 fixture의 문구 편집에서는 상태를 유지했으므로 이를 모든 Paraglide 편집이 상태를 잃는다는 주장으로 확대하지 않는다.

Saylo는 warmup·측정 전 구간에서 추가 document readiness가 발생하면 실패하는 harness를 통과했다. 각 DOM commit에서 입력 노드·값·React 상태가 초기 기준과 같은지도 검사한다. 측정 10회 모두 target 선택 전 catalog 응답 0개, 선택 뒤 fresh full 응답 1개였다. catalog 응답 JSON 크기의 p95는 437,410 B이며 물리 네트워크 총 바이트가 아니다. 생성 선언 파일도 다시 쓰이지 않았다.

이 small run에서 Saylo 목록 p95는 250ms 목표 이내다. 기존 [50회 large run](12-locale-add-measurements.md)의 목표 미달을 해소하지는 않는다. Paraglide large는 동일한 초기 catalog 규모의 사전 compile이 앞서 실패했으므로 locale-add 모드로 다시 반복하지 않았다. 대규모 로케일 추가 비교는 미완료다. 기본 setter 이외의 애플리케이션 소유 reactivity·SSR·URL routing·별도 compiler 설정은 이 비교로 판정하지 않는다.

Node 문법 검사, 실제 headless Chrome 반복 실행, 원시 sample→nearest-rank 통계 재계산으로 결과를 확인했다. 두 benchmark의 임시 디렉터리·browser profile·browser process가 종료 후 남지 않았음을 확인했다. 제품 source/API는 변경하지 않았으므로 전체 제품 test suite와 release check는 실행하지 않았다. 결과와 benchmark 변경은 로컬 커밋이며 npm 게시본을 갱신하지 않았다.

## 남은 확인

- 대규모 초기 compile 실패의 원인 분리와 성공하는 조건의 재측정.
- 반복 run·더 많은 sample을 통한 부하 영향 확인.
- i18next/Wuchale 확장점 위 얇은 계층이 Saylo의 계약을 충족하는지 확인.

공식 문서: [Vite](https://paraglidejs.com/vite), [로케일 전략과 선택](https://paraglidejs.com/basics), [project settings](https://inlang.com/docs/settings). 설치 버전의 개발 출력 기본값과 hook 동작은 실제 package 소스에서도 확인했다.
