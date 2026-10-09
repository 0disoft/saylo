# 42. 빌드 완역 검사 옵션

production build에서 모든 로케일의 완역을 강제하는 `requireCompleteTranslations` 옵션을 Vite 플러그인에 로컬 구현했다. 기본값은 `undefined`(false 동작)이고 `true`여도 `config.command === 'build'`인 경우에만 검사한다. dev startup·live 반영, core의 `validateTranslation`, typegen CLI에는 이 옵션이 없다.

## 옵션 계약

```js
import saylo from '@0disoft/saylo-vite';

export default {
  plugins: [saylo({ localesDir: 'locales', baseLocale: 'ko', requireCompleteTranslations: true })],
};
```

- 옵션은 `readonly requireCompleteTranslations?: boolean`이다. JS·TS·checkJs 소비자에 노출하고, `'true'` 같은 문자열은 플러그인 생성 시 `TypeError`로 거부한다.
- `initialLocale`도 빈 문자열이면 `RangeError`다.
- 기본 동작(`undefined`·`false`)과 dev는 기존처럼 일부 번역 누락을 허용하고 baseline fallback을 쓴다.

## 검사 순서

완역 검사를 켠 빌드의 `configResolved`는 카탈로그를 스캔한 뒤 이 순서로 진행한다. 먼저 일반 `createStore` 스키마 검증을 `baseLocale`로 돌린다. `initialLocale` 디렉터리가 아예 없어도 ID·인자·타입 오류를 먼저 잡기 위함이다. 이어서 완역 검사를 수행하고, 통과하면 registry chunk 생성과 typegen 순서로 넘어간다. 누락이 있으면 검사가 `CatalogError`로 끝나고 뒤 단계는 실행되지 않으므로 기존 `generated.d.ts`는 덮어쓰지 않는다.

기존 스키마·인자·타입 오류가 있으면 완역 검사보다 그 오류가 먼저 fail한다. strict에서도 `UNKNOWN_ARGUMENT` 같은 기존 진단이 우선한다.

## 검사 대상

`localesDir`의 숨김 아닌 로케일 디렉터리를 모은다. 빈 폴더도 대상에 넣으며 scanner의 로케일 정규화와 경로 검증을 따른다. 여기에 `initialLocale`을 더하므로 초기 로케일 폴더가 없어도 대상이 된다. 폴더와 `initialLocale` 어디에도 없는 로케일은 자동으로 발견하지 못한다.

`initialNamespaces`와는 무관하다. 기준 로케일의 모든 namespace와 그 messageID 전체를 검사하고, `initialNamespaces` subset은 보지 않는다. 기준 로케일 자신은 검사에서 제외한다.

## 진단

- namespace 파일이 없으면 `MISSING_NAMESPACE`다. 예상 상대 경로는 디렉터리의 실제 표기를 쓴다(`en-us/help.json`).
- namespace는 있는데 키가 없으면 `MISSING_MESSAGE`다. 존재해야 할 값의 `sourceName`·`id`를 채운다.
- 진단의 `locale`은 canonical(`en-US`)이고, 파일 힌트는 디렉터리 실제 철자(`en-us`)를 각각 유지한다.
- 진단은 canonical locale, namespace, id 순으로 정렬해 모은다. 누락 대상 파일 위치 같은 `position`은 넣지 않는다. 어긋난 다른 파일 위치를 꾸미지 않는다.
- 키 존재만 검사한다(`Object.hasOwn`). 빈 문자열 `""`도 있는 값으로 인정한다. 번역이 base 인자를 생략하는 것도 계속 허용하고, 번역 문구의 내용이나 언어를 판별하지 않는다.

## 검증 명령

```sh
npm run check
npm run release:check -- --version 0.1.0-alpha.2 --tag alpha
npm exec -- node scripts/pack-smoke.mjs
```

2026-10-09 Windows·Node 24.18.0에서 전체 `check`와 다섯 패키지의 릴리스 메타데이터 검사를 통과했다. 옵션 동작은 실제 Vite 빌드로 누락 진단·수정 후 성공·기존 타입 파일 유지·초기 로딩 범위 밖 namespace·빈 폴더·폴더 없는 초기 로케일·일반 스키마 오류 우선순위를 확인했다. 빈 문자열과 번역의 인자 생략은 허용했고, 개발 플러그인 테스트에서 부분 번역 fallback과 수정 후 복구도 확인했다. JS/checkJs·TS 소비 타입 검사도 통과했다.

빌드 출력을 재사용한 pack 소비 검증에서 다섯 tarball의 외부 JS·TS 설치, README 예제, CLI, React/Svelte SSR, Vite lazy build와 parser 제거를 통과했다. 외부 소비 앱은 검사 후 정리했다. 새 성능 측정·브라우저 검증·registry 게시는 수행하지 않았다.

## 상태

현재 저장소의 로컬 구현만 반영됐다. 버전은 `0.1.0-alpha.2` 그대로이고, 이미 게시된 alpha.2에는 이 옵션이 들어 있지 않다. push·publish·version bump는 없다.
