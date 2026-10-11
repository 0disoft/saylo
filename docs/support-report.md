# 문의용 진단 보고서 (`saylo.support/v1`)

## 범위와 상태

이 문서는 Saylo를 쓰는 앱이 문제를 신고할 때 첨부할 수 있는 진단 JSON 보고서의 계약을 설명한다. 구현은 `packages/vite/src/support-report.ts`에 있고 `@0disoft/saylo-vite/client`에서 export한다.

`createSupportReport`와 `createSupportRecorder`는 현재 checkout과 `0.1.0-alpha.5` 후보 tarball에서 제공한다. 현재 npm 게시본 `0.1.0-alpha.4`에는 없다. 후보는 아직 npm에 게시하지 않았다.

## 설계 원칙

보고서는 allowlist 투영(허용 목록 투영), 명시적 수집, 수동 제출 세 가지 위에 서 있다.

민감정보 안전은 정규식으로 원문을 지우는 방식이 아니라, 애초에 보고서에 들어갈 수 있는 필드를 허용 목록으로 한정하는 방식으로 다룬다. 기록 시점에 허용된 필드만 골라 새 객체를 만들고 나머지는 버린다. 허용하지 않은 필드는 보고서에 출력되지 않는다. 원문 문자열 중 판단에 필요한 값은 즉시 불리언이나 숫자 별칭으로 접어 버리고, 원문 형태로는 버퍼에 남기지 않는다.

버전 문자열도 같은 원칙이다. 형식 전체를 검증하는 정규식을 통과한 값만 넣고, 통과하지 못하면 그 필드를 생략한다. 자유 텍스트에서 비밀을 골라내는 치환이 아니라, 형식에 맞는 값만 통과시키는 투영이다.

라이브러리는 스스로 계측을 켜지 않는다. 환경 버전과 runtime도 앱이 명시적으로 넘긴 값만 쓴다. 라이브러리가 `process.version`이나 `navigator.userAgent`를 뒤져 자동으로 채우는 경로는 두지 않는다.

서버 계정도 자동 업로드도 없다. 보고서는 앱 메모리 안의 순수 객체이고, 어디로 보낼지는 앱과 사용자가 정한다. 라이브러리 안에 원격으로 전송하는 코드 경로는 없다.

## 공개 API

`@0disoft/saylo-vite/client`에서 두 함수를 export한다.

```ts
import { createSupportReport, createSupportRecorder } from '@0disoft/saylo-vite/client';
import type { LiveDiagnostic, DevSyncState } from '@0disoft/saylo-vite/client';
```

아래는 읽기용 계약 발췌다. 위 import 블록과 한 파일에 함께 붙여 넣지 않는다. `SupportReport`·`SupportRecorder` 타입도 `@0disoft/saylo-vite/client`에서 import한다.

```ts
interface SupportEnvironment {
  readonly runtime?: 'browser' | 'node' | 'unknown';
  readonly node?: string;
  readonly vite?: string;
  readonly sayloCore?: string;
  readonly sayloVite?: string;
  readonly sayloReact?: string;
  readonly sayloSvelte?: string;
  readonly sayloTypegen?: string;
}

interface SupportReportOptions {
  readonly environment?: SupportEnvironment;
  readonly syncState?: DevSyncState;
  readonly diagnostics?: readonly LiveDiagnostic[];
}

declare function createSupportReport(options?: SupportReportOptions): SupportReport;
declare function createSupportRecorder(environment?: SupportEnvironment): SupportRecorder;
```

`createSupportReport`는 넘겨받은 값으로 보고서 하나를 그 자리에서 만든다. 상태를 들고 있지 않은 순수 함수다.

`createSupportRecorder`는 상태를 들고 있는 수집기다. 다음 메서드를 제공한다.

| 메서드 | 입력 | 동작 |
| --- | --- | --- |
| `onDiagnostic` | `LiveDiagnostic` | 진단 이벤트 하나를 받아 즉시 축약해 버퍼에 넣는다. |
| `onSyncState` | `DevSyncState` | 마지막 handshake 상태만 보관한다. 유효하지 않으면 지운다. |
| `getReport` | 없음 | 현재 버퍼로 보고서 객체를 만든다. |
| `clear` | 없음 | 이벤트 버퍼와 상태, 누락 카운터를 모두 비운다. |

`createSupportReport`는 호출마다, `getReport()`는 조회마다 새로 동결된 객체를 돌려준다. 돌려받은 객체를 고쳐도 수집기 내부 상태는 바뀌지 않는다.

