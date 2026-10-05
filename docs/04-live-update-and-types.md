# 04. 라이브 갱신과 타입

이 문서는 개발 중 갱신을 받아들이는 정책, 상태 조정, 실패 복구, 삭제와 배치, 타입 생성 정책을 정한다. wire 타입과 적용 규칙의 단일 출처는 [08-update-protocol.md](08-update-protocol.md)다.

## revision과 patch

wire 타입(sessionId, baseRevision, revision, envelope)과 수신 순서는 [08-update-protocol.md](08-update-protocol.md)를 따른다. 이 문서는 그 갱신을 받아들이는 판정을 정한다.

- revision은 서버 세션(sessionId) 안에서 단조 증가한다. 서버가 재시작하면 sessionId가 바뀐다.
- envelope(sessionId, revision, 목록, schema)를 먼저 원자적으로 반영한다. payload는 이미 로드된 카탈로그에만 적용하고, 로드하지 않은 카탈로그는 dirty로 표시한 뒤 payload를 버린다.
- 같은 세션이고 이미 적용한 revision 이하인 patch는 버린다.
- baseRevision이 현재 적용 revision과 같고 revision이 더 크면 한 트랜잭션으로 적용한다.
- future baseRevision이나 적용할 수 없는 겹침이면 gap으로 보고 resync한다. 역순이라는 이유만으로 무조건 버리지 않는다.
- 재연결은 이전 세션 상태를 신뢰하지 않고, 진행 중인 모든 load와 request generation을 무효화한 뒤 full snapshot으로 다시 맞춘다.
- metadata와 payload는 같은 commit 안에서 반영하고, 알림은 그 commit이 끝날 때 한 번만 낸다.

시작 시점의 리스너 등록 → snapshot 요청 → patch 버퍼링 순서는 [02-architecture.md](02-architecture.md)의 시작 핸드셰이크를 따른다.

## desired-state 조정

현재 코어 구현은 `packages/core/src/i18n.ts`와 `catalog-loader.ts`다. desired locale·namespace의 준비를 합치고 pair/version별 요청을 공유한다. 미로드 namespace는 명시적으로 로드하며, present/missing 전체가 준비된 뒤 한 번 게시한다. stale 응답은 최대 3회 조회하고 실패 시 이전 UI를 유지한다. Vite는 manifest 전체와 요청한 parsed pair의 본문을 별도로 전달하며, loaded scope의 변경만 다시 조회한다. 아래 스키마 quarantine와 push 방식의 부분 patch는 후속 단계다. 현재 lazy 후보도 번역 스키마 검증에 실패하면 후보 전체를 거부한다.

로케일 전환과 namespace 로드는 하나의 desired state(locale + 원하는 namespace 집합)로 조정한다. generation은 transport의 오래된 완료를 차단하기 위한 값이지, generation이 바뀔 때마다 모든 호출자를 취소한다는 뜻이 아니다.

- 모든 base+target pair가 present 또는 missing으로 확정되면 한 번에 게시한다. 미완료 동안 이전 UI를 유지한다.
- namespace 추가가 교차 완료해도 새 generation의 고정 집합으로 다시 reconcile한다.
- 진행 중인 의도는 pending waiter로 유지한다. 그 의도가 최신 desired state에 남아 있는 동안에는 준비가 끝날 때 그 waiter가 resolve한다.
- 예: `setLocale("en")` 진행 중 `loadNamespace("cart")`를 추가하면 desired locale은 en, desiredNamespaces는 cart를 포함하도록 늘어난다. 두 호출은 여전히 최신 desired state에 포함되므로, 새 locale과 base 로드가 준비되면 둘 다 resolve한다.
- 앞선 locale 의도가 실제로 대체되었을 때만(`en` 전환 중 `ko`로 재전환) 앞선 `setLocale` 호출을 `SupersededRequestError`로 reject한다. `dispose`는 별도 사유로 reject한다.
- `loadNamespace`는 locale 전환 뒤에도 그 namespace를 쓰겠다는 의도이므로, 새 locale과 base 로드가 준비되면 resolve한다.
- timeout이나 network 실패는 현재 의도를 reject하고 이전 UI를 유지한다.
- 낡은 load 결과는 그 key의 알려진 catalogVersion, sessionId, namespaceSchemaFingerprint와 비교한다. 전역 registry 카운터와 단순 비교하지 않는다. 변경되지 않은 namespace의 schema hash는 다른 namespace 변경과 독립이다.
- 결과가 유효하면 cache를 재사용할 수 있다. generation이 바뀐 obsolete network 응답은 직접 UI에 게시하지 않는다.
- tombstone으로 삭제한 version을 보존해, 삭제 전에 시작한 load가 되살아나지 않게 한다.
- 정상 목적의 두 동시 API 호출이 서로를 reject하지 않는다. 의도 대체로 인한 reject는 앞선 의도가 실제로 대체된 경우로 한정한다. dispose와 조회 실패는 각각 별도 실패 사유다.

