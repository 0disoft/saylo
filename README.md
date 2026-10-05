# Saylo

Saylo는 개발 중 번역 문구를 고칠 때 재컴파일을 기다리지 않고 화면에 즉시 반영하는 것을 목표로 하는 i18n(국제화) 라이브러리다. JavaScript와 TypeScript 프로젝트를 함께 지원하고, 개발 서버에서 문구 수정, 로케일 추가, namespace 추가가 입력 폼과 모달 같은 기존 DOM 상태를 유지하며 반영되는 것을 목표로 한다. 상태 보존은 기존 호출부의 스키마를 깨뜨리지 않는 편집에 적용한다. 키 삭제·필수 인자 추가와 Vite 서버 재시작의 범위는 [제품과 범위](docs/01-product-and-scope.md)를 따른다.

## 현재 상태

- `packages/core`에 카탈로그 파싱·스키마 검증과 고정된 카탈로그를 읽는 번역기가 있다. 로컬 npm workspace에서 ESM JavaScript와 `.d.ts`를 빌드한다. 패키지는 아직 비공개이며 npm에 배포하지 않았다.
- 현재 API는 `parseCatalog`, `createBaseSchema`, `validateTranslation`, `createTranslator`와 오류 클래스들이다. `createTranslator().t()`는 ICU 포맷과 baseLocale 폴백을 제공한다. store, Vite 라이브 갱신, React 연결, typegen과 SSR은 이후 구현한다.
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

TypeScript는 `createTranslator<AppSchema>(options)`, JS는 JSDoc의 `Translator<AppSchema>`로 키·인자 타입을 연결할 수 있다. 아직 typegen이 없으므로 AppSchema는 직접 작성한다. 인자 종류와 키가 불확실한 union 호출은 먼저 키를 좁혀야 한다. 생성 후 카탈로그 변경·자동 재렌더 기능은 아직 없다.

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