## 보고서 스키마

`createSupportReport`와 `getReport()`가 만드는 객체의 뼈대는 다음과 같다.

```json
{
  "schemaVersion": "saylo.support/v1",
  "environment": {
    "runtime": "browser",
    "node": "24.18.0",
    "vite": "8.3.4",
    "sayloCore": "0.1.0-alpha.4",
    "sayloVite": "0.1.0-alpha.4"
  },
  "syncState": { "status": "connected", "attempt": 0, "maxAttempts": 3 },
  "events": [
    {
      "operation": "catalog",
      "hasMessage": true,
      "diagnostics": [
        { "code": "MISSING_MESSAGE", "source": 1, "position": { "offset": 42, "line": 3, "column": 7 } }
      ],
      "omittedDiagnostics": 0
    }
  ],
  "omittedEvents": 0
}
```

`schemaVersion`는 문자열 `saylo.support/v1`로 고정한다. 필드를 늘리거나 뜻을 바꾸면 버전을 올린다.

### environment

`environment`는 다음 필드만 가진다. `runtime`은 출력에 항상 있고 `browser`·`node`·`unknown` 중 하나다. 나머지는 패키지 버전 문자열이고, 유효하지 않으면 그 필드를 생략한다.

| 필드 | 뜻 |
| --- | --- |
| `runtime` | 실행 환경 구분. `browser`·`node`가 아니면 `unknown`으로 채운다. |
| `node` | caller가 알려 준 Node 버전. browser 데모에서는 개발·빌드를 돌린 Node를 가리킨다. |
| `vite` | Vite 버전. |
| `sayloCore` | `@0disoft/saylo-core` 버전. |
| `sayloVite` | `@0disoft/saylo-vite` 버전. |
| `sayloReact` | `@0disoft/saylo-react` 버전. 안 쓰면 생략한다. |
| `sayloSvelte` | `@0disoft/saylo-svelte` 버전. 안 쓰면 생략한다. |
| `sayloTypegen` | `@0disoft/saylo-typegen` 버전. 안 쓰면 생략한다. |

버전 값은 `0.1.0-alpha.4`처럼 세 자리 숫자 코어에, 선택적으로 `alpha`·`beta`·`rc`·`dev`·`next` 중 하나와 숫자가 붙은 prerelease까지 허용한다. `0.1.0`, `1.2.3-rc.1`은 유효하고, `v8.3.4`나 build metadata가 붙은 값(`1.2.3+build`), 임의 라벨(`1.2.3-preview.1`), 64자를 넘는 문자열은 통과하지 못해 생략한다.

### 환경 값을 넣는 방법

버전은 앱이 알려 준 값이라 자동 탐색이 없다. 예제 데모는 Vite `define`으로 개발·빌드 시점에 상수를 박아 넣는다.

```js
// vite.config.mjs
import { defineConfig, version } from 'vite';

export default defineConfig({
  define: {
    __SAYLO_SUPPORT_ENV__: JSON.stringify({
      runtime: 'browser',                       // 앱이 브라우저에서 도는 경우
      node: process.versions.node,              // 개발·빌드를 돌린 Node
      vite: version,
      sayloCore: '0.1.0-alpha.4',               // package.json에서 읽어도 된다
      sayloVite: '0.1.0-alpha.4',
    }),
  },
});
```

browser 데모에서 `node`는 개발 서버나 빌드를 돌린 Node 버전을 가리킨다. 앱이 브라우저에서 도는 경우 이 값은 "어떤 도구로 빌드했는지"를 나타낸다. Node 앱에서는 실행 중인 Node 버전이 될 수 있고, 이 값도 라이브러리가 아니라 caller가 채운다. `runtime`은 앱이 도는 곳을 직접 적는다.

### syncState

`syncState`는 마지막 `DevSyncState`를 `status`·`attempt`·`maxAttempts` 세 필드로만 줄여 담는다. `status`는 `idle`·`connecting`·`retrying`·`connected`·`disconnected`·`failed`·`stopped` 중 하나다. `attempt`는 0에서 3 사이 정수, `maxAttempts`는 3이다. 상태가 없거나 검사에 통과하지 못하면 `syncState` 필드를 통째로 생략한다. `null`을 넣지 않는다.

### events

`events`는 진단 이벤트를 오래된 것부터 나열한다. 각 이벤트는 다음 필드를 가진다.

