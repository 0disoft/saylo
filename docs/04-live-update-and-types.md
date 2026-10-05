# 04. 라이브 갱신과 타입

이 문서는 개발 서버의 갱신 프로토콜, 실패 복구, 타입 생성 정책을 정한다.

## revision과 patch

wire 타입(sessionId, baseRevision, revision, envelope)과 적용 순서는 [03-catalog-and-api.md](03-catalog-and-api.md)의 HMR 프로토콜을 따른다. 이 문서는 그 갱신을 받아들이는 정책을 정한다.

- revision은 서버 세션(sessionId) 안에서 단조 증가한다. 서버가 재시작하면 sessionId가 바뀐다.
- envelope(sessionId, revision, locales, schemaRevision)를 먼저 원자적으로 반영한다. payload는 이미 로드된 카탈로그에만 적용하고, 로드하지 않은 카탈로그는 dirty로 표시한 뒤 payload를 버린다.
- 같은 patch를 두 번 받거나 순서가 뒤바뀌거나 오래된 patch가 뒤늦게 도착하면 discard한다. resync는 새 세션이거나 revision gap일 때만 한다.
- 재연결 후에는 이전 세션 상태를 신뢰하지 않고 full snapshot으로 다시 맞춘다.

시작 시점의 리스너 등록 → snapshot 요청 → patch 버퍼링 순서는 [02-architecture.md](02-architecture.md)의 시작 핸드셰이크를 따른다.

## 커밋 트랜잭션

- 커밋 단위는 로케일+namespace 카탈로그 하나다.
- 서버는 후보(candidate)를 검증한 뒤 맵과 메타데이터를 원자적으로 교체한다. 검증에 실패하면 유효한 revision을 그대로 유지한다.
- 편집이 몰려(버스트) dirty 큐가 쌓이면 직렬로 커밋한다. schema·카탈로그 의존성 검증을 거치고, 최신 generation이 최종 목표 상태가 된다. baseline 변경으로 어떤 secondary 메시지가 격리되고 locales metadata가 함께 바뀌면, 그 변경들을 같은 global transaction으로 publish한다. 일부만 먼저 노출되는 모순 상태를 만들지 않는다.

## 실패와 복구

- JSON이나 ICU가 깨진 파일은 그 카탈로그의 마지막 정상값(last-known-good)을 유지한다. 파일명, 키, 가능하면 줄 번호를 담은 진단을 낸다.
- 처음 마주친 오류는 명시적 진단으로 보여준다. 값을 그대로 노출하는 가짜 카탈로그를 만들지 않는다.
- 기준 로케일(baseline) 카탈로그가 잘못되면 개발에서는 변경을 거부하고 baseline의 마지막 정상값과 그때의 schema를 유지한다.
- 새 secondary 파일에 문법·스키마 오류가 있으면 그 파일의 마지막 정상값을 유지하되, baseline schema와 호환되는 항목만 사용한다.

## 기준 schema 변경 정책 (quarantine)

기준 로케일의 키나 placeholder가 바뀌면 그 키를 쓰던 secondary 번역이 부적합해질 수 있다. 이때 화면 전체 갱신을 막으면 라이브 반영이라는 목적에 어긋난다. 그래서 다음처럼 처리한다.

- 유효한 base 변경은 커밋한다. 커밋을 미루지 않는다.
- 부적합해진 기존 secondary 메시지는 개발 중 quarantine(격리)하고 진단을 낸다. 그 메시지는 base 값으로 fallback해 화면이 깨지지 않게 한다.
- base 변경과 locale 카탈로그는 후보 트랜잭션에서 함께 검증한다. baseline schema와 각 locale schema가 맞는 조합만 커밋한다.

## 오류와 fallback 규칙

| 상황 | 동작 |
| --- | --- |
| 번역이 없는 키 | baseline 값으로 fallback |
| 값이 빈 문자열 | 유효한 값으로 취급한다(폴백 아님) |
| 알 수 없는 키 | 모든 환경에서 `UnknownMessageError`. 키 문자열을 그대로 노출하지 않는다 |
| 로드하지 않은 namespace 접근 | `NamespaceNotLoadedError`. `loadNamespace`로 명시 로드한 뒤 사용한다 |
| namespace 파일 삭제 | 그 namespace 키 접근은 baseline 값으로 fallback |
| baseline namespace 삭제 | 해당 키 삭제 + schema 갱신. 이후 접근은 unknown key |
| 현재 로케일 카탈로그 전부 삭제 | baseLocale로 전환해 원자적으로 게시 |
| baseline 로케일 전체 삭제 | 개발에서는 거부하고 last-known-good 유지(파일 단위 namespace 삭제와 구분) |
| 이름 변경(rename) | 최종 카탈로그가 정합적이어야 한다 |
| JSON 안 중복 ID | 거부한다(parser 전처리로 감지) |

## 타입 생성 (typegen)

무엇을 고치느냐에 따라 typegen 필요 여부가 갈린다.

| 수정 | key·argument schema | typegen |
| --- | --- | --- |
| 문구 값만 수정 | 불변 | 불필요. 즉시 반영 |
| secondary 번역 추가·수정 | 불변 | 불필요. 즉시 반영 |
| 로케일 추가 | 불변 | 불필요. 즉시 반영 |
| baseline key·placeholder 변경 | 변경 | 필요. pending → ready 또는 error |

로케일 추가가 typegen을 부르지 않는 이유는 타입이 기준 메시지에서만 나오기 때문이다([03-catalog-and-api.md](03-catalog-and-api.md)의 argument 계약).

- baseline key·placeholder가 바뀌면 schema가 바뀌므로 typegen이 돈다. 그동안 UI는 먼저 성공한 카탈로그를 반영하고 typegen을 기다리지 않는다.
- strict generated types는 저장하는 순간 새 키의 autocomplete를 보장하지 않는다. typegen이 끝난 뒤에만 타입이 갱신된다.
- typegen 입력은 UI catalog 커밋과 같은 accepted schema revision이다. UI가 그 schema를 커밋한 뒤에 typegen이 돈다. 그래서 typegen은 런타임보다 앞설 수 없고, 뒤처질 수만 있다. 상태는 pending → ready 또는 error이고, pending 중에도 UI는 이미 커밋된 카탈로그를 그대로 사용한다.
- typegen은 배경 작업으로 돌리고 generation token으로 오래된 작업이 최신 생성물을 덮어쓰지 못하게 한다. 생성 결과는 내용이 실제로 바뀐 경우에만 원자적으로 쓴다.
- build는 typegen 완료를 기다린다. 초기 schema readiness는 dev serve 시작 시점에 typegen을 먼저 끝내 소비자보다 앞서도록 한다. 이후 런타임 갱신은 대기 없이 반영한다.

## 로케일 목록 타입

로케일 목록을 TypeScript literal union으로 만들면 로케일을 추가할 때마다 코드젠을 기다려야 한다. 그래서 런타임 로케일 목록은 `readonly string[]`으로 노출하고, 동적 locale setter는 허용 목록(allowlist)으로 검증한다. 반면 키 이름과 argument 타입은 strict하게 유지한다. schema와 값의 엄격성은 남기고 로케일 집합만 런타임 값으로 푼다.