## 커밋 트랜잭션

- 커밋 단위는 로케일+namespace 카탈로그 하나다.
- 서버는 후보(candidate)를 검증한 뒤 맵과 메타데이터를 원자적으로 교체한다. 검증에 실패하면 유효한 revision을 그대로 유지한다.
- 편집이 몰려(버스트) dirty 큐가 쌓이면 직렬로 커밋한다. schema·카탈로그 의존성 검증을 거치고, 최신 generation이 최종 목표 상태가 된다.
- UI 게시는 하나의 atomic candidate 계산으로 한다. schema는 새것이고 catalog는 옛것인 중간 상태를 구독자에게 노출하지 않는다.

## 실패와 복구

- JSON이나 ICU가 깨진 파일은 그 카탈로그의 마지막 정상값(last-known-good)을 유지한다. 파일명, 키, 가능하면 줄 번호를 담은 진단을 낸다.
- 서버가 판정한 missing(파일 없음)과 조회 실패(failed)를 구분한다. failed면 이전 UI를 유지하고 그 호출의 Promise를 `CatalogLoadError`로 reject한다.
- 처음 마주친 오류는 명시적 진단으로 보여준다. 값을 그대로 노출하는 가짜 카탈로그를 만들지 않는다.
- 기준 로케일 카탈로그가 잘못되면 개발에서는 변경을 거부하고 기준의 마지막 정상값과 그때의 schema를 유지한다. 처음부터 기준 카탈로그가 유효하지 않으면 명시적 치명 오류로 멈춘다.
- 새 secondary 파일에 문법·스키마 오류가 있으면 그 파일의 마지막 정상값을 유지하되, 기준 schema와 호환되는 항목만 사용한다.
- secondary 카탈로그 조회 결과가 missing이면 baseline 카탈로그로 fallback한다. 정상 present 결과는 번역을 사용한다. baseline namespace 자체가 로드되지 않았으면 `NamespaceNotLoadedError`다.
- queue가 폭주하면 bounded buffer로 정리하고 resync한다. 규칙은 [08-update-protocol.md](08-update-protocol.md)를 따른다.

## 삭제와 배치

파일 삭제·이름 변경·추가의 배치 판정은 [02-architecture.md](02-architecture.md)의 후보 registry와 배치 게시 규칙을 따른다. 이 문서는 그 판정이 만들어 내는 결과만 정리한다.

- namespace 삭제는 허용하고 기준 로케일 전체 삭제는 거부한다. 이 둘을 구분한다.
- 서버가 받아들인 기준 변경과 부적합해진 secondary의 quarantine는 같은 배치로 게시한다.
- 삭제 전에 시작한 load가 되살아나지 않도록 tombstone version을 보존한다.

## 기준 schema 변경과 DOM 보존 범위

기준 로케일의 키나 placeholder가 바뀌면 그 키를 쓰던 secondary 번역이 부적합해질 수 있다. 화면 전체 갱신을 막으면 라이브 반영이라는 목적에 어긋나므로 다음처럼 처리한다.

- 유효한 base 변경은 커밋한다. 커밋을 미루지 않는다.
- 부적합해진 기존 secondary 메시지는 개발 중 quarantine(격리)하고 진단을 낸다. 그 메시지는 base 값으로 fallback해 화면이 깨지지 않게 한다.
- base 변경과 locale 카탈로그는 후보 트랜잭션에서 함께 검증한다. 기준 schema와 각 locale schema가 맞는 조합만 커밋한다.

DOM 상태 보존 범위는 편집 종류로 나눈다.

| 편집 | schema | DOM 상태 |
| --- | --- | --- |
| 문구 값 수정, locale 추가 | 유지 | 보장한다. remount하지 않는다 |
| schema-compatible 키 편집 | 유지 | 보장한다 |
| 키 삭제, 필수 인자 추가 | 변경 | 보장하지 않는다. 새 schema는 즉시 적용하고 진단·typegen을 함께 낸다 |

