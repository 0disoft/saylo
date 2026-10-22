# 06. 검증과 로드맵

이 문서는 성능 목표와 측정 정의, 인수 사례, 빌드 순서, 개발 로드맵을 정한다.

## 성능 목표

아래 수치는 목표다. 로컬 벤치마크로 일부를 측정했고, 결과와 한계는 [상세 성능 기록](10-performance-measurements.md)에 남겼다. 2026-10-11 [75](75-early-disk-rechecks.md)의 격리 스냅샷 ABBA(warmed, normal prebundle, typegen on)에서 수정 반영 p95는 small(1k×3) 49.57ms·large(10k×20) 80.25ms로 둘 다 100ms 목표 안이고, 로케일 목록 단발 p95는 small 77.46ms·large 177.83ms로 250ms 목표 안이다. 편집은 두 after run의 표본을 합친 값이고 로케일 목록은 조건별 단일 run이다. large는 run별 편차가 커서 안정 달성이나 다른 OS·워크로드에서의 달성은 주장하지 않는다. 이전 request-scoped patch의 첫 run·재실행 기록은 [검증 이력](06-validation-history.md)에 남긴다.

| 항목 | 목표 | 조건 |
| --- | --- | --- |
| 개발 중 카탈로그 문자열 수정 반영 | p95 ≤ 100ms | warmed 상태, 로컬 기준 환경 |
| 로케일 추가 후 목록 표시 | p95 ≤ 250ms | 대표 fixture. 새 로케일 최초 번역의 DOM 반영 시간은 별도 보고 |

### 측정 정의

- 측정 시작점은 파일 저장이 끝나고 harness가 그 저장을 관측한 시점이다. 저장 시작 시점을 기준으로 삼지 않는다.
- 종단 간 측정은 하나의 Node monotonic clock으로 한다. 파일 관측부터 브라우저의 DOM commit 확인 응답(ack)까지를 같은 clock으로 잰다. 이 값에는 ack 전달 비용이 들어가므로 그 비용을 함께 표시한다.
- 브라우저 내부의 수신→commit 시간은 별도로 기록한다. 서버 단계와 브라우저 단계를 분리해야 병목이 드러난다.
- 단계별 p95를 더해 종단 간 p95로 쓰지 않는다. 단계 값은 참고로만 병기한다.
- 개발 서버와 브라우저의 `performance.now`는 서로 다른 clock이므로 두 값을 직접 빼지 않는다. 같은 프로세스에서 도는 제어 harness로 한 clock에서 재거나, 동기화 추정 오차를 수치와 함께 명시한다.
- warm은 앱과 변경하지 않은 메시지의 formatter가 준비된 상태를 말한다. 수정된 메시지 자체의 formatter는 warm 조건에 넣지 않는다. 그 메시지는 새 내용이므로 편집 비용에 포함한다.
- 로케일 추가는 두 완료 지점을 구분해 잰다. 첫째는 로케일이 선택 가능한 목록에 나타나는 시점, 둘째는 그 로케일로 전환해 최초 번역이 DOM에 반영되는 시점이다. 파일 수, 총 바이트, namespace 수와 함께 정의해야 비교할 수 있다.
- 수정 반영과 로케일 추가는 p50과 p95를 함께 보고한다.
- 작은 규모에서만 돌린 벤치마크로 일반화하지 않는다. 규모를 나눠 측정한다. 예: 메시지 1k/10k, 로케일 3/20.
- typegen 비용과 cold startup은 수정 반영 수치에서 분리해 별도로 잰다.
- CI에서 광범위한 매트릭스로 비용을 부풀리지 않는다. 필요한 조합만 돌린다.

이전 측정과 검증 기록은 [검증 이력](06-validation-history.md)에 보존한다.

## 현재 소스 검증 (2026-10-11)

현행 소스 `0f7840f`(제품 `eb66af8`) 로컬 검증 결과를 `38ee9be`에 기록했다. 근거는 [review/local-readiness-2026-10-11.json](../review/local-readiness-2026-10-11.json)(입력 해시 86개)와 [77](77-local-release-readiness.md)이다.

