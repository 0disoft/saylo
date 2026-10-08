# Saylo

Saylo는 개발 중 번역 문구를 고칠 때 재컴파일을 기다리지 않고 화면에 즉시 반영하는 것을 목표로 하는 i18n(국제화) 라이브러리다. JavaScript와 TypeScript 프로젝트를 함께 지원하고, 개발 서버에서 문구 수정, 로케일 추가, namespace 추가가 입력 폼과 모달 같은 기존 DOM 상태를 유지하며 반영되는 것을 목표로 한다. 상태 보존은 기존 호출부의 스키마를 깨뜨리지 않는 편집에 적용한다. 키 삭제·필수 인자 추가와 Vite 서버 재시작의 범위는 [제품과 범위](docs/01-product-and-scope.md)를 따른다.

## 현재 상태

- 다섯 패키지의 릴리스 버전은 `0.1.0-alpha.2`이다. 2026-10-09 Svelte의 `alpha.2` 공개·후보 tarball SHA-512 일치와 Trusted Publisher 저장·조회를 확인했다. 나머지 네 패키지는 아직 `alpha.1`이다. Svelte가 요구하는 `core@alpha.2`를 포함한 나머지 패키지의 게시가 남아 있다. 변경 범위는 [후보 기록](releases/0.1.0-alpha.2.md)에 있다. 기존 `alpha.1` 게시 검증은 승인 manifest를 기준으로 유지한다.
- [SvelteKit 3 예제](examples/sveltekit/README.md)에서 요청별 SSR·boot·hydration, 공통 layout의 페이지 이동, 번역 저장 후 입력·모달 유지와 종료·재진입을 확인했다. 실제 Node 운영 빌드의 SSR·언어 전환도 검증했다. `npm run setup:sveltekit` 후 `npm run dev:sveltekit`으로 실행한다. 예제는 로컬 패키지 복사본을 쓰는 독립 private 앱이며 본체와 공개 패키지 버전은 변경하지 않았다. 상세 범위는 [39](docs/39-sveltekit-example.md)에 있다.
- `packages/svelte`에 Svelte 5 어댑터를 구현했다. `$i18n` 구독·typed context·snapshot-bound 번역과 JS/TS 소비, SSR·hydration을 검증했고 [Svelte 데모](examples/svelte/README.md)에서 파일 저장·로케일 추가·선택·삭제 후 입력과 모달 유지를 확인했다. `npm run dev:svelte`로 실행한다. 구현 범위는 [38-svelte-adapter.md](docs/38-svelte-adapter.md), 현행 게시 상태는 위 릴리스 기록을 따른다.
- `packages/core`에 카탈로그 파싱·스키마 검증, 번역기와 불변 store가 있다. 로컬 npm workspace에서 ESM JavaScript와 `.d.ts`를 빌드한다. 공개 패키지 네 개에서 `private`를 떼고 첫 버전 `0.1.0-alpha.1`(dist-tag `alpha`)을 2026-10-06 npm에 게시했다. 루트 workspace package는 `private`를 유지한다.
- 현재 API는 `parseCatalog`, `createBaseSchema`, `validateTranslation`, `createTranslator`, `createStore`, `createI18n`과 오류 클래스들이다. `packages/vite`는 카탈로그 파일 수정·추가·삭제, eager 연결과 lazy pair 조회·부분 전송, 기준 schema 변경 시 기존 번역의 quarantine을 지원한다. `packages/react`는 eager·lazy instance를 받는 typed context와 snapshot-bound hook을 제공한다. `packages/typegen`은 기준 스키마의 타입 선언을 생성하는 CLI와 worker를 제공한다. vanilla와 React 데모에서 파일 저장 후 폼과 모달을 유지하며 문구와 로케일·namespace 목록을 갱신한다. lazy 운영 경로는 boot pair를 inline으로 싣고 나머지 pair를 정적 chunk loader로 분리한다. SSR boot serializer·요청별 instance·React hydration 어댑터를 구현했고 전체 check와 실제 브라우저 검증을 마쳤다.
- `@0disoft/saylo-core/runtime` 서브패스 엔트리와 `packages/vite`의 `astRuntime`(기본 `true`, production 한정)으로 Saylo core formatter 경계에서만 parser 런타임을 제거한다. 공개 런타임 엔트리는 `parseCatalog`를 빼고 루트 엔트리는 기존 API를 유지한다. quarantine과 이 parser 제거는 로컬 변경이며 게시된 `0.1.0-alpha.1`에는 아직 없다.
- 성능 목표는 [검증과 로드맵](docs/06-validation-and-roadmap.md)에 있다. 라이브 갱신 벤치마크는 `npm run bench:live`로 돌리고 결과는 [benchmarks/results/live-update.json](benchmarks/results/live-update.json), 최적화 후 재측정은 [benchmarks/results/live-update-optimized.json](benchmarks/results/live-update-optimized.json), request-scoped patch 적용 후 첫 run과 재실행은 [benchmarks/results/live-update-patch.json](benchmarks/results/live-update-patch.json)·[benchmarks/results/live-update-patch-repeat.json](benchmarks/results/live-update-patch-repeat.json)에 남는다. 방법과 조건은 [benchmarks/live-update/README.md](benchmarks/live-update/README.md)에 정리했다. request-scoped patch 뒤 small은 재실행에서 p95 목표 안에 들어왔지만 같은 코드의 첫 run은 넘었고, large는 두 run 모두 목표 p95 ≤ 100ms를 넘었다.
- `npm run verify:pack`으로 외부 JS/TS 소비를 검증한다. 2026-10-06 Node 24.18.0·Vite 8.3.2에서 exit 0으로 통과했다. tarball의 README 포함과 metadata 일치, README 예제 블록(core JS 실행, React·typegen·Vite TS) 검사도 함께 한다. 스크립트는 [scripts/pack-smoke.mjs](scripts/pack-smoke.mjs)에 있다. 게시된 registry 실물은 `npm run verify:registry`가 [releases/0.1.0-alpha.1.json](releases/0.1.0-alpha.1.json)의 CI 승인 integrity와 대조한다.
- 지원 버전은 Node 24.x(`engines.node`)다. 로컬 검증 환경은 Node 24.18.0이고 TypeScript 7을 기준으로 검증하지만 `typescript`를 peer로 강제하지 않는다. `packages/core`·`packages/react`는 ES2022 브라우저 대상이라 Node API가 필요 없고, `packages/vite`·`packages/typegen`은 Node에서 실행한다. 배포 방식과 릴리스 절차는 [릴리스](docs/09-release.md)에 있다.
- 패키지 이름은 `@0disoft/saylo-core`·`@0disoft/saylo-react`·`@0disoft/saylo-typegen`·`@0disoft/saylo-vite` 네 개이고, 2026-10-06 `0.1.0-alpha.1`·dist-tag `alpha`로 npm 공개 registry에 게시했다. 라이선스는 Apache-2.0이다.
- docs에는 설계 초안과 로컬 검증 기록이 섞여 있다. 전체 모듈 구조, 이벤트 이름, 아직 구현하지 않은 i18n API 시그니처는 설계 제안이고, 문서와 실제 코드가 어긋나면 `packages/*/README.md`와 `packages/*/src`의 현행 코드를 따른다.
- 문서 기준일: 2026-10-08
- Vite 동결 import를 core root로 바꿔 기본 prebundle에서 깊은 동결 신뢰 공유를 50/50회 확인했다. 그 시점 상세 계측을 끈 목록 p95는 small 152.13ms·large 268.54ms로 large의 250ms 목표는 미달이었다(과거 31 측정). 결과·검증은 [docs/31-prebundle-freeze-locale-add.md](docs/31-prebundle-freeze-locale-add.md)에 있다.
- 후속 메시지·위치 직접 동결 실험은 cold·incremental 비교에서 개선을 확인하지 못해 되돌렸다. 결과와 재현 패치는 [docs/33-owned-message-freeze-trial.md](docs/33-owned-message-freeze-trial.md)에 보존했다.
- 메시지 동결 내부를 나눈 10k 측정에서 AST 동결이 하위 구간 중 18/20회 가장 컸다. 제품 변경 없이 추가한 계측과 다음 후보는 [docs/34-message-freeze-stages.md](docs/34-message-freeze-stages.md)에 있다.
- `freezeMessageAst` 내부 `seal`을 모듈 범위로 옮기는 최적화를 당시 채택했고 [37](docs/37-seal-locale-add-comparison.md)에서 되돌렸다. cold p95는 332.62→323.81ms, incremental p95는 88.63→80.24ms로 낮게 관측됐지만 incremental 최장 시간은 늘었다. 당시에는 실제 로케일 목록 250ms 목표를 측정하지 않았다. 조건·원시 결과는 [docs/35-shared-ast-seal.md](docs/35-shared-ast-seal.md)에 있다.
- AST 동결 `seal` 모듈화 후 상세 계측을 끈 large locale-add 재측정에서 목록 p95는 767.54ms로 large 250ms 목표는 미달이다(목록 250ms 이내 11/50). 이번에는 small을 재측정하지 않아 152.13ms는 과거 31 측정값이다. 한 run이라 감소 효과나 퇴행을 확정하지 않는다. 조건·원시 결과는 [docs/36-shared-ast-seal-locale-add.md](docs/36-shared-ast-seal-locale-add.md)에 있다.
- 변경 전 `cbd6871`과 공유 헬퍼 실험 `4f6b5cd`를 같은 조건의 격리 스냅샷으로 순차 대조한 locale-add 비교에서 두 블록 모두 after 목록 p50·p95가 before보다 크게 관측됐고, 목록 250ms 이내는 before 38/50·after 23/50으로 둘 다 목표 미달이다. 지표별로는 엇갈린다. 이득을 확인하지 못해 `seal` 공유 제품 변경을 되돌렸다(원복 커밋 `d408500`). 조건·원시 결과는 [docs/37-seal-locale-add-comparison.md](docs/37-seal-locale-add-comparison.md)에 있다.