schema-breaking 편집은 기존 호출부가 `InvalidArgumentError`를 낼 수 있다. quarantine는 호출부를 보호하지 않는다.

## 오류와 fallback 규칙

| 상황 | 동작 |
| --- | --- |
| 번역이 없는 키 | baseline(baseLocale) 값으로 fallback |
| 값이 빈 문자열 | 유효한 값으로 취급한다(폴백 아님) |
| 알 수 없는 키 | 모든 환경에서 `UnknownMessageError`. 키 문자열을 그대로 노출하지 않는다 |
| 로드하지 않은 namespace 접근 | `NamespaceNotLoadedError`. `loadNamespace`로 명시 로드한 뒤 사용한다 |
| 필수 인자 누락·잘못된 타입 | accepted base schema 기준으로 `InvalidArgumentError` |
| catalog 조회 실패(failed) | 이전 UI 유지, Promise는 `CatalogLoadError`로 reject |
| 앞선 의도가 대체됨 | `SupersededRequestError` |
| secondary namespace 파일 삭제 | 그 namespace 키 접근은 baseline 값으로 fallback |
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

- typegen의 입력은 서버가 받아들인 accepted schema다.
- registry 커밋 뒤에 client publish와 typegen은 서로 독립적으로 병렬 진행한다. 한쪽이 다른 쪽을 기다리지 않는다.
- typegen이 항상 브라우저보다 뒤처진다는 보장은 두지 않는다. 네트워크와 처리 순서에 따라 앞설 수도 있다.
- UI 경로는 typegen을 await하지 않는다. runtime 갱신은 typegen과 무관하게 반영한다.
- strict generated types는 저장하는 순간 새 키의 autocomplete를 보장하지 않는다. typegen이 끝난 뒤에만 타입이 갱신된다.
- typegen은 배경 작업으로 돌리고 generation token으로 오래된 작업이 최신 생성물을 덮어쓰지 못하게 한다. 생성 결과는 내용이 실제로 바뀐 경우에만 원자적으로 쓴다.
- build는 typegen 완료를 기다린다. 초기 schema readiness는 dev serve 시작 시점에 typegen을 먼저 끝내 소비자보다 앞서도록 한다.

현재 구현은 `@saylo/typegen`의 선언 renderer·CLI·worker와 `@saylo/vite`의 `typegen.outFile` 옵션이다. Vite는 accepted baseline schema를 전달하며 라이브 snapshot을 전송한 뒤 배경 생성을 요청한다. 대기 중인 작업은 최신 generation으로 합치고, 오래된 결과는 원자적 파일 교체 전에 다시 확인한다. 초기 생성 실패는 startup을 중단하고 라이브 생성 실패는 서버 로그에 남긴다. CLI는 디스크 카탈로그 전체의 strict 검증을 완료한 뒤 선언을 생성한다. React 데모의 build 순서는 generate → consumer tsc → Vite build다. `.d.ts`와 해당 generator의 임시 파일만 watch/HMR에서 제외하며, 무관한 타입 파일은 그대로 감시한다.

## 캐시

- 메시지 formatter 캐시와 `Intl` 캐시를 분리한다. 키와 무효화 규칙은 [03-catalog-and-api.md](03-catalog-and-api.md)의 포맷 캐시 표를 따른다.
- 카탈로그 revision이 바뀌어도 문구 내용이 그대로면 모든 `Intl` 캐시를 비우지 않는다.
- full replacement에서도 AST fingerprint가 그대로인 메시지는 formatter를 재사용한다. 오래된 항목은 LRU 등으로 bounded하게 정리한다.
- 변경하지 않은 메시지의 재사용과 superseded 항목 제거를 함께 정한다. full replacement 비용은 대규모 fixture 벤치마크 후 message delta 도입 여부를 판단한다.

## 로케일 목록 타입

로케일 목록을 TypeScript literal union으로 만들면 로케일을 추가할 때마다 코드젠을 기다려야 한다. 그래서 런타임 로케일 목록은 `readonly string[]`으로 노출하고, 동적 locale setter는 허용 목록(allowlist)으로 검증한다. 반면 키 이름과 argument 타입은 strict하게 유지한다. schema와 값의 엄격성은 남기고 로케일 집합만 런타임 값으로 푼다.
