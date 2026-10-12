# 05. 빌드와 SSR

이 문서는 운영 빌드 형태, 지연 로딩, Vite 변환, SSR, 보안, 정리를 정한다.

## 운영 카탈로그 모델

- 운영은 미리 파싱·검증된 AST 카탈로그를 사용하고, 개발과 같은 core formatter를 공유한다.
- 빌드 시점 parser를 런타임에서 제거하는 경로를 Vite plugin에 로컬 구현했다(옵션 `astRuntime`, 기본 `true`, production 한정). Saylo `core/dist/formatters.js`가 `intl-messageformat`을 import할 때만 그 모듈을 별도 virtual 모듈로 해석하고, 그 모듈의 의존성을 공개 `@formatjs/icu-messageformat-parser/no-parser.js`로 바꾼다. 앱 전체 alias는 걸지 않는다.
- no-parser 구성은 Saylo의 AST 전용 배포 경계 안에서만 다룬다. 외부에서 `IntlMessageFormat(string)`을 쓰는 소비자는 원본 parser를 그대로 쓴다.
- 외부로 해석되는 의존성은 건드리지 않으므로 SSR external 의존성도 그대로다. 앱이 런타임에 직접 `parseCatalog`를 호출하면 parser가 포함되는 것이 정상이다. `astRuntime: false`로 이 경로를 끌 수 있다.
- 공개 `@0disoft/saylo-core/runtime` 엔트리는 `parseCatalog`를 제외하고, 기존 루트 엔트리는 기존 API를 그대로 유지한다.
- 런타임 엔트리만 쓴다고 모든 bundler에서 parser 제거가 보장되지는 않는다. 검증 범위는 Vite 8 production build다. 런타임에 parser가 남을 수도 있다.
- core의 브라우저 엔트리에는 파일 시스템 접근이 없고 parser도 필수가 아니다. AST를 받으면 parser 없이 동작한다. 파일 시스템과 parser는 dev plugin과 build 경계에 둔다.
- 사용하지 않는 메시지 제거는 수동 목록으로 로컬 구현했다. Vite 플러그인 `includeKeys` 옵션에 `namespace:messageId` 목록을 넘기면 그 키만 빌드 출력에 남긴다. 목록은 손으로 관리하며 소스 코드를 스캔해 필요한 키를 자동으로 찾지 않는다. 동적 키를 빠뜨리면 운영에서 `UnknownMessageError`가 난다.
- 소스 코드 분석으로 미사용 메시지를 자동 제거하는 최적화는 후속으로 둔다. 동적 t 키를 쓰는 코드에서는 제거가 위험하므로 tradeoff를 근거와 함께 검증한 뒤 결정한다.

