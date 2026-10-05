# Saylo

Saylo는 개발 중 번역 문구를 고칠 때 재컴파일을 기다리지 않고 화면에 즉시 반영하는 것을 목표로 하는 i18n(국제화) 라이브러리다. JavaScript와 TypeScript 프로젝트를 함께 지원하고, 개발 서버에서 문구 수정, 로케일 추가, namespace 추가가 입력 폼과 모달 같은 기존 DOM 상태를 유지하며 반영되는 것을 목표로 한다. 상태 보존은 기존 호출부의 스키마를 깨뜨리지 않는 편집에 적용한다. 키 삭제·필수 인자 추가와 Vite 서버 재시작의 범위는 [제품과 범위](docs/01-product-and-scope.md)를 따른다.

## 현재 상태

- `packages/core`에 카탈로그 파싱·스키마 검증, 번역기와 불변 store가 있다. 로컬 npm workspace에서 ESM JavaScript와 `.d.ts`를 빌드한다. 패키지는 아직 비공개이며 npm에 배포하지 않았다.
- 현재 API는 `parseCatalog`, `createBaseSchema`, `validateTranslation`, `createTranslator`, `createStore`와 오류 클래스들이다. `examples/vanilla`는 카탈로그를 교체해도 폼과 모달을 유지하는 데모다. 파일 저장 기반 Vite 라이브 갱신, React 연결, typegen과 SSR은 이후 구현한다.
- 성능 수치는 전부 목표치다. 측정 결과가 아니며, 벤치마크도 아직 없다.
- 지원 버전 범위, 패키지 배포 방식, 런타임 요구사항은 확정하지 않았다.
- npm 패키지 이름 `saylo`의 사용 가능 여부는 확인하지 않았다. 라이선스도 아직 정하지 않았다.
- docs의 전체 모듈 구조, 이벤트 이름, i18n API 시그니처는 설계 제안이다. 현재 구현된 파싱 API와 구분하며 구현 과정에서 바뀔 수 있다.
- 문서 기준일: 2026-10-05

## 로컬 실행

Node.js와 npm으로 저장소 루트에서 실행한다. 초기 검증 환경은 Node.js 24.18.0, TypeScript 7.0.2다. 전체 지원 버전 범위는 아직 확정하지 않았다.

```sh
npm install
npm run check
```

`check`는 ESM·선언 파일 빌드, 카탈로그 검증 테스트, TS와 checkJs 소비 타입 검사를 수행한다. 빌드만 하려면 `npm run build`, 빌드와 실행 테스트는 `npm test`를 쓴다.

폼 데모는 `npm run dev`로 실행한 뒤 터미널에 표시되는 로컬 주소를 연다. 화면의 JSON 편집기에 문구를 수정하고 적용하거나 `Ctrl+Enter`를 누른다. 입력값·포커스·커서·스크롤과 열린 모달이 유지되는지 확인할 수 있다. JSON이 깨지거나 번역 계약이 어긋나면 마지막 정상 상태를 유지한다. `npm run build:demo`는 데모를 빌드한다. 현재 데모는 화면에서 직접 카탈로그를 교체하며, 디스크 파일 저장 자동 반영은 아직 구현하지 않았다.