- `npm run check` exit 0: 다섯 패키지 build·단위 테스트, JS/TS 소비 5종, React 예제, OIDC·registry 단위 검사.
- `npm exec -- node scripts/pack-smoke.mjs` exit 0: 다섯 tarball 독립 install, CLI·typegen·README 예제, Node 번역·인자 거부·React SSR, React·Svelte selector SSR, Vite production lazy, 완역 거부·복구, 개발 의존성 제거 후 SSR(관측 Vite 8.3.4).
- `npm exec -- node scripts/pack-sveltekit.mjs` exit 0: 독립 5-tarball install, svelte-check 0 error·0 warning, Vite 8.3.4 production Node·client build, ko/en 동시 SSR과 boot 일치·canonical fallback, listener 정리·runtime 취소, 운영 HTTP, Chromium 154 hydration·ko→en→ko 전환·공통 layout 상태 유지·종료·재진입.

이 pack은 미게시 후속 코드를 `0.1.0-alpha.3` metadata로 묶은 로컬 proof이고 게시된 `alpha.3` artifact가 아니다. selector 공개 API는 현행 소스에 구현돼 있고 로컬 pack으로 검증했지만 게시본에는 없다. 원격 CI·OIDC·registry 대조는 이번 검증 범위가 아니다.

후속 릴리스 인수: `d26506f`의 `0.1.0-alpha.4`에서 원격 CI 229 tests·소비 타입 검사·OIDC 게시가 성공했다. 승인 CI와 registry tarball SHA-512, 외부 JS/TS·selector SSR 및 SvelteKit Chromium 소비 검증도 통과했다([릴리스 기록](../releases/0.1.0-alpha.4.md)). 위 alpha.3 pack 문단은 사전 로컬 검증 당시 기록이다.

## 인수 사례


| # | 사례 | 확인 내용 |
| --- | --- | --- |
| 1 | 상태 보존 | 문구 수정 후 입력값·모달·스크롤 위치가 유지된다 |
| 2 | 추가·수정·삭제 | 키 추가, 값 수정, 키 삭제가 각각 수렴한다 |
| 3 | 파싱 복구 | 깨진 JSON/ICU를 넣어도 마지막 정상값이 유지되고 진단이 나온다 |
| 4 | 재연결·갭 | 새 세션·revision gap에서 full snapshot으로 복구하고, 중복·오래된 patch는 discard한다. Vite 재시작 후 DOM 보존은 요구하지 않는다 |
| 5 | 비동기 타입 schema | baseline schema 변경 시 quarantine과 fallback이 동작한다(quarantine는 plugin 구현 완료. 단위·통합 테스트와 2026-10-07 실제 브라우저 검증을 통과했다). 키 삭제·필수 인자 추가 후 기존 호출 오류는 진단하며 DOM 보존을 요구하지 않는다 |
| 6 | 포맷 일치 | 변수, number/date/time, plural/select가 같은 Intl locale data·런타임에서 dev/prod 동일 출력을 낸다(고정 timeZone, 고정 시각 입력) |
| 7 | SSR 동시성 | 요청 간 로케일·카탈로그가 섞이지 않는다 |
| 8 | JS/TS 소비 | JS 프로젝트와 TS 프로젝트에서 모두 설치·소비가 된다(스모크) |
| 9 | union t 타입 | union 키는 먼저 좁혀야 하고, 잘못된 인자와 인자 누락이 거부된다 |
| 10 | checkJs 소비 | JSDoc typed JS에서 같은 인자 오류를 잡는다 |
| 11 | 신규 namespace 로더 | 부팅 뒤 추가된 namespace를 범용 `loadCatalog`가 로드한다 |
| 12 | locales 전체 목록 | `availableLocales`가 매번 전체 목록으로 교체된다 |
| 13 | desired generation 교차 완료 | `setLocale`와 `loadNamespace`가 교차 완료해도 최신 desired state로 수렴한다 |
| 14 | snapshot-bound hydration | hydration 동안 t가 S1을 읽고, S2는 barrier 뒤 한 번만 적용된다 |
| 15 | JS 런타임 인자 검증 | JS에서도 base required arg 검증이 `InvalidArgumentError`로 동작한다 |

## 빌드 순서