| 필드 | 뜻 |
| --- | --- |
| `operation` | `catalog`·`handshake`·`observer`·`unknown` 중 하나. |
| `hasMessage` | `LiveDiagnostic.message`가 비어 있지 않은 문자열이었는지 여부. 원문은 담지 않는다. |
| `diagnostics` | 아래 규칙으로 축약한 진단 행 배열. |
| `omittedDiagnostics` | 이 이벤트에서 상한 때문에 버린 진단 행 개수. |

`operation`은 `LiveDiagnostic.operation`이 `handshake`나 `observer`면 그 값을 쓰고, 없으면 `catalog`로 본다(서버 카탈로그 진단에는 이 필드가 없다). 그 밖의 값은 `unknown`으로 낮춘다.

`hasMessage`는 오류가 났다는 사실만 남기려고 둔 불리언이다. 사람이 읽는 오류 문구는 보고서 어디에도 들어가지 않고, "문구가 있었다/없었다"만 남긴다.

`diagnostics`의 각 행은 다음 필드만 가진다.

| 필드 | 뜻 |
| --- | --- |
| `code` | 진단 코드. 허용 목록 밖이거나 해석 불가면 `UNKNOWN`. |
| `source` | 이벤트 안에서 1부터 매긴 숫자 별칭. 원문 `sourceName`은 쓰지 않는다. |
| `position` | `offset`·`line`·`column` 세 숫자. 검사를 통과하지 못하면 필드를 생략. |

`code`는 core의 `DiagnosticCode` 허용 목록에서만 쓴다. `INVALID_LOCALE`, `INVALID_NAMESPACE`, `INVALID_JSON`, `INVALID_CATALOG`, `INVALID_ID`, `DUPLICATE_ID`, `INVALID_ICU`, `ARGUMENT_CONFLICT`, `NAMESPACE_MISMATCH`, `UNKNOWN_MESSAGE`, `UNKNOWN_ARGUMENT`, `ARGUMENT_TYPE_NARROWING`, `MISSING_MESSAGE`, `MISSING_NAMESPACE`, `DUPLICATE_CATALOG`, `LOCALE_MISMATCH`가 그 목록이다. 코드를 모르면 `UNKNOWN`으로 적는다.

`source`는 진단마다 다른 문자열을 그대로 옮기지 않는다. 한 이벤트 안에서 `sourceName`별로 `1`, `2`처럼 숫자를 새로 매겨, 여러 진단이 같은 파일에서 왔다는 사실만 남긴다. 같은 이벤트 안에서 같은 원문은 같은 번호를 받고, 원문이 문자열이 아니면 `source`를 생략한다. 별칭 범위는 이벤트 하나이고 이벤트마다 `1`부터 다시 시작한다.

`position`은 `offset`이 0 이상, `line`과 `column`이 1 이상인 정수일 때만 담는다. 그 밖의 값은 버리고 `position`을 생략한다. 담긴 `position` 객체를 포함해 보고서 안의 객체는 깊게 동결해서 돌려준다.

## 기록 시점에 남기는 것과 버리는 것

`onDiagnostic`은 `LiveDiagnostic`을 받은 즉시 축약한다. 판단에 필요한 값은 읽어서 접고, 원문 문자열은 축약 결과와 버퍼에 남기지 않는다.

- `message`는 값이 있는지 판단해 `hasMessage` 불리언으로만 남기고, 문구 자체는 담지 않는다.
- `sourceName`은 이벤트 안에서 같은 출처인지 구분하는 숫자 별칭을 만드는 데만 쓰고, 원문은 담지 않는다.

다음 값은 축약 결과와 `getReport()` 출력 어디에도 원문으로 나타나지 않는다.

- 사람이 읽는 오류 문구(`message`)
- 원본 파일 이름(`sourceName`)
- 로케일(`locale`)과 namespace
- 메시지 키(`id`)
- 인자 이름(`argument`)
- 요청 식별자(`requestId`)와 요청 좌표
- 파일 경로·URL
- 스택 트레이스
- 환경변수 값

원문을 지우는 치환 단계를 두는 게 아니라, 애초에 원문 형태로 버퍼에 담지 않는다. 그래서 축약 뒤 버퍼를 통째로 덤프해도 위 값이 원문으로 나오지 않는다.

## 상한과 누락 표시

버퍼에는 크기 상한이 있다.

- 진단 이벤트는 최근 32개까지 남긴다. 넘치면 가장 오래된 이벤트부터 버린다.
- 한 이벤트의 `diagnostics`는 앞에서부터 64행까지 남긴다. 그 뒤 행은 버린다.