코드 생성 대기를 줄이는 접근이라는 점에서 코드젠 방식 도구([Paraglide 메시지 컴파일](https://paraglidejs.com/compiling-messages))와 HMR 방식 도구([Wuchale 개발 모드](https://wuchale.dev/guides/dev/)) 사이에 있다.

## 번역 검증 정책 (build)

- 제공된 번역의 문법·스키마 오류는 build를 실패시킨다. 깨진 번역을 배포하지 않는다.
- 번역이 아예 없는 키는 baseline fallback을 기본 허용한다.
- 모든 로케일 완역을 강제하는 `requireCompleteTranslations` 옵션은 `0.1.0-alpha.3`에 구현했다. 기본값은 `false`이고 production build(`config.command === 'build'`)에서만 엄격 검증한다. 기본값과 개발 경로는 불완전한 번역 누락과 baseline fallback을 그대로 허용한다.
- production build는 개발 캐시를 재사용하지 않는다. build는 현재 disk snapshot에서 전체를 다시 파싱·검증하고, baseline이 유효하지 않으면 build를 실패시킨다. 마지막 정상값 유지 규칙은 개발 전용이다.

## 지연 로딩

- 로케일과 namespace는 `CatalogSource`를 통해 지연 로딩한다. 전체 카탈로그를 한 번에 싣지 않는다.
- 개발은 범용 `loadCatalog(locale, namespace)`가 현재 registry를 조회한다. 운영은 boot pair를 inline으로 싣고 나머지 present pair를 생성된 literal `import()` loader entry로 분리한다(`createStaticCatalogSource`). 둘 다 같은 인터페이스를 뒤에 둔다.
- 서버에서 카탈로그를 파싱할 때 브라우저의 소스 파일 시스템에 접근하지 않는다. 서버가 파일을 읽어 파싱하고, 클라이언트는 결과를 받는다.

## 런타임 로케일 전환

- 로케일 전환은 비동기다. 카탈로그 로드를 보장한 뒤 스냅샷을 게시한다.
- 로케일 전환과 namespace 로드는 하나의 desired state로 조정한다. 미완료 동안 이전 UI를 유지하고, 모든 base+target pair가 확정되면 한 번에 게시한다. 판정 규칙은 [04-live-update-and-types.md](04-live-update-and-types.md)를 따른다.
- 빠른 토글을 위해 load/commit generation token을 쓴다. 뒤늦게 도착한 이전 로케일 로드가 최신 전환을 덮어쓰지 못하게 한다.
- 네트워크 오류가 나면 이전 상태를 유지하고 그 요청을 실패로 처리한다. 빈 카탈로그로 갈아타지 않는다.
- baseline은 항상 로드돼 있어야 하며 fallback 대상이 된다. fallback 대상은 baseLocale 하나다.

## DEV/PROD 공통 경로

개발과 운영은 같은 정규화, parser 검증, formatter, fallback 구현을 쓴다. 두 경로가 같은 입력에 같은 결과를 내는지 벡터 비교(vector compare)로 확인한다. 개발에서만 통과하고 운영에서 갈라지는 차이를 막기 위한 장치다.

## Vite 변환

- `virtual:saylo`(eager 전체 registry)와 `virtual:saylo/lazy`(boot data와 catalogSource) 두 virtual module을 노출한다. HMR 이벤트 등록은 `connectDev`가 담당한다.
- 로케일을 동적으로 다시 export하는 const는 모듈을 무효화하지 않는다. 갱신은 store 스냅샷으로 전달하고, 모듈 자체를 바꾸지 않는다.
- namespace manifest가 동적으로 늘거나 줄면 patch envelope의 `availableNamespaces`와 mutable manifest handle 갱신으로 전달한다. 개발에는 정적 namespace map이 없다. 새 namespace 조회는 범용 `loadCatalog`가 처리하고, 정적 loader map은 운영에서만 생성한다.
- Vite dev server 재시작이나 websocket 재연결에서 Vite client가 스스로 full reload(`location.reload`)를 하는 경우가 있다. 그 경로는 Saylo의 DOM 보존 범위 밖이다. Saylo의 무리로드 보장은 정상 번역 변경에 한정한다.
- 카탈로그 소스 파일을 앱 import 그래프에 넣지 않는다. 이 점은 [02-architecture.md](02-architecture.md)의 개발 서버 플러그인 규칙과 같다.

## SSR

- 요청마다 instance와 immutable 카탈로그 snapshot을 만든다. 공유하는 것은 컴파일된 엔트리(파싱·검증 결과)뿐이다.
- 서버 전역 `setLocale`을 두지 않는다. per-request instance를 쓴다. 요청 간 로케일이 섞이는 원인을 없앤다.
- context factory가 만든 hook의 `t`는 그 렌더에 묶인다. boot S1로 hydration하는 동안 `t`도 S1을 읽는다.
- hydration barrier 동안 S2 이벤트는 buffer에 담고, barrier가 끝날 때 한 번만 적용한다.
- client는 `createHydrationAdapter(instance)`로 감싼다. adapter는 root마다 새로 만들고 boot S1을 유지하며 underlying snapshot은 최신 하나로 buffer한다. `finishHydration()`을 호출해야 한 번 publish하고 그 뒤에도 `getServerSnapshot`은 S1을 반환한다. `adapter.dispose()`는 자신이 건 구독만 해제하고 원래 instance의 `dispose()`는 앱이 따로 호출한다.
- `getServerSnapshot`은 decode한 boot 데이터를 고정 identity로 반환한다. `subscribe`/`getSnapshot` 참조는 안정적으로 유지한다(`Object.is` 비교).
- 렌더 중인 스냅샷은 격리한다. 요청 처리 도중 스냅샷을 변형하지 않는다.
- 서버 플러그인은 브라우저 갱신과 함께 SSR의 이후 요청에도 갱신된 카탈로그를 반영한다.

### 부팅 데이터

- boot wire v1은 `format: 'saylo-boot-v1'`에 `manifest`, `locale`, `timeZone`, `stateRevision`, `loadedNamespaces`, `baseSchemas`(`CatalogSchema[]`), `catalogOutcomes`(`CatalogOutcome[]`)를 담는다. `createBootSnapshot`·`serializeBootSnapshot`·`decodeBootSnapshot`이 공개 API다.
- 현재 `catalogOutcome`은 parsed catalog의 sourceName·locale·AST·인자를 배열로 싣고 loaded base+target pair의 present/missing을 빠짐없이 명시한다. decode는 누락·중복 outcome과 stamp·schema 불일치를 `INVALID_BOOT`로 거부하고, boot timeZone은 config와 일치해야 한다. [03-catalog-and-api.md](03-catalog-and-api.md)의 `CatalogRecord`·`Map` 모형은 초안이며 후속 단계다.
- `serializeBootSnapshot`은 모든 `<`를 `\u003c`로, U+2028·U+2029를 escape한다. `createServerI18n({ catalogSource, locale, initialNamespaces, timeZone?, requestTimeoutMs? })`는 async scope를 준비한 뒤 요청별 instance를 만들고, `getServerSnapshot`이 생성 시점 snapshot이므로 렌더 전에 scope를 확정하려면 이 factory를 쓴다. `virtual:saylo/server`는 플러그인 기본값을 적용하는 `createRequestI18n`과 서버용 `catalogSource`를 노출한다.
- HTML에 넣는 JSON은 모든 `<`를 `\u003c`로 치환해 `</script>` 종료를 막는다.
- 날짜·시간 인자로 Date를 받을 때 내부에서 현재 시각(`Date.now`/`currentTime`)을 만들지 않는다.
- timeZone은 config에 값을 저장하는 것만으로 모든 날짜 포맷에 자동 적용되지 않는다. resolved timeZone을 기본 date/time 스타일과 skeleton 경로 모두에 전달한다(provide formatters cache override).

## 보안

- 카탈로그 로딩 경로는 로케일·namespace allowlist로 검증하고 루트 밖으로 나가지 못하게 한다(path traversal 방지).
- 임의 HTML을 자동 주입하지 않는다. 안전하지 않은 문자열은 프레임워크의 escape에 맡긴다.
- 개발용 커스텀 이벤트는 개발 전용이다. 운영에서 websocket 같은 상시 채널을 열지 않는다.

## 정리(cleanup)

- watcher, event listener, socket은 abort 경로에서 정리한다. 개발 서버 재시작이나 HMR이 반복돼도 listener가 쌓여 새지 않게 한다.
- Vite dev server가 watcher와 websocket을 소유한다. Saylo는 공유 watcher와 socket을 닫지 않고 자신이 등록한 listener와 bridge 구독만 해제한다.
- saylo가 생성한 `.d.ts`와 typegen 임시 파일은 Saylo의 감시·이벤트 범위에서 제외한다. 임시 파일이 앱 watch HMR을 유발하지 않도록 좁은 ignore 규칙을 검증한다.