순서는 typegen(generate) → tsc(consumer 타입 체크) → build(Vite)다. Vite build 자체는 consumer TS 타입 체크를 하지 않으므로 tsc를 build 앞에 둔다. 별도 package/version 설정 파일 구현은 이번 범위 밖이다.

## 검증 방식

- 문서와 구현을 함께 갱신한다. 공개 타입 선언과 소비 fixture 검사, 실제 production build·정적 loader 검증을 수행하고, Markdown 링크·JSON 예제·코드 블록·파일 크기도 확인한다. 현재 구현의 결과는 이 문서의 단계별 검증 기록에 남긴다. 문서 설계 리뷰는 [리뷰 반영 기록](../review/feedback-resolution.ko.md)을 참고한다.
- 실행하지 않은 검사는 pass가 아니다. 문서 링크 확인도 항목별로 남긴다.
- 검증하지 않은 항목은 미검증으로 유지한다. 성능은 로컬 실측 기록과 목표를 구분해 적는다.

## 로드맵

작은 커밋 단위로 나눠 순차 진행한다. 각 단계는 그 자체로 쓸 수 있는 데모를 남기는 것을 목표로 한다. 처음에는 작은 fixture를 eager로 실어 상태 보존을 보여주고, 이후 같은 API 아래에서 전송을 세분화한다. 1~13단계 구현을 마쳤고, 아래 표는 그 단계의 완료 기준을 남긴다.

최신 구현·게시 상태와 남은 항목은 [81-implementation-status.md](81-implementation-status.md)를 따른다.

| 순서 | 커밋의 한 가지 책임 | 완료 기준 |
| --- | --- | --- |
| 1 | 계약 수정과 타입 fixture | union 키 반례를 막고, snapshot·locale 목록·fallback 의미를 확정한다 |
| 2 | JSON/ICU 파싱과 baseline schema 추출 | 중복 ID·문법 오류·인자 호환성을 작은 fixture로 판정한다 |
| 3 | AST 포맷과 순수 snapshot 조회 | 고정 locale·timeZone에서 t와 fallback이 동작한다 |
| 4 | immutable store와 vanilla 폼 데모 | eager snapshot 교체만으로 텍스트가 바뀌고 입력 DOM은 유지된다 |
| 5 | Vite change 연결 | 관리 카탈로그 수정이 앱 모듈 교체 없이 데모에 반영된다. 첫 핵심 데모다 |
| 6 | add/unlink와 listener 정리 | locale·namespace 추가, atomic save, 해제 후 재연결을 처리한다 |
| 7 | React typed context와 snapshot-bound hook | 타입을 유지하면서 같은 상태 보존 데모가 React에서 동작한다 |
| 8 | baseline typegen | 초기 readiness, 배경 생성, generation 취소, 내용이 바뀔 때만 `.d.ts` 쓰기를 구현한다 |
| 9 | 세션·snapshot handshake와 resync | 범위가 있는 snapshot 요청, 중복·gap·늦은 응답을 처리한다 |
| 10a | 지연 로딩 코어와 전환 조정 | desired locale·namespace 준비 상태, missing·failure·stale 결과를 처리한다. 로컬 구현 완료 |
| 10b | Vite 범용 로더와 부분 전송 | boot 이후 새 namespace 조회, pair별 version·tombstone, loaded scope 갱신과 React 데모를 연결한다. 로컬 구현 완료 |
| 11 | fresh production build | 현재 디스크 검증 → typegen → consumer 검사 → AST·정적 loader 산출을 연결한다. 로컬 구현 완료 |
| 12 | SSR serializer와 hydration fixture | 요청별 snapshot, boot escape, hydration 직전 갱신을 검증한다. 로컬 구현 완료 |
| 13 | 변경 메시지별 patch 전송 | 바뀐 메시지만 보내고 상태 보존·수렴을 유지한다. wire 크기와 브라우저 검증·동결 비용이 줄어든다. 로컬 구현 완료 |

1~8단계에서는 작은 fixture를 eager로 실어도 된다. 9~10단계에서 부분 전송과 미로드 상태가 들어올 때 카탈로그별 버전 계약을 적용한다. 위 표의 완료 기준은 그 단계의 데모·검증 목표이고, 1~13단계는 로컬 구현을 마쳤다.
