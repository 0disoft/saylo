# @0disoft/saylo-typegen

Saylo 기준 카탈로그에서 `AppSchema` 타입 선언(`.d.ts`)을 생성한다. CLI `saylo-typegen`으로 실행하거나, `@0disoft/saylo-vite`가 개발 중 배경에서 실행한다.

## 상태

writer는 Windows에서 `EPERM`·`EACCES`·`EBUSY`로 rename이 실패하면 최대 다섯 번 재시도한다. 재시도 대기 합은 최대 620ms이며, 기다리는 동안 더 최신 작업이 들어오거나 generator가 중단되면 이전 작업의 교체를 취소한다. 기존 파일을 먼저 삭제하지 않는다. 이 변경은 `0.1.0-alpha.2` 게시본에 포함된다.

성공 판정은 디스크에 실제 반영된 출력을 기준으로 한다. 더 새로운 요청이 도중에 들어와도 이미 파일에 반영된 결과는 성공으로 기록하고, 생성이 실패한 뒤 같은 카탈로그를 다시 저장하면 이전 결과를 건너뛰지 않고 다시 시도한다. 이 동작은 게시된 `0.1.0-alpha.3`가 아니라 저장소 checkout의 후속 수정이다.

마지막으로 게시를 확인한 버전은 2026-10-09의 `0.1.0-alpha.3`(dist-tag `alpha`)다. 첫 게시 버전은 2026-10-06의 `0.1.0-alpha.1`이다. 저장소 workspace에서 `node packages/typegen/dist/cli.js`로 직접 실행할 수도 있다.

## 설치

```sh
npm install --save-dev @0disoft/saylo-typegen@alpha
npm install @0disoft/saylo-core@alpha
```

Saylo 패키지의 `latest`는 아직 등록용 placeholder를 가리키므로 `@alpha`를 지정한다. `@0disoft/saylo-core`는 생성한 타입을 코어 제네릭으로 소비할 때 필요하다. 타입 선언만 생성할 때는 필요하지 않다. CLI를 이미 설치했다면 아래 실행 예시의 `npx saylo-typegen`을 그대로 쓴다.

## 카탈로그

`locales/<locale>/<namespace>.json` 구조를 쓴다. 예를 들어 `locales/ko/demo.json`과 `locales/en/demo.json`이다.

```json
{ "greeting": "안녕 {name}" }
```

```json
{ "greeting": "Hello {name}" }
```

## 실행

```sh
npx saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts
```

`--locales-dir`의 전체 카탈로그를 검증한 뒤 기준 로케일의 선언을 쓴다. 잘못된 번역 파일이 있으면 오류로 종료한다. 위 카탈로그에서 생성되는 `AppSchema`는 `{ "demo:greeting": { "name": number | string } }` 형태이고, 숫자는 `number`, 일반 보간은 `number | string`, 날짜는 `Date | number`로 표현한다. ICU 분기에서 쓴 인자도 필수로 생성한다.

생성한 `AppSchema`는 코어 제네릭에 연결한다.

```ts
import { readFile } from 'node:fs/promises';
import { parseCatalog, createStore } from '@0disoft/saylo-core';
import type { AppSchema } from './generated.js';

const read = async (locale: string) => parseCatalog(
  await readFile(`locales/${locale}/demo.json`, 'utf8'),
  { locale, namespace: 'demo', sourceName: `locales/${locale}/demo.json` },
);

const store = createStore<AppSchema>({
  baseLocale: 'ko', locale: 'en', timeZone: 'UTC',
  catalogs: [await read('ko'), await read('en')],
});
console.log(store.t('demo:greeting', { name: 'Saylo' })); // "Hello Saylo"
store.dispose();
```

JS 프로젝트에서는 JSDoc `/** @type {import('@0disoft/saylo-core').Store<import('./generated.js').AppSchema>} */`로 같은 키·인자 검사를 연결한다.

## 빌드 순서

순서는 typegen → tsc → vite다. Vite build는 소비자 TS 타입 검사를 하지 않으므로 tsc를 먼저 돌린다. Vite 플러그인에 `typegen: { outFile: 'generated.d.ts' }`를 주면 dev에서 초기 생성 뒤 배경으로 갱신하고, 문구만 바뀌면 선언을 다시 쓰지 않는다.

## 관련 패키지

- [@0disoft/saylo-core](https://github.com/0disoft/saylo/tree/main/packages/core#readme) — `AppSchema` 소비
- [@0disoft/saylo-vite](https://github.com/0disoft/saylo/tree/main/packages/vite#readme) — dev에서 자동 생성
- [@0disoft/saylo-react](https://github.com/0disoft/saylo/tree/main/packages/react#readme) — typed hook

## 문서

- [라이브 반영과 타입](https://github.com/0disoft/saylo/blob/main/docs/04-live-update-and-types.md)
- 저장소 [README](https://github.com/0disoft/saylo#readme)

## 버전

Node.js 24.x를 지원한다. `engines.node`는 `24.x`이고 로컬 검증 환경은 Node 24.18.0이다. TypeScript 7을 기준으로 검증하며 `typescript`를 peer로 강제하지 않는다.

Node에서 실행하는 CLI·worker이고 런타임 target은 ES2022다.

## 라이선스

Apache-2.0이다. 배포 tarball에 저장소 루트의 `LICENSE`와 `NOTICE`를 함께 싣는다.
