# @0disoft/saylo-typegen

Saylo 기준 카탈로그에서 `AppSchema` 타입 선언(`.d.ts`)을 생성한다. CLI `saylo-typegen`으로 실행하거나, `@0disoft/saylo-vite`가 개발 중 배경에서 실행한다.

## 상태

writer는 Windows에서 `EPERM`·`EACCES`·`EBUSY`로 rename이 실패하면 최대 다섯 번 재시도한다. 재시도 대기 합은 최대 620ms이며, 기다리는 동안 더 최신 작업이 들어오거나 generator가 중단되면 이전 작업의 교체를 취소한다. 기존 파일을 먼저 삭제하지 않는다. 이 변경은 `0.1.0-alpha.2` 게시본에 포함된다.

성공 판정은 디스크에 실제 반영된 출력을 기준으로 한다. 더 새로운 요청이 도중에 들어와도 이미 파일에 반영된 결과는 성공으로 기록하고, 생성이 실패한 뒤 같은 카탈로그를 다시 저장하면 이전 결과를 건너뛰지 않고 다시 시도한다. 이 동작은 `0.1.0-alpha.4` 게시본에 포함된다.

미게시 소스의 `writeGenerated(outFile, source, isCurrent?, { signal, operations }?)`는 파일 I/O·임시 이름·교체 연산을 선택적으로 주입할 수 있다. 취소는 `cancelled`로 반환하며 I/O 사이와 교체 재시도 중 확인한다. rename 성공 뒤 도착한 취소는 `written`을 바꾸지 않는다. 독점 생성에 성공한 임시 파일만 정리하고, 쓰기 실패와 정리 실패가 겹치면 원래 실패를 우선한다. `new TypeGenerator(outFile, { createWorker, write }?)`는 Worker와 writer를 주입할 수 있으며, 이전 Worker의 늦은 완료·실패는 새 작업에 반영하지 않는다.

마지막으로 게시를 확인한 버전은 2026-10-11의 `0.1.0-alpha.4`(dist-tag `alpha`)다. 첫 게시 버전은 2026-10-06의 `0.1.0-alpha.1`이다. 저장소 workspace에서 `node packages/typegen/dist/cli.js`로 직접 실행할 수도 있다.

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

### 공통 설정과 카탈로그 점검 (미게시)

현재 checkout의 `loadProjectConfig()`와 `saylo` 명령은 npm `alpha.4`에 없다. 기존 `saylo-typegen` 인자는 유지하며, 새 `--config` 옵션으로 Vite와 같은 JSON 설정을 읽을 수 있다. JSON 이외의 설정 코드는 실행하지 않는다.

```json
{
  "format": "saylo-project/v1",
  "localesDir": "locales",
  "baseLocale": "ko",
  "checkLocales": ["en", "fr"],
  "typegen": { "outFile": "generated.d.ts" }
}
```

위 내용을 `saylo.config.json`에 저장한다. 경로는 설정 파일의 디렉터리를 기준으로 해석한다. `richText`는 Vite와 같은 namespace → 메시지 ID → 허용 태그 목록이며, 선언한 키는 기준 카탈로그에 있어야 한다. `checkLocales`는 CLI의 완역 검사 대상이고 Vite의 로케일 목록을 추가하는 설정은 아니다. 생략하면 빈 디렉터리를 포함한 발견된 로케일을 검사한다. `initialLocale`도 검사 대상에 포함된다.

미게시 tarball을 설치한 프로젝트에서는 다음 명령을 쓴다. `--no-install`은 다른 패키지를 내려받지 않고 설치된 실행 파일을 사용한다.

```sh
npx --no-install saylo-typegen --config saylo.config.json
npx --no-install saylo check --config saylo.config.json --json
npx --no-install saylo sync --config saylo.config.json --dry-run --json
```

저장소에서는 빌드 후 `node packages/typegen/dist/catalog-cli.js check --config examples/vanilla/saylo.config.json --json`으로 예제를 검사할 수 있다. 같은 설정을 vanilla 예제의 Vite 플러그인도 읽는다.

`check`는 JSON·ICU·인자·rich 계약 오류, 기준에 없는 번역 키, 누락 namespace·메시지를 모아 보고한다. 명시된 완역 대상에 누락이 있으면 런타임에서 기준 언어로 폴백할 수 있어도 검사에서는 오류다. 빈 번역 문자열은 정상 번역으로 처리한다. 소스에서 실제 사용하지 않는 키를 추측해 삭제하지 않는다.

`sync --dry-run`은 `add`·`review`·`retain` 계획을 출력한다. 추가 대상의 `translation: null`은 아직 번역하지 않았다는 뜻이며 실제 카탈로그 값이 아니다. 기존 번역과 기준에 없는 키·namespace는 보존하고, 깨진 파일은 교체 대상으로 제안하지 않는다. 적용·삭제·자동 번역 기능은 없다. 모든 명령은 카탈로그·생성 타입·검수 기록을 직접 쓰지 않는다.