## 로컬 실행

Node.js와 npm으로 저장소 루트에서 실행한다. 지원 버전은 Node 24.x이고 검증 환경은 Node.js 24.18.0, TypeScript 7.0.2다.

```sh
npm install
npm run check
```

`check`는 ESM·선언 파일 빌드, 카탈로그 검증 테스트, TS와 checkJs 소비 타입 검사를 수행한다. 빌드만 하려면 `npm run build`, 빌드와 실행 테스트는 `npm test`를 쓴다.

pack 소비 검증은 `npm run verify:pack`으로 돌린다. workspace 패키지를 tarball로 묶어 저장소 밖 임시 디렉터리의 JS·TS 앱에 설치하고, 설치된 `saylo-typegen` 타입 생성, JS checkJs와 TS strict 타입 검사, Node 번역·인자 거부·React SSR, public subpath import, Vite production lazy chunk 빌드를 확인한 뒤 임시 디렉터리를 지운다. peer와 도구는 npm registry에서 설치하므로 네트워크가 필요하다.

폼 데모는 `npm run dev`로 실행한 뒤 터미널에 표시되는 로컬 주소를 연다. 편집기에서 `examples/vanilla/locales/ko/demo.json` 또는 `en/demo.json`의 문구를 수정하고 저장한다. 입력값·포커스·커서·스크롤과 열린 모달이 유지되는지 확인할 수 있다. JSON이 깨지거나 번역 계약이 어긋나면 마지막 정상 상태와 파일별 진단을 유지한다. `npm run build:demo`는 현재 디스크의 카탈로그를 검증해 데모를 빌드한다.

