# 67. thin-layer lazy scope 계약

## 범위

[66](66-thin-layer-ssr-production.md) 뒤에 Node의 lazy catalog scope 계약과 실제 Vite production의 부분 로딩을 확인한 기록이다. benchmark 전용이고 제품 package·공개 API·버전은 그대로다. 브라우저 lazy 전송·개발 서버 재연결·typegen·성능 비교는 아직 검증하지 않았다.

## scope 기반 수정 (`c8f883e`)

- empty boot가 manifest의 `availableNamespaces`·`loadedNamespaces`를 복원한다.
- `NamespaceNotLoadedError`와 `UnknownMessageError`를 구분한다.
- replace는 카탈로그와 namespace 선언을 함께 교체한다. 이전 snapshot의 `t`는 그대로 유지한다.
- catalogLayer의 scoped read는 기본값이 일반 eager와 같은 base namespace다. boot가 배열을 명시하면 resource 0개도 허용한다.
- source guard는 canonical·unique·base 포함과 catalog locale·namespace의 declared scope 포함을 검증한다.
- hydration facade 생성자가 boot namespace 선언을 넘기고, legacy replace는 base catalog에서 loadedNamespace scope를 추론한다. network API는 없다.
- test는 scope 3 + hydration 6 + timezone 5 = 14개 PASS다.

## lazy coordinator (`4623203`)

- 독립 lazy coordinator와 source pair cache다. `createI18n` wrapping이나 private `CatalogLoader` import가 아니다.
- 공개 Saylo `createBootSnapshot`·`decodeBootSnapshot`·`validateCatalogManifest`와 schema 검증, trusted AST는 그대로 쓴다.
- 실험의 `createLazyLayer`는 비동기 생성자다. `createI18n`의 동기 생성 API까지 동일한 대체물이라는 판정은 하지 않는다.
- i18next engine은 바뀐 snapshot마다 새로 만들고, generation·desiredScope·per-version cache·flight dedup·timeout abort·stale invalidate·retired session·candidate 원자 검증·subscription error aggregate·disposal을 직접 관리한다. 새 locale·namespace와 missing target·empty boot도 허용한다.
- no-op commit은 signature가 같아 새 engine도 알림도 없다. 다만 커밋된 boot manifest는 갱신된다.
- version transition의 namespace fingerprint 처리는 공개 계약을 모델링했다.
- `getServerSnapshot`은 초기 상태에 고정되고, `getBootSnapshot`은 최근 커밋 데이터를 반환한다. 인스턴스의 `t`는 현재 상태를 읽고, 이전 `getSnapshot()`의 `t`는 이전 상태에 묶인다.

## 검증

- controlledSource의 timer·superseded·late ignore를 세고 listed id를 raw에 남긴다. 앞선 11 시나리오·22개는 `4623203` 시점 기록으로 git에 남는다.
- 현재 dataset은 동일 14 시나리오를 core와 prototype 양쪽에서 돌린 28개 PASS다. 추가된 시나리오는 bounded STALE retry, pair version 역행·base locale 변경, catalog pair identity의 JSON key 순서 독립성이다.
- 테스트 수행 시간은 성능 비교에 사용하지 않는다.
- 재현은 `node --test benchmarks/thin-layer/catalog-scope.test.mjs benchmarks/thin-layer/hydration-layer.test.mjs benchmarks/thin-layer/timezone.test.mjs`와 `node --test benchmarks/thin-layer/lazy-contract.test.mjs`다.
- test hook은 증거 저장만 한다. 28개가 전부 통과했고 partial green이 아니다.
- [원시 결과](../benchmarks/results/thin-layer-lazy-contracts-2026-10-11.json)에 scenario·source load·source hash 13개가 있다.
- scope 수정(`c8f883e`)이 기존 hydration에 영향 줄 수 있어 실제 SSR host matrix 12케이스(+missing)를 현재 scope에서 다시 돌렸다. error 0·상태 보존으로 PASS했고 asset parser marker는 false다. 기존 SSR facade의 regression 확인이고 lazy coordinator의 browser 증명이 아니다. [원시 결과](../benchmarks/results/thin-layer-ssr-production-lazy-scope-2026-10-11.json)

## key 순서 edge (`abbacf8`)