원문 변경을 비교하려면 먼저 `snapshot`의 stdout을 파일로 저장한다. 검수 기록에는 메시지별 원문·rich 계약의 SHA-256만 담고 원문이나 번역 내용은 저장하지 않는다.

```sh
npx --no-install saylo snapshot --config saylo.config.json > saylo-baseline.json
npx --no-install saylo check --config saylo.config.json --baseline saylo-baseline.json --json
npx --no-install saylo sync --config saylo.config.json --baseline saylo-baseline.json --dry-run --json
```

`baseline` 경로를 공통 JSON에 넣어도 된다. 경로를 지정했는데 파일이 없거나 잘못됐으면 실패한다. `snapshot`은 기존 baseline을 읽지 않고 새 비교 기준을 stdout으로 출력한다. 기준 기록 생성은 번역 승인 처리가 아니며, 미완성 번역이 있어도 가능하지만 잘못된 카탈로그가 있으면 거부한다. `check`·`sync`는 기록을 갱신하지 않는다. 원문이나 허용 태그가 바뀌면 기존 번역을 `SOURCE_CHANGED`, 새 원문에 이미 번역이 있으면 `SOURCE_ADDED`로 표시한다. 기록이 없으면 `reviewTracking: "not-configured"`로 표시하고 원문 변경 여부를 추정하지 않는다. 직접 검수한 뒤 비교 기준을 갱신한다.

기존 비교 기록을 갱신할 때는 stdout을 새 파일에 저장하고, 종료 코드 0과 내용을 확인한 뒤 교체한다. 기존 baseline에 바로 리다이렉트하면 명령이 실패해도 셸이 기존 파일을 먼저 덮어쓸 수 있다.

종료 코드는 `check`가 정상 0·진단 있음 1, `sync`가 계획 생성 0·잘못된 카탈로그 등으로 차단 1, `snapshot`이 정상 0·잘못된 카탈로그 1이다. 사용법·설정·파일시스템 오류는 모두 2다. `--json` 오류도 stdout의 단일 JSON으로 반환하며, 도움말은 디스크를 읽지 않는다. 기존 `saylo-typegen`의 종료 코드 0·1은 유지한다.

### 기존 인자로 타입 생성

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

`--help`와 `-h`는 옵션과 예시를 stdout에 출력하고 exit 0으로 끝난다. 도움말은 카탈로그를 읽지 않고 출력 파일도 쓰지 않는다.

```text
Usage: saylo-typegen --locales-dir <directory> --base-locale <locale> --out-file <file.d.ts>

Required options:
  --locales-dir <directory>  Directory containing locale/namespace.json catalogs.
  --base-locale <locale>     Base BCP 47 locale, for example ko or en-US.
  --out-file <file.d.ts>     Generated declaration file; must end in .d.ts.

  --config <file.json>      Shared project settings; explicit flags override their paths relative to cwd.

  --help, -h                Show this help without reading or writing files.

Example:
  saylo-typegen --locales-dir locales --base-locale ko --out-file generated.d.ts

All catalogs are validated before writing. Invalid catalogs leave existing output unchanged.
```

필수 옵션이 빠졌거나, 모르는 옵션이거나, `--base-locale`이 BCP 47 형식이 아니거나, `--out-file`이 `.d.ts`로 끝나지 않으면 사용 오류다. 메시지와 `Run saylo-typegen --help for options and an example.` 힌트를 stderr에 쓰고 exit 1로 끝나며 stdout은 비어 있다. `--out-file` 확장자와 `--base-locale` 검사는 카탈로그를 디스크에서 읽기 전에 돌아서 잘못된 옵션이 파일 IO 전에 걸린다. 옵션을 고쳐 같은 명령을 다시 실행하면 된다. 출력 파일이 `.d.ts`만 되는 제한과 마지막 정상 출력 유지·원자적 교체 계약은 그대로다. 이 도움말과 조기 검사는 현재 checkout과 `0.1.0-alpha.5` 후보 tarball에 포함하며 현재 npm 게시본 `0.1.0-alpha.4`에는 없다.

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

## 문의와 보안 제보

일반 문의·기능 제안·버그는 [rodisoft1@gmail.com](mailto:rodisoft1@gmail.com)으로 보낸다. 패키지·버전, 환경, 기대한 동작과 실제 동작, 합성 데이터로 만든 최소 재현을 적는다. 보안 문제도 같은 이메일에 `Saylo security` 제목으로 비공개 제보한다. 토큰·키·쿠키·실제 사용자 데이터는 보내지 않는다.

Vite 패키지를 설치했다면 `node_modules/@0disoft/saylo-vite/docs/support.md`와 `security.md`에서 자세한 안내를 읽을 수 있다. 이 안내와 연락처 변경은 현재 checkout과 `0.1.0-alpha.5` 후보 tarball에 포함하며 기존 alpha.4 tarball에는 없다. 후보는 아직 npm에 게시하지 않았다.

## 라이선스

Apache-2.0이다. 배포 tarball에 저장소 루트의 `LICENSE`와 `NOTICE`를 함께 싣는다.