Vite 설정에는 `saylo({ localesDir: 'locales', baseLocale: 'ko' })` 플러그인을 추가한다. 파일 구조는 `<localesDir>/<locale>/<namespace>.json`이다. 앱은 `virtual:saylo`의 `initialCatalogs`, `baseLocale`, `initialLocale`, `timeZone`으로 store를 만들고, `@0disoft/saylo-vite/client`의 `connectDev(store, { onDiagnostic })`으로 개발 연결을 붙인다. 반환된 해제 함수로 연결을 끊고 다시 연결할 수 있다. `store.dispose()`와 Vite dispose·prune도 연결을 정리한다. TS/checkJs 소비자는 `compilerOptions.types`에 `@0disoft/saylo-vite/virtual`을 포함한다.

개발 전송은 eager와 lazy 경로를 함께 지원한다. `virtual:saylo`는 기존 전체 registry를 제공하며 eager 갱신은 그 연결을 요청한 Vite client에만 보낸다. `virtual:saylo/lazy`는 초기 기준·대상 pair만 싣고, 이후에는 문구 없는 manifest를 받아 변경된 loaded pair만 조회한다. 매니페스트를 적용하면 현재 원하는 범위를 다시 조회하며, 직전에 받은 pair 버전이 서버 기록과 맞으면 그 버전을 기준으로 바뀐 메시지 delta를 받고, 그 외에는 전체 present/missing 응답을 받는다. delta는 메시지 단위 upsert·remove·위치 갱신이고, 클라이언트는 요청마다 기준을 고정해 여러 instance의 응답 순서와 무관하게 한 번에 게시한다. 위치가 일괄로 이동하면 목록 대신 shift 하나로 압축할 수 있다. 미로드 namespace·비활성 로케일 수정은 AST를 받지 않으며 새 namespace도 범용 조회로 로드한다. 처음 연결, revision gap, 새 세션과 재연결은 요청 ID·generation을 가진 manifest handshake로 복구한다. 늦은 pair 응답은 현재 session·version·schema로 판정한다. 라이브 갱신은 앱 모듈을 교체하지 않는다. Vite 서버 재시작은 페이지를 다시 로드할 수 있다.

파일 이벤트는 40ms quiet window로 묶고, 이벤트가 계속 들어오면 최대 200ms 뒤 읽기를 시작한다. 임시 파일 교체 저장은 최종 경로의 상태로 판단한다. 현재 로케일의 모든 카탈로그를 삭제하면 기준 언어로 전환한다. 기준 namespace 삭제는 목록에서 제거하고 남은 번역 파일은 기준 namespace가 복원될 때 다시 검증한다. 운영 빌드는 기준 없는 번역 파일을 엄격히 거부하므로 namespace를 제거할 때 번역 파일도 함께 정리한다. 기준 로케일의 모든 카탈로그 삭제는 거부하고 마지막 정상 상태를 유지한다. 새 번역 파일이 기준 파일보다 먼저 도착해 검증에 실패해도, 기준 파일이 생기면 후보를 자동 재검증한다. `.d.ts`, 숨김 JSON과 `.json.tmp` 파일은 Saylo 카탈로그 범위에서 제외한다.