버린 양은 보고서에 숫자로 남긴다.

| 필드 | 뜻 |
| --- | --- |
| `omittedEvents` | 상한 때문에 버린 이벤트 개수. |
| `events[].omittedDiagnostics` | 그 이벤트에서 상한 때문에 버린 진단 행 개수. |

`createSupportReport`에 넘긴 `diagnostics` 배열도 같은 상한을 적용한다. 32개를 넘으면 앞에서부터 버리고 `omittedEvents`에 기록한다. 누락은 조용히 사라지지 않는다.

## 수집 흐름

수집은 자동이 아니라 명시적이다. `connectDev` 콜백에서 recorder 메서드를 넘겨 주면 라이브 진단과 상태가 recorder로 흘러 들어간다. 앱이 recorder를 만들지 않으면 아무것도 모이지 않는다.

### connectDev에 연결하는 예제

```ts
import { connectDev, createSupportRecorder } from '@0disoft/saylo-vite/client';

const recorder = createSupportRecorder({
  runtime: 'browser',
  node: '24.18.0',            // 개발·빌드를 돌린 Node
  vite: '8.3.4',
  sayloCore: '0.1.0-alpha.4',
  sayloVite: '0.1.0-alpha.4',
});

const disconnect = connectDev(i18n, {
  catalogSource,
  onDiagnostic: diagnostic => recorder.onDiagnostic(diagnostic),
  onSyncState: state => recorder.onSyncState(state),
});

// 정리
// disconnect(); recorder.clear();
```

`onDiagnostic`은 `LiveDiagnostic`, `onSyncState`는 `DevSyncState`를 받는다. 두 콜백 모두 선택 항목이므로 recorder를 안 쓰는 앱은 아무것도 넘기지 않으면 된다.

같은 예제를 JavaScript로 쓰면 타입 주석만 뺀다.

```js
import { connectDev, createSupportRecorder } from '@0disoft/saylo-vite/client';

const recorder = createSupportRecorder({ runtime: 'browser', node: '24.18.0', vite: '8.3.4' });
const disconnect = connectDev(i18n, {
  catalogSource,
  onDiagnostic: d => recorder.onDiagnostic(d),
  onSyncState: s => recorder.onSyncState(s),
});
```

### 수동 저장과 제출

보고서는 앱이 원하는 시점에 문자열로 만든다. 라이브러리는 파일로 저장하거나 네트워크로 보내지 않는다.

```js
const json = JSON.stringify(recorder.getReport(), null, 2);
await navigator.clipboard.writeText(json); // 또는 Blob으로 파일 저장
```

제출 전에는 사람이 한 번 읽는다. 보고서에는 원문 메시지와 파일 이름이 없으므로 개인정보가 새지 않을 것으로 기대하지만, `position`이나 이벤트 개수 같은 숫자로 문제 규모를 파악하고, 문의 본문에 재현 절차를 함께 적는다.

### 예제 데모의 검토 UI

vanilla·React·Svelte·SvelteKit 예제는 같은 흐름의 문의용 진단 패널을 제공한다. `진단 자료 만들기`가 `getReport()`를 읽기 전용 textarea에 채우고, `오류 기록 지우기`가 `clear()` 뒤 현재 연결 상태를 다시 기록해 화면의 동기화 표시와 보고서가 어긋나지 않게 한다. 진단 자료의 textarea와 JSON에는 입력값·번역 원문·파일 이름이 들어가지 않고, 예제도 JSON을 저장하거나 전송하지 않는다. 생성·검토·지우기 흐름은 네 예제의 브라우저 확인에 포함됐다.

recorder 수명은 프레임워크에 맞춘다. React는 `useState` lazy initializer로 만들어 StrictMode 이중 렌더에서도 하나를 유지하고, Svelte는 컴포넌트 인스턴스 `const`로 만들며, SvelteKit은 공유 layout 인스턴스 `const`로 만들어 모듈 전역에 두지 않는다. 그래서 layout 안에서 `/`→`/about` SPA 이동에는 패널 입력과 진단 자료 문자열이 유지되고, layout 밖 `/plain`으로 나갔다 들어오면 새 recorder가 된다.

환경 메타데이터는 Vite `define`으로 주입한다. vanilla는 자체 Vite 설정에서 core·vite 버전을 읽고, React·Svelte는 `examples/shared/support-environment.mjs`에서 core·vite와 해당 adapter 버전을 읽는다. 개발·빌드 Node 버전도 함께 주입한다. SvelteKit은 독립 설치한 consumer라 `node_modules`에 설치된 패키지 `package.json`에서 버전을 읽는다.

