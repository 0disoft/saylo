# 06. 검증과 로드맵

이 문서는 성능 목표, 인수 사례, 검증 방식, 빌드 순서, 개발 로드맵을 정한다.

## 성능 목표 (임시, 미측정)

아래 수치는 목표이며 아직 측정하지 않았다. 벤치마크도 아직 없다.

| 항목 | 목표 | 조건 |
| --- | --- | --- |
| 개발 중 카탈로그 문자열 수정 반영 | p95 ≤ 100ms | warmed 상태, 로컬 기준 환경 |
| 로케일 추가 | p95 ≤ 250ms | 대표 fixture |

측정 방법:

- 종단 간 측정은 하나의 monotonic clock으로 한다. 개발 서버(브라우저 밖)와 브라우저의 `performance.now`는 서로 다른 clock이라 두 값을 직접 빼지 않는다. 같은 프로세스에서 도는 제어 harness로 파일 관측부터 DOM 커밋까지를 한 clock으로 재거나, 동기화 추정 오차를 수치와 함께 명시한다.
- watcher/parse/publish 단계와 수신/DOM 커밋 단계는 따로 측정해 어느 구간이 병목인지 드러낸다.
- 수정 반영과 로케일 추가는 p50과 p95를 함께 보고한다.
- 작은 규모에서만 돌린 벤치마크로 일반화하지 않는다. 규모를 나눠 측정한다. 예: 메시지 1k/10k, 로케일 3/20.
- typegen 비용과 cold startup은 수정 반영 수치에서 분리해 별도로 잰다.
- CI에서 광범위한 매트릭스로 비용을 부풀리지 않는다. 필요한 조합만 돌린다.

## 인수 사례

초기 구현이 만족해야 할 핵심 사례다. 아직 통과를 주장하지 않는다.

| # | 사례 | 확인 내용 |
| --- | --- | --- |
| 1 | 상태 보존 | 문구 수정 후 입력값·모달·스크롤 위치가 유지된다 |
| 2 | 추가·수정·삭제 | 키 추가, 값 수정, 키 삭제가 각각 수렴한다 |
| 3 | 파싱 복구 | 깨진 JSON/ICU를 넣어도 마지막 정상값이 유지되고 진단이 나온다 |
| 4 | 재연결·갭 | 새 세션·revision gap에서 full snapshot으로 복구하고, 중복·오래된 patch는 discard한다 |
| 5 | 비동기 타입 schema | baseline schema 변경 시 quarantine과 fallback이 동작한다 |
| 6 | 포맷 일치 | 변수, number/date/time, plural/select가 같은 Intl locale data·런타임에서 dev/prod 동일 출력을 낸다(고정 timeZone, 고정 시각 입력) |
| 7 | SSR 동시성 | 요청 간 로케일·카탈로그가 섞이지 않는다 |
| 8 | JS/TS 소비 | JS 프로젝트와 TS 프로젝트에서 모두 설치·소비가 된다(스모크) |

날짜·시간을 다루는 검사는 timeZone을 고정하고 고정 시각 입력을 쓴다. 런타임에서 현재 시각(`Date.now`/`currentTime`)을 호출하지 않는다. 네이티브 ICU 지원은 OS·브라우저마다 다르므로 parity는 같은 Intl 데이터·런타임 매트릭스 아래에서만 의미가 있다.

## 빌드 순서

순서는 typegen(generate) → tsc(consumer 타입 체크) → build(Vite)다. Vite build 자체는 consumer TS 타입 체크를 하지 않으므로 tsc를 build 앞에 둔다. 별도 package/version 설정 파일 구현은 이번 범위 밖이다.

## 검증 방식

- 이번 작업은 문서 전용이다. 지금 할 수 있는 검증은 문서 링크 확인 수준이다.
- 실행하지 않은 검사는 pass가 아니다.

## 로드맵

작은 커밋 단위로 나눠 순차 진행한다. 각 단계는 그 자체로 쓸 수 있는 데모를 남기는 것을 목표로 한다. 이번 문서 작업에서 구현은 하지 않는다.

1. 카탈로그 로더와 core store. JSON 파싱·검증, snapshot/patch 타입, revision 관리.
2. Vite dev plugin. handleHotUpdate 기반 커스텀 이벤트, add/unlink 처리, dedupe.
3. vanilla subscription 어댑터와 최소 데모. 상태 보존 확인.
4. React 어댑터. Provider, `useI18n`, `useSyncExternalStore` 연동.
5. typegen. schema 추출, generation token, 원자적 쓰기, build 대기.
6. 운영 빌드와 SSR. AST 카탈로그, 지연 로딩, per-request 스냅샷.