React 데모는 `npm run dev:react`로 실행한다. `examples/vanilla/locales`의 같은 카탈로그와 기존 스타일을 공유하고, 입력값·수량·모달은 React state로 관리한다. 처음에는 한국어 `demo`만 싣고 영어 선택 시 영어 pair를 조회한다. 새 namespace는 목록에 나타나고 버튼을 눌러 명시적으로 로드한다. `npm run typegen:react`는 타입만 생성한다. `npm run build:react`는 패키지 빌드 → 현재 디스크 검증과 타입 생성 → 데모 TS 검사 → Vite production 빌드 순서로 실행한다.

```js
import { parseCatalog, createBaseSchema, validateTranslation, createTranslator } from '@0disoft/saylo-core';

const base = parseCatalog('{"items":"{count, number}개"}', {
  locale: 'ko', namespace: 'cart', sourceName: 'locales/ko/cart.json'
});
const translation = parseCatalog('{"items":"{count, plural, one {# item} other {# items}}"}', {
  locale: 'en', namespace: 'cart', sourceName: 'locales/en/cart.json'
});
const schema = createBaseSchema(base);
validateTranslation(schema, translation);

const i18n = createTranslator({
  locale: 'en', baseCatalogs: [base], translations: [translation], timeZone: 'UTC'
});
i18n.t('cart:items', { count: 3 }); // "3 items"
```

번역은 기준에 없는 키·인자를 추가하거나 기준보다 좁은 타입을 요구할 수 없다. 키·인자 생략은 허용한다. 오류는 `CatalogError.diagnostics`에서 코드, 파일명, ID와 가능한 소스 위치를 확인한다. 현재 파싱 결과와 스키마는 깊게 동결한 객체 형태이며, 같은 깊게 동결된 카탈로그는 `createBaseSchema`가 만든 스키마 객체를 재사용한다. 렌더용 카탈로그 record와 store snapshot은 이후 단계에서 구성한다. 스키마 fingerprint는 namespace와 키·인자 acceptedTypes를 정규화한 JSON의 UTF-8 SHA-256으로, `saylo-schema-v2:sha256:` 접두어에 64자리 16진수를 붙인 총 87자다. 문구나 키 순서만 바뀌면 유지된다.

`parseCatalog`는 세 번째 인자로 이전 `ParsedCatalog`를 선택적으로 받는다. locale·namespace·sourceName이 같은 깊게 동결된 카탈로그를 넘기면 문구가 그대로인 메시지는 이전 AST와 인자를 재사용하고, JSON 전체와 변경된 메시지는 그대로 검증하며 소스 위치는 새 파일 기준으로 갱신한다. 개발 중 파일을 다시 읽는 Vite registry는 이전 카탈로그를 자동으로 넘긴다.

번역기는 생성 시 카탈로그·로케일·timeZone을 고정한다. `translations`에는 선택한 로케일의 카탈로그만 넘긴다. 없는 키나 namespace의 번역은 baseLocale 문구로 폴백하고, 그 문구의 출처 로케일로 숫자·날짜를 포맷한다. 빈 문자열 번역은 그대로 유지한다. 호출 인자는 번역의 인자 생략 여부와 관계없이 기준 스키마로 검증하며, 숫자는 유한한 값이고 Date는 유효한 날짜여야 한다. 날짜·시간의 일반 스타일과 skeleton 모두 timeZone을 적용하고, 기본값은 UTC다.

`UnknownMessageError`는 없는 키, `NamespaceNotLoadedError`는 로드되지 않은 namespace, `InvalidArgumentError`는 필수 인자 누락이나 타입 오류를 나타낸다. `t()`는 순수 텍스트를 돌려준다. 태그 문자열은 literal로 유지하므로 DOM에는 `textContent`나 프레임워크의 텍스트 렌더링으로 넣는다.

TypeScript는 `createTranslator<AppSchema>(options)`, JS는 JSDoc의 `Translator<AppSchema>`로 키·인자 타입을 연결할 수 있다. AppSchema는 기준 메시지에서 자동 생성하거나 직접 작성할 수 있다. 인자 종류와 키가 불확실한 union 호출은 먼저 키를 좁혀야 한다.

## Eager store

