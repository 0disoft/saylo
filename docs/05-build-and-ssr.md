# 05. 빌드와 SSR

이 문서는 운영 빌드 형태, 지연 로딩, Vite 변환, SSR, 보안을 정한다.

## 운영 카탈로그 모델

- 운영은 미리 파싱·검증된 AST 카탈로그를 사용하고, 개발과 같은 core formatter를 공유한다.
- 빌드 시점 parser를 런타임에서 제거하는 것은 가능한 범위에서 시도한다. AST만 공급하면 parser가 빠질 수 있지만, 이는 bundler alias나 no-parser 전략을 검증해야 하는 항목이고 자동으로 보장되지 않는다. 런타임에 parser가 남을 수도 있다.
- core의 브라우저 엔트리에는 파일 시스템 접근이 없고 parser도 필수가 아니다. AST를 받으면 parser 없이 동작한다. 파일 시스템과 parser는 dev plugin과 build 경계에 둔다.
- 사용하지 않는 메시지 제거(emit/whole unused-message elimination)는 후속 최적화로 둔다. 동적 t 키를 쓰는 코드에서는 제거가 위험하므로 tradeoff를 근거와 함께 검증한 뒤 결정한다.

코드 생성 대기를 줄이는 접근이라는 점에서 코드젠 방식 도구([Paraglide 메시지 컴파일](https://paraglidejs.com/compiling-messages))와 HMR 방식 도구([Wuchale HMR](https://wuchale.dev/guides/hmr/)) 사이에 있다.

## 번역 검증 정책 (build)

- 제공된 번역의 문법·스키마 오류는 build를 실패시킨다. 깨진 번역을 배포하지 않는다.
- 번역이 아예 없는 키는 baseline fallback을 기본 허용한다.
- 모든 로케일 완역을 강제하는 `requireCompleteTranslations` 옵션은 후속·선택 사항으로 둔다. 기본 동작은 불완전한 번역을 허용하는 것이다.
- production build는 개발 캐시를 재사용하지 않는다. build는 현재 disk snapshot에서 전체를 다시 파싱·검증하고, baseline이 유효하지 않으면 build를 실패시킨다. 마지막 정상값 유지 규칙은 개발 전용이다.

## 지연 로딩

- 로케일과 namespace는 명시적 정적 loader map으로 지연 로딩한다. 전체 카탈로그를 한 번에 싣지 않는다.
- 서버에서 카탈로그를 파싱할 때 브라우저의 소스 파일 시스템에 접근하지 않는다. 서버가 파일을 읽어 파싱하고, 클라이언트는 결과를 받는다.

## 런타임 로케일 전환

- 로케일 전환은 비동기다. 카탈로그 로드를 보장한 뒤 스냅샷을 게시한다.
- 빠른 토글을 위해 load/commit generation token을 쓴다. 뒤늦게 도착한 이전 로케일 로드가 최신 전환을 덮어쓰지 못하게 한다.
- 네트워크 오류가 나면 이전 상태를 유지하고 요청을 실패로 처리한다. 빈 카탈로그로 갈아타지 않는다.
- baseline은 항상 로드돼 있어야 하며 fallback 대상이 된다.

## DEV/PROD 공통 경로

개발과 운영은 같은 정규화, parser 검증, formatter, fallback 구현을 쓴다. 두 경로가 같은 입력에 같은 결과를 내는지 벡터 비교(vector compare)로 확인한다. 개발에서만 통과하고 운영에서 갈라지는 차이를 막기 위한 장치다.

## Vite 변환

- 처음에는 안정적인 virtual module 하나를 노출한다. 이 모듈은 런타임 registry와 초기 카탈로그 스냅샷을 제공하고 HMR 이벤트 등록을 담당한다.
- 로케일을 동적으로 다시 export하는 const는 모듈을 무효화하지 않는다. 갱신은 store 스냅샷으로 전달하고, 모듈 자체를 바꾸지 않는다.
- 카탈로그 소스 파일을 앱 import 그래프에 넣지 않는다. 이 점은 [02-architecture.md](02-architecture.md)의 개발 서버 플러그인 규칙과 같다.

## SSR

- 요청마다 instance와 카탈로그 스냅샷을 만든다. 공유하는 것은 컴파일된 엔트리(파싱·검증 결과)뿐이다.
- 서버 전역 `setLocale`을 두지 않는다. 요청 간 로케일이 섞이는 원인이 된다.
- SSR 부팅은 hydration 시점의 locale, timeZone, schema revision, catalog revision이 일치해야 한다. hydration 이후 도착한 갱신(pending update)은 그 시점부터 반영한다.
- 서버 플러그인은 브라우저 갱신과 함께 SSR의 이후 요청에도 갱신된 카탈로그를 반영한다.
- 렌더 중인 스냅샷은 격리한다. 요청 처리 도중 스냅샷을 변형하지 않는다.
- `getServerSnapshot`은 브라우저 부팅 시점과 동등한 데이터를 반환하고, `subscribe`/`getSnapshot` 참조는 안정적으로 유지한다(`Object.is` 비교).
- hydration용으로 심는 boot JSON은 `<`, `</script` 같은 시퀀스를 escape해서 넣는다. boot 데이터에 locale, timeZone, schema revision, catalog revision을 함께 담는다.
- 날짜·시간은 timeZone을 명시적으로 config에서 받는다(기본 UTC 권장). 이렇게 해야 서버와 브라우저 결과가 갈리지 않는다. 자세한 캐시 키와 baseline fallback 포맷 규칙은 [03-catalog-and-api.md](03-catalog-and-api.md)를 따른다.

## 보안

- 카탈로그 로딩 경로는 로케일·namespace allowlist로 검증하고 루트 밖으로 나가지 못하게 한다(path traversal 방지).
- 임의 HTML을 자동 주입하지 않는다. 안전하지 않은 문자열은 프레임워크의 escape에 맡긴다.
- 개발용 커스텀 이벤트는 개발 전용이다. 운영에서 websocket 같은 상시 채널을 열지 않는다.

## 정리(cleanup)

watcher, event listener, socket은 abort 경로에서 정리한다. 개발 서버 재시작이나 HMR이 반복돼도 리스너가 쌓여 새지 않게 한다.
