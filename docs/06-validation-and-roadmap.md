# 06. 검증과 로드맵

이 문서는 성능 목표와 측정 정의, 인수 사례, 빌드 순서, 개발 로드맵을 정한다.

## 성능 목표 (임시, 미측정)

아래 수치는 목표이며 아직 측정하지 않았다. 벤치마크도 아직 없다.

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

## 인수 사례

초기 구현이 만족해야 할 핵심 사례다. 아직 통과를 주장하지 않는다.

2026-10-05 로컬 구현은 8단계까지 진행했다. 코어 33개, Vite 어댑터 28개, React 어댑터 5개, typegen 5개 테스트와 JS/TS 소비 타입 검사, React 데모 TS 검사가 통과했다. vanilla와 React production 빌드가 통과했다. 개발 브라우저에서 한국어·영어 파일 저장 후 문구 갱신, 입력값·포커스·커서·스크롤·열린 모달 유지, 잘못된 JSON의 마지막 정상 상태 유지와 수정 후 복구를 확인했다. vanilla에서 일본어 로케일·namespace 추가, 임시 파일 교체 저장, 현재 로케일 삭제 후 기준 언어 전환도 실제 watcher로 확인했다. React StrictMode에서 controlled input과 수량·모달 상태 보존, JSON 오류 복구와 언어 전환을 확인했다. 새 기준 키 추가로 `.d.ts`가 갱신되는 동안에도 React 상태가 유지되고, 문구만 수정하면 선언 파일의 수정 시간이 바뀌지 않는 것을 확인했다. typegen 검사는 초기 readiness, snapshot 우선 게시, generation 취소·최신 결과 수렴, 동일 내용의 쓰기 생략, 실패 후 선언 유지·재시도, 생성 파일 watch 제외와 생성된 타입의 TS/checkJs 소비를 확인한다. 성능 측정·부분 전송·SSR은 미완료다.

| # | 사례 | 확인 내용 |
| --- | --- | --- |
| 1 | 상태 보존 | 문구 수정 후 입력값·모달·스크롤 위치가 유지된다 |
| 2 | 추가·수정·삭제 | 키 추가, 값 수정, 키 삭제가 각각 수렴한다 |
| 3 | 파싱 복구 | 깨진 JSON/ICU를 넣어도 마지막 정상값이 유지되고 진단이 나온다 |
| 4 | 재연결·갭 | 새 세션·revision gap에서 full snapshot으로 복구하고, 중복·오래된 patch는 discard한다. Vite 재시작 후 DOM 보존은 요구하지 않는다 |
| 5 | 비동기 타입 schema | baseline schema 변경 시 quarantine과 fallback이 동작한다. 키 삭제·필수 인자 추가 후 기존 호출 오류는 진단하며 DOM 보존을 요구하지 않는다 |
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

날짜·시간을 다루는 검사는 timeZone을 고정하고 고정 시각 입력을 쓴다. 런타임에서 현재 시각(`Date.now`/`currentTime`)을 호출하지 않는다. 네이티브 ICU 지원은 OS·브라우저마다 다르므로 parity는 같은 Intl 데이터·런타임 매트릭스 아래에서만 의미가 있다.

## 빌드 순서

순서는 typegen(generate) → tsc(consumer 타입 체크) → build(Vite)다. Vite build 자체는 consumer TS 타입 체크를 하지 않으므로 tsc를 build 앞에 둔다. 별도 package/version 설정 파일 구현은 이번 범위 밖이다.

## 검증 방식

- 이번 작업은 문서 전용이다. 공개 타입 선언을 분리해 TS와 checkJs 소비 사례를 검사하고, Markdown 링크·JSON 예제·코드 블록·파일 크기를 확인한다. 결과는 [리뷰 반영 기록](../review/feedback-resolution.ko.md)에 남긴다.
- 실행하지 않은 검사는 pass가 아니다. 문서 링크 확인도 항목별로 남긴다.
- 검증하지 않은 항목은 미검증으로 유지한다. 성능 수치는 전부 목표치다.

## 로드맵

작은 커밋 단위로 나눠 순차 진행한다. 각 단계는 그 자체로 쓸 수 있는 데모를 남기는 것을 목표로 한다. 처음에는 작은 fixture를 eager로 실어 상태 보존을 보여주고, 이후 같은 API 아래에서 전송을 세분화한다. 이번 문서 작업에서 구현은 하지 않는다.

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
| 10 | 지연 로딩과 전환 조정 | desired locale·namespace 준비 상태, missing·failure·stale 결과를 처리한다 |
| 11 | fresh production build | 현재 디스크 검증 → typegen → consumer 검사 → AST·정적 loader 산출을 연결한다 |
| 12 | SSR serializer와 hydration fixture | 요청별 snapshot, boot escape, hydration 직전 갱신을 검증한다 |

1–8단계에서는 작은 fixture를 eager로 실어도 된다. 9–10단계에서 부분 전송과 미로드 상태가 들어올 때 카탈로그별 버전 계약을 적용한다.