```js
import { createStore } from '@0disoft/saylo-core';

const store = createStore({ baseLocale: 'ko', locale: 'en', catalogs: [base, translation] });
const initialSnapshot = store.getSnapshot();
const unsubscribe = store.subscribe(snapshot => {
  // 갱신할 텍스트 노드에만 snapshot.t(...)를 연결한다. 폼 전체를 다시 만들지 않는다.
  console.log(snapshot.t('cart:items', { count: 3 }));
});
store.setLocale('ko');
store.replaceCatalogs([base, translation]);
unsubscribe();
store.dispose();
```

`createStore`는 모든 카탈로그를 미리 싣는 동기 프로토타입이다. `getSnapshot()`은 UI 상태가 같으면 같은 객체를 반환한다. `store.t`는 최신 상태를 읽고, 이전 snapshot의 `t`는 이전 상태를 계속 읽는다. `replaceCatalogs`는 registry 전체 교체이며 현재 로케일이 삭제되면 baseLocale로 전환한다. 같은 문구를 다시 전달하거나 기존 비활성 로케일의 문구만 바꾸면 UI를 다시 통지하지 않는다. 로케일·namespace 목록 변경은 통지한다. 카탈로그 수정 후에도 같은 시간대의 메시지·Intl 캐시를 재사용한다.

후보는 모든 번역 계약을 검증한 뒤 게시하고, 구독자는 트랜잭션당 한 번 통지한다. 구독 중 요청한 다음 변경은 현재 snapshot의 모든 구독자가 끝난 뒤 게시한다. 구독자 오류는 나머지 구독자 통지를 마친 뒤 `AggregateError`로 전달하며 이미 게시한 상태를 되돌리지 않는다. `unsubscribe`와 `dispose`는 반복 호출해도 안전하다. 어댑터는 `store.onDispose(cleanup)`으로 소유 자원의 정리를 등록하고, 반환된 함수로 등록을 해제한다. 정리 중 오류가 나도 나머지 정리를 마친 뒤 `AggregateError`로 전달한다. 지연 로딩과 부분 전송은 lazy 경로에, secondary quarantine은 Vite plugin에 구현했다. 코어 `createStore` 자체는 자동 격리를 하지 않고 잘못된 후보 전체를 거부한다. 키 삭제·필수 인자 추가로 기존 화면 호출이 깨지는 편집은 DOM 보존 범위에 포함하지 않는다.

## 지연 로딩 코어

`createI18n`은 필요한 로케일·namespace pair를 `CatalogSource`에서 조회하는 비동기 코어다. `setLocale`와 `loadNamespace`는 `Promise<void>`를 반환한다. 필요한 기준·대상 pair가 모두 present 또는 missing으로 확정될 때 한 번에 게시하며, 대기·조회 실패 중에는 이전 snapshot을 유지한다. missing 번역은 기준으로 폴백하고, 조회 실패는 `CatalogLoadError`로 구분한다. 서로 보완하는 언어 전환과 namespace 추가는 함께 완료하고, 실제로 대체된 언어 선택만 `SupersededRequestError`로 취소한다.

현재 생성 옵션은 `catalogSource`, `locale`, `initialNamespaces`, `initialCatalogs`와 선택적인 `timeZone`·`requestTimeoutMs`다. manifest는 전체 locale·namespace 목록과 알려진 pair별 version·schema fingerprint·missing tombstone을 담는다. 부팅 pair는 결과를 빠짐없이 명시하고, 이후 결과는 현재 session·pair version·schema로 검사한다. `refresh()`는 어댑터가 manifest 변경 후 현재 원하는 범위를 다시 준비할 때 쓴다. 전역 revision만으로 관계없는 namespace의 정상 결과를 폐기하지 않는다. timeout 기본값은 카탈로그당 5초이며 dispose는 요청·timer·소유 listener를 정리한다.

`npm run demo:lazy`는 언어 전환과 장바구니 namespace 로드를 동시에 실행하는 Node 데모다. 조회 중 한국어 snapshot을 유지하다가 한 번의 commit으로 영어 공통 문구와 한국어 장바구니 폴백을 게시한다. JS/checkJs와 TS 소비 fixture가 같은 키·인자 타입을 검사한다. 현재 경로는 parsed catalog를 받는 프로토타입이다. 개발에서는 Vite 범용 loader·부분 전송과 React 연결을 지원한다. 운영 경로는 `createStaticCatalogSource(initialManifest, initialCatalogs, entries)`로 boot pair만 inline으로 싣고 나머지 present pair는 생성된 literal `import()` loader entry로 분리한다. 실패나 session·version·fingerprint/key 불일치는 캐시에 반영하지 않고, missing tombstone은 import 없이 반환한다. SSR boot snapshot은 `createBootSnapshot`·`serializeBootSnapshot`·`decodeBootSnapshot`로 로컬 구현했다. 현재 wire는 parsed catalog의 sourceName·locale·AST·인자를 배열로 직렬화하고, 초안 `CatalogRecord`·`Map` 모형은 후속 단계다.