`npm run verify:pack:sveltekit`은 두 모드를 나눈다. local 모드는 `examples/sveltekit`을 consumer로 복사해 support-check까지 돌린다. `--registry-version` 모드는 승인 릴리스 tarball 5개의 SHA-512를 `releases/<version>.json`과 대조하고, consumer로는 `scripts/pack-fixtures/sveltekit-registry`를 쓴다. 이 fixture는 source 리비전 `d26506ff78076b282033895f3966fb97dc86306c` 시점의 20개 파일 snapshot(`fixture.json`이 metadata)이고 게시된 계약만 쓰므로 새 API가 없어 support-check를 건너뛴다.

확인 범위는 이 네 예제다. 다른 예제가 지원한다고 이 문서는 단정하지 않는다.

### 정상 복구와 초기화

개발 서버가 다시 연결되거나 번역 파일이 복구되어도 recorder의 history는 남는다. 복구 전후에 어떤 진단이 오갔는지 나중에 추적할 수 있게 하려는 것이다. 초기화는 `clear()`로만 한다. `clear()`는 이벤트 버퍼, 마지막 `syncState`, `omittedEvents` 카운터를 함께 비운다. 상태까지 지우므로, 상태 표시를 계속 보여 주는 앱은 지운 뒤 현재 상태를 `onSyncState`로 다시 넣어 준다.

## 원인 재현

보고서는 원문 오류 표현과 파일 이름, 메시지 키를 담지 않는다. 그래서 보고서만으로는 같은 실패를 그대로 재현할 수 없다. 재현이 필요하면 문의 본문에 Saylo의 flat 카탈로그 형식으로 합성 번역을 최소로 적는다. 실제 사용자 문구가 아니라 문제를 일으킨 구조만 옮긴 짧은 예시다.

Saylo 카탈로그 파일은 `locales/<locale>/<namespace>.json`에 키를 평평하게 나열한다. 예를 들어 `INVALID_ICU` 진단이면 기준 로케일에 잘못된 ICU를 넣는다.

`locales/ko/demo.json`

```json
{ "countLabel": "{count, plural, invalid}" }
```

`locales/en/demo.json`

```json
{}
```

이렇게 두면 `countLabel`의 ICU 문법이 깨져 `INVALID_ICU`가 난다. `MISSING_MESSAGE`처럼 누락 계열 진단은 플러그인이 기준 로케일 값으로 fallback하는 기본 동작에서 안 날 수 있으므로, 그 코드를 재현하려면 `requireCompleteTranslations: true`인 운영 빌드 조건을 문의 본문에 함께 적는다.

합성 예시에는 실제 키 이름 대신 `demo` 같은 일반 키를 쓰고, 개인정보나 실제 서비스 문구를 넣지 않는다.

## 공개 창구에 대한 주의

일반 문의와 기능 제안은 [지원 안내](../SUPPORT.md), 비공개 보안 제보는 [보안 안내](../SECURITY.md)를 따른다. 연락처는 유지보수자의 공개 GitHub 프로필에 있는 이메일이며, 자료를 자동 전송하지 않는다. 제출 전 개인정보와 비밀값이 없는지 직접 검토한다. 이 안내와 메타데이터 변경은 로컬 미게시 상태다.

## 근거

이 문서는 다음을 읽고 작성했다.

- `packages/vite/src/support-report.ts` — 구현 계약.
- `packages/vite/src/client.ts` — export 목록과 `onDiagnostic` 연결 지점.
- `packages/vite/src/lazy-connection.ts` — lazy 경로의 `onDiagnostic` 전달.
- `packages/vite/src/types.ts` — `LiveDiagnostic`.
- `packages/vite/src/dev-sync.ts` — `DevSyncState`, 재시도 정책.
- `packages/core/src/types.ts` — `DiagnosticCode`, `SourcePosition`, `CatalogDiagnostic`.
- `examples/vanilla/vite.config.mjs`, `examples/vanilla/main.js`, `examples/vanilla/index.html` — 환경 주입과 검토 UI.
- `docs/dev-sync-state.md`, `packages/vite/README.md` — 동기화 상태 표기와 게시 상태.

게시본 상태와 코드 세부는 시점에 따라 달라진다. 실제 동작은 `packages/vite/src`와 `packages/vite/README.md`의 현행 코드가 우선한다.