- 리뷰에서 실제 prototype bug를 찾았다. source가 돌려준 key가 `{namespace, locale}` 순서여도 core는 semantic pair로 받아들이는데, prototype stamp가 raw 객체를 `JSON.stringify`해 field 순서에 의존했고 `STALE_CATALOG` 재시도 뒤 실패했다.
- 같은 pair를 넣은 새 시나리오가 고침 전 core pass·layer fail로 재현됐다. test hook은 27/28 같은 partial 결과 저장을 거부하고 앞선 green 출력을 보존한다.
- 고침은 stamp를 `[sessionId, locale, namespace, status, version, fingerprint]` 평면 배열로 바꿔 객체 key 열거 순서에 의존하지 않게 한 것이다. 이후 14 시나리오 × 2 = 28 Node case가 PASS다.
- 비용은 cache key·flight·invalidate가 모두 이 평면 stamp를 쓰게 된 정도다. 성능은 재지 않았다.

## 해석·남은 목표

- 새 코드는 full runtime IO·state logic을 i18next 옆에 직접 구현한 것이다. loader는 Saylo 검증에 의존하므로 기존 도구를 전부 대체하거나 독립 framework native 이점을 증명하지 않는다.
- 로딩·취소·버전·구독 코드를 별도로 유지해야 한다. 성능 비용은 측정하지 않았다.
- 남은 목표는 개발 서버·브라우저 lazy 전송, 재연결, typegen, 성능 비교다. 제품 package는 그대로이고 push·publish는 없다.

## 실제 static production lazy (`597880e`)

- `lazy-production-probe.mjs`가 같은 6 pair fixture(en·ru·ja × demo·help)를 실제 Vite production build 두 개로 만든다. `virtual:saylo/lazy`와 공개 `createStaticCatalogSource`, initialLocale ru, initialNamespaces `[]`, initialCatalogs `[]`, timeZone UTC다.
- core와 prototype 모두 owned temp에 dist ES lib를 write한다. unminified·esnext이고 각각 7 chunk(entry 1 + catalog outcome 6)다.
- Node가 실제 entry 파일을 import하고 필요할 때 relative catalog chunk를 가져온다. cache는 boot 0 → en·ru/demo 2 → ja/demo 3 → en·ja/help 5이고 6번째 ru/help는 로드하지 않는다.
- 실행은 boot의 known namespace unloaded error, ru `Ada`·English fallback `21 rows`·UTC date, ja 선택 뒤 `ja Ada`와 retained `ru Ada`, ja/help, loadedNamespaces `demo`·`help`, no-op refresh identity 유지, unknown ns RangeError·`UnknownMessageError`, retained cold bound `NamespaceNotLoadedError`를 확인한다.
- emitted chunk 전체가 parser marker false다. AST build shim은 prototype 쪽에만 붙는다.
- entry는 core 74829 bytes·20305 gzip bytes, prototype 172439 bytes·43994 gzip bytes다. 작은 예제의 관측이며 일반적인 번들 크기 배율이나 성능 측정이 아니다.
- 여전히 Saylo Vite compiler와 공개 static CatalogSource를 쓴다. browser lazy dev wire protocol·session reconnect·typegen·성능을 증명하지 않는다.
- 제품 package·공개 API·버전은 그대로다. unit 28은 common boot helper 검증을 공유하고, loader는 core `createI18n` wrapper가 아니라 검증된 state를 독자적으로 조정한다.
- `abbacf8` 이후 source로 다시 만든 [canonical 원시 결과](../benchmarks/results/thin-layer-lazy-production-canonical-2026-10-11.json)가 최신이다. 같은 2 build·7 chunk·cache count이고 chunk별 hash도 이 파일에 있다. 재현은 `node benchmarks/thin-layer/lazy-production-probe.mjs --out benchmarks/results/thin-layer-lazy-production-canonical-2026-10-11.json`이고, `597880e` 시점 raw는 [historical](../benchmarks/results/thin-layer-lazy-production-2026-10-11.json)로 남긴다.

## 후속: 브라우저 lazy wire (`51f1393`)

여기까지가 Node 계약과 production static 부분 로딩이다. 실제 Chromium·Vite 개발 서버에서 공개 `createDevCatalogSource`와 `connectDev`로 catalog 6 pair를 요청하고 compact·patch frame·부분 요청·detach/rebind·실제 소켓 종료 뒤 Vite reload를 확인한 기록은 [68](68-thin-layer-lazy-browser.md)에 있다. 위 14 시나리오와 production chunk 기록·판정은 그대로 유효하다.