lazy 앱은 아래처럼 연결한다. Vite의 `initialNamespaces` 옵션으로 부팅 범위를 정하며, 생략하면 기준 namespace 전체다. source는 여러 instance가 공유할 수 있고 마지막 연결 해제 후 자신이 등록한 HMR listener를 정리한다.

```js
import { createI18n } from '@0disoft/saylo-core';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource, initialCatalogs, initialLocale, initialNamespaces, timeZone } from 'virtual:saylo/lazy';

const i18n = createI18n({ catalogSource, locale: initialLocale, initialNamespaces, initialCatalogs, timeZone });
const disconnect = connectDev(i18n, { catalogSource });
await i18n.setLocale('en');
// 현재 manifest에 있는 namespace를 필요할 때 로드한다.
// await i18n.loadNamespace('help');
// 종료 시 disconnect(), i18n.dispose()로 소유 자원을 정리한다.
```

## 타입 자동 생성

Vite 플러그인에 `typegen: { outFile: 'generated.d.ts' }`를 추가한다. outFile은 Vite root 기준의 `.d.ts` 경로다. React 데모는 `examples/react/generated.d.ts`에서 생성된 `AppSchema`를 import한다.

```js
saylo({
  localesDir: '../vanilla/locales',
  baseLocale: 'ko',
  typegen: { outFile: 'generated.d.ts' }
});
```

기준 namespace·키·인자 스키마만 타입의 입력이다. ICU 분기에서 사용한 인자도 모두 필수로 생성하며, 숫자는 `number`, 일반 보간은 `number | string`, 날짜는 `Date | number`로 표현한다. 기준에서 여러 용도로 사용한 인자는 코어가 판정한 교집합 타입을 따른다. 키와 인자 이름은 문자열 literal로 이스케이프하고 정렬하므로 입력 순서나 문구만 바뀌면 같은 선언이 나온다.

초기 dev serve는 타입 생성 완료를 기다린다. 라이브 카탈로그 게시 뒤에는 worker를 배경에서 실행하고 화면 반영 경로가 완료를 기다리지 않는다. 연속 저장은 최신 generation으로 합치고 이전 결과의 쓰기를 차단한다. 선언 내용이 바뀔 때만 임시 파일을 최종 경로로 교체하며, 생성 파일과 해당 임시 파일만 Vite 감시에서 제외한다. 타입 생성 실패는 마지막 선언을 유지하고 개발 서버 로그에 진단을 남긴다. 초기 생성 실패는 서버 시작을 중단한다. IDE의 자동 완성은 생성 완료와 IDE의 재검사 이후 갱신된다.

CLI는 저장소에서 다음처럼 실행한다. 현재 디스크의 전체 카탈로그를 검증한 뒤 기준 스키마의 선언을 쓰므로 잘못된 번역 파일도 오류로 종료한다.

```sh
npm run typegen:react
# 직접 호출할 때는 패키지를 먼저 빌드한다.
node packages/typegen/dist/cli.js --locales-dir examples/vanilla/locales --base-locale ko --out-file examples/react/generated.d.ts
```

## React 연결

React 19에서 검증했다. factory는 모듈에서 한 번 만들고, 같은 factory의 Provider와 hook을 함께 사용한다. AppSchema는 typegen이 만든 선언에서 가져온다.

```tsx
import { createRoot } from 'react-dom/client';
import { createStore } from '@0disoft/saylo-core';
import { createSayloReact } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { initialCatalogs, baseLocale, initialLocale, timeZone } from 'virtual:saylo';
import type { AppSchema } from './generated';

const store = createStore<AppSchema>({ baseLocale, locale: initialLocale, catalogs: initialCatalogs, timeZone });
const { SayloProvider, useI18n } = createSayloReact<AppSchema>();

function Preview() {
  const { t, locale, setLocale, stateRevision } = useI18n();
  return <>
    <h1>{t('demo:heading')}</h1>
    <p>{t('demo:summary', { count: 3 })}</p>
    <button onClick={() => setLocale(locale === 'ko' ? 'en' : 'ko')}>언어 전환</button>
    <small>{stateRevision}</small>
  </>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<SayloProvider instance={store}><Preview /></SayloProvider>);
const disconnect = connectDev(store);
// 앱 종료 시 root.unmount(), disconnect(), store.dispose() 순서로 정리한다.
```

`useI18n`은 `useSyncExternalStore`로 구독하고, 해당 렌더의 불변 snapshot과 `setLocale`을 반환한다. 이전 렌더의 `t`는 이전 번역을 계속 읽으며 `store.t`는 최신 번역을 읽는다. 같은 snapshot·instance에서는 hook 결과와 `setLocale` 참조가 유지된다. 같은 문구나 비활성 로케일 수정은 구독 컴포넌트를 다시 렌더하지 않는다. Provider는 전달받은 store의 수명을 소유하지 않으므로 unmount 후에도 store를 다른 화면에서 사용할 수 있다. store를 소유한 앱이 React root와 개발 연결을 해제한 뒤 `store.dispose()`를 호출한다.