```js
import { parseCatalog, createBaseSchema, validateTranslation, createTranslator } from '@saylo/core';

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

번역은 기준에 없는 키·인자를 추가하거나 기준보다 좁은 타입을 요구할 수 없다. 키·인자 생략은 허용한다. 오류는 `CatalogError.diagnostics`에서 코드, 파일명, ID와 가능한 소스 위치를 확인한다. 현재 파싱 결과와 스키마는 깊게 동결한 객체 형태이며, 렌더용 카탈로그 record와 store snapshot은 이후 단계에서 구성한다. 스키마 fingerprint는 메시지 문구를 제외한 정규화 스키마의 문자열 인코딩이므로 키 순서나 문구만 바뀌면 유지된다.

번역기는 생성 시 카탈로그·로케일·timeZone을 고정한다. `translations`에는 선택한 로케일의 카탈로그만 넘긴다. 없는 키나 namespace의 번역은 baseLocale 문구로 폴백하고, 그 문구의 출처 로케일로 숫자·날짜를 포맷한다. 빈 문자열 번역은 그대로 유지한다. 호출 인자는 번역의 인자 생략 여부와 관계없이 기준 스키마로 검증하며, 숫자는 유한한 값이고 Date는 유효한 날짜여야 한다. 날짜·시간의 일반 스타일과 skeleton 모두 timeZone을 적용하고, 기본값은 UTC다.

`UnknownMessageError`는 없는 키, `NamespaceNotLoadedError`는 로드되지 않은 namespace, `InvalidArgumentError`는 필수 인자 누락이나 타입 오류를 나타낸다. `t()`는 순수 텍스트를 돌려준다. 태그 문자열은 literal로 유지하므로 DOM에는 `textContent`나 프레임워크의 텍스트 렌더링으로 넣는다.

TypeScript는 `createTranslator<AppSchema>(options)`, JS는 JSDoc의 `Translator<AppSchema>`로 키·인자 타입을 연결할 수 있다. 아직 typegen이 없으므로 AppSchema는 직접 작성한다. 인자 종류와 키가 불확실한 union 호출은 먼저 키를 좁혀야 한다.

## Eager store

```js
import { createStore } from '@saylo/core';

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

후보는 모든 번역 계약을 검증한 뒤 게시하고, 구독자는 트랜잭션당 한 번 통지한다. 구독 중 요청한 다음 변경은 현재 snapshot의 모든 구독자가 끝난 뒤 게시한다. 구독자 오류는 나머지 구독자 통지를 마친 뒤 `AggregateError`로 전달하며 이미 게시한 상태를 되돌리지 않는다. `unsubscribe`와 `dispose`는 반복 호출해도 안전하다. 지연 로딩·부분 전송·secondary quarantine은 이후 단계의 계약이며, 현재 eager store는 잘못된 후보 전체를 거부한다. 키 삭제·필수 인자 추가로 기존 화면 호출이 깨지는 편집은 DOM 보존 범위에 포함하지 않는다.

## 설계 방향 한 줄 요약

개발 서버가 파일 변경을 감지하면 그 파일만 파싱한다. 기준 스키마 변경은 영향받는 번역도 재검증한다. 로케일+namespace 단위의 카탈로그 스냅샷(또는 패치)을 클라이언트 store에 전달하고, UI에 보이는 변화가 있으면 구독자를 다시 렌더링한다. 정상 번역 변경은 JS 코드 생성과 typegen 완료를 기다리지 않고, 전체 앱 모듈 무효화나 full reload도 하지 않는다. 파싱과 검증에 드는 시간은 남는다. 갱신 wire 프로토콜의 단일 출처는 [docs/08-update-protocol.md](docs/08-update-protocol.md)다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [docs/README.md](docs/README.md) | 문서 읽는 순서와 상태 표기 규칙 |
| [docs/01-product-and-scope.md](docs/01-product-and-scope.md) | 문제 정의, 목표, 범위, 비목표, DOM 보존 범위, 용어 |
| [docs/02-architecture.md](docs/02-architecture.md) | 개발 파이프라인, 코어/어댑터 경계, store 모델, 소유권 |
| [docs/03-catalog-and-api.md](docs/03-catalog-and-api.md) | 카탈로그 파일, ID/namespace, ICU 정책, argument 계약, 공개 API와 예제 |
| [docs/04-live-update-and-types.md](docs/04-live-update-and-types.md) | 라이브 반영 판정, desired-state, 실패 복구, 타입 생성, 캐시 |
| [docs/05-build-and-ssr.md](docs/05-build-and-ssr.md) | 운영 빌드, 지연 로딩, Vite 변환, SSR, 보안 |
| [docs/06-validation-and-roadmap.md](docs/06-validation-and-roadmap.md) | 성능 목표와 측정 정의, 인수 사례, 로드맵 |
| [docs/07-decisions.md](docs/07-decisions.md) | 결정 대장, 제품 형태, 미해결 위험, 참고 자료 |
| [docs/08-update-protocol.md](docs/08-update-protocol.md) | 갱신 wire 프로토콜, 적용·resync, boot 인코딩 |
