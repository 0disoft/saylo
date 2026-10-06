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

## 남은 확인

- Paraglide 새 로케일 파일+settings 변경→목록 표시와 선택→첫 번역, 재로딩·상태 유지 관측.
- 대규모 초기 compile 실패의 원인 분리와 성공하는 조건의 재측정.
- 반복 run·더 많은 sample을 통한 부하 영향 확인.
- i18next/Wuchale 확장점 위 얇은 계층이 Saylo의 계약을 충족하는지 확인.

공식 문서: [Vite](https://paraglidejs.com/vite), [로케일 전략과 선택](https://paraglidejs.com/basics), [project settings](https://inlang.com/docs/settings). 설치 버전의 개발 출력 기본값과 hook 동작은 실제 package 소스에서도 확인했다.