Provider는 `createStore`와 `createI18n`을 모두 받는다. hook의 `setLocale` 반환 타입은 `void | Promise<void>`이며 lazy 호출의 실패는 await/catch로 처리한다. lazy instance에서는 `loadNamespace`도 같은 함수 참조로 제공하고 eager instance에는 그 함수가 없다. 필요한 pair를 준비하는 동안 hook은 이전 snapshot을 읽으며, 준비가 끝나면 한 번 게시한다.

JS/checkJs에서는 `SayloReactBindings<AppSchema>`와 `Store<AppSchema>` JSDoc으로 같은 키·인자 검사를 연결할 수 있다. 소비 예제는 `packages/react/test/consumer-js.js`와 `consumer.tsx`에 있다. `createSayloReact`의 hook은 `useSyncExternalStore` 세 번째 인자로 `getServerSnapshot`을 연결한다. SSR hydration은 `@0disoft/saylo-react`의 `createHydrationAdapter`를 `instance` 대신 Provider에 넘기는 방식으로 지원한다.

## SSR

서버는 요청마다 instance를 만들고 scope가 준비된 뒤 boot snapshot을 직렬화한다. 클라이언트는 그 JSON을 decode해 같은 boot S1로 hydration하고, live 갱신은 hydration barrier가 끝난 뒤 한 번만 반영한다.

서버는 `virtual:saylo/server`의 `createRequestI18n`으로 렌더 전에 요청 scope를 준비한다. 개발에서는 Node registry handle이 최신 read/load를 제공하고 server 종료 시 unregister하며, 운영은 static import source를 쓴다.

```js
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { serializeBootSnapshot } from '@0disoft/saylo-core';
import { createRequestI18n } from 'virtual:saylo/server';
import { App, SayloProvider } from './app.mjs'; // examples/ssr의 공유 컴포넌트

const request = await createRequestI18n({ locale: 'en' });
try {
  const html = renderToString(h(SayloProvider, { instance: request }, h(App)));
  const boot = serializeBootSnapshot(request.getBootSnapshot()); // committed scope만 직렬화
  // boot를 <script type="application/json" id="saylo-boot">의 textContent에 넣는다.
} finally { request.dispose(); }
```

```js
import { createElement as h } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { createI18n, decodeBootSnapshot } from '@0disoft/saylo-core';
import { createHydrationAdapter } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource } from 'virtual:saylo/lazy';
import { App, SayloProvider } from './app.mjs';

const decoded = decodeBootSnapshot(document.getElementById('saylo-boot').textContent);
const client = createI18n({ initialSnapshot: decoded, catalogSource });
const adapter = createHydrationAdapter(client);
connectDev(client, { catalogSource });
const root = hydrateRoot(document.getElementById('root'), h(SayloProvider, { instance: adapter },
  h(App, { onHydrated: adapter.finishHydration }))); // 예제 App은 effect에서 onHydrated를 호출한다.
// unmount 시 root.unmount(), adapter.dispose(), client.dispose()를 호출한다.
```

`createI18n`은 기존 parsed scope 옵션(`locale`·`initialNamespaces`·`initialCatalogs`) 또는 `initialSnapshot`+`catalogSource` 중 하나를 받는다. boot로 만들면 source가 최신이어도 최초 manifest가 boot에 고정되고, `getServerSnapshot`은 생성 시점 snapshot identity를 유지한다. `getBootSnapshot`은 현재 committed scope만 직렬화한다.

`createHydrationAdapter(instance)`는 root마다 새로 만든다. adapter는 boot S1을 유지하면서 underlying snapshot은 최신 하나만 buffer하고, `finishHydration()`을 호출해야 그 시점에 한 번 publish한다. `getServerSnapshot`은 이후에도 S1을 반환한다. `adapter.dispose()`는 자신이 건 구독만 해제하므로 원래 instance 정리는 앱이 `client.dispose()`로 따로 한다.

실행용 SSR fixture는 `examples/ssr/`에 있고, `npm run demo:ssr`가 ko/en 동시 요청 renderToString과 boot locale 검사를 수행한 뒤 종료한다. `npm run dev:ssr`는 127.0.0.1:5190/?locale=en에서 실제 SSR 서버를 띄워 client hydrateRoot(StrictMode)와 live connectDev까지 확인한다.

## 릴리스

기존에 게시한 패키지는 `@0disoft/saylo-core`·`@0disoft/saylo-react`·`@0disoft/saylo-typegen`·`@0disoft/saylo-vite` 네 개다. 첫 버전 `0.1.0-alpha.1`·dist-tag `alpha`를 2026-10-06 게시했다. 계약과 절차는 [릴리스](docs/09-release.md)에 있다. `latest`는 등록용 placeholder `0.0.0-stage`를 가리키므로, 실제 `0.1.0-alpha.1` 설치에는 `@0disoft/saylo-core@alpha`처럼 `@alpha`를 명시한다.

```sh
npm run release:check -- --version 0.1.0-alpha.2 --tag alpha
npm run check
npm run release:pack
```

현행 릴리스 대상에는 `@0disoft/saylo-svelte`를 추가했다. `release:check`는 다섯 패키지의 버전·라이선스·`engines`·`publishConfig`·내부 의존 버전을 검사한다. `release:pack`은 다섯 tarball을 저장소 밖 소비 앱에 설치해 검증하고 `.release/npm/`에 tarball과 `manifest.json`을 남긴다. `verify:registry`는 기존 `alpha.1` manifest에 기록된 네 게시 패키지만 검사하며 현재 소스 버전·README·dist-tag와 분리한다. GitHub Actions [release.yml](.github/workflows/release.yml)은 수동 dispatch로 같은 검증을 돌리고 `publish`가 true일 때만 게시한다. Svelte의 Trusted Publisher 저장·조회는 완료했으며 실제 CI OIDC 교환과 나머지 네 패키지의 `alpha.2` 게시가 남아 있다.

## 설계 방향 한 줄 요약

개발 서버가 파일 변경을 감지하면 그 파일만 파싱한다. 기준 스키마 변경은 영향받는 번역도 재검증한다. 로케일+namespace 단위의 카탈로그 스냅샷(또는 패치)을 클라이언트 store에 전달하고, UI에 보이는 변화가 있으면 구독자를 다시 렌더링한다. 정상 번역 변경은 JS 코드 생성과 typegen 완료를 기다리지 않고, 전체 앱 모듈 무효화나 full reload도 하지 않는다. 파싱과 검증에 드는 시간은 남는다. 갱신 wire 프로토콜의 단일 출처는 [docs/08-update-protocol.md](docs/08-update-protocol.md)다.

## 패키지

| 패키지 | npm | README |
| --- | --- | --- |
| `@0disoft/saylo-core` | [npm](https://www.npmjs.com/package/@0disoft/saylo-core) | [packages/core/README.md](packages/core/README.md) |
| `@0disoft/saylo-react` | [npm](https://www.npmjs.com/package/@0disoft/saylo-react) | [packages/react/README.md](packages/react/README.md) |
| `@0disoft/saylo-svelte` | `alpha.2` 공개 확인, 필요한 core `alpha.2` 미게시 | [packages/svelte/README.md](packages/svelte/README.md) |
| `@0disoft/saylo-typegen` | [npm](https://www.npmjs.com/package/@0disoft/saylo-typegen) | [packages/typegen/README.md](packages/typegen/README.md) |
| `@0disoft/saylo-vite` | [npm](https://www.npmjs.com/package/@0disoft/saylo-vite) | [packages/vite/README.md](packages/vite/README.md) |

설치 후 프레임워크 없이 Vite에서 바로 실행하는 예제는 [examples/npm/README.md](examples/npm/README.md)에 있다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [docs/README.md](docs/README.md) | 문서 읽는 순서, 상태 표기 규칙, 설계 초안과 현행 코드 구분 |
| [docs/01-product-and-scope.md](docs/01-product-and-scope.md) | 문제 정의, 목표, 범위, 비목표, DOM 보존 범위, 용어 |
| [docs/02-architecture.md](docs/02-architecture.md) | 개발 파이프라인, 코어/어댑터 경계, store 모델, 소유권 |
| [docs/03-catalog-and-api.md](docs/03-catalog-and-api.md) | 카탈로그 파일, ID/namespace, ICU 정책, argument 계약, 공개 API와 예제 |
| [docs/04-live-update-and-types.md](docs/04-live-update-and-types.md) | 라이브 반영 판정, desired-state, 실패 복구, 타입 생성, 캐시 |
| [docs/05-build-and-ssr.md](docs/05-build-and-ssr.md) | 운영 빌드, 지연 로딩, Vite 변환, SSR, 보안 |
| [docs/06-validation-and-roadmap.md](docs/06-validation-and-roadmap.md) | 성능 목표와 측정 정의, 인수 사례, 로드맵 |
| [docs/07-decisions.md](docs/07-decisions.md) | 결정 대장, 제품 형태, 미해결 위험, 참고 자료 |
| [docs/08-update-protocol.md](docs/08-update-protocol.md) | 갱신 wire 프로토콜, 적용·resync, boot 인코딩 |
| [docs/09-release.md](docs/09-release.md) | 릴리스 계약, 검증 명령, 배포 워크플로, Trusted Publisher |
