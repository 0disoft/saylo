# 15. 단순 메시지 파싱 경로

2026-10-07 일반 문자열과 ASCII `{name}` 보간에 한정된 내부 파싱 경로를 구현했다. 같은 프로세스에서 기준 parser와 교차 호출한 cold 비교 20쌍 중 18쌍이 빨랐고, after−before 차이의 중앙값은 −167.99ms였다. parser p95는 개선되지 않았다. 이후 대규모 로케일 추가 10회에서 목록 p95는 514.47ms로 관측했으며 250ms 목표는 여전히 미달이다.

이 변경은 로컬 checkout에만 있다. npm `0.1.0-alpha.1`에는 없고 공개 API·카탈로그 형식·인자 계약은 바꾸지 않았다.

## 구현 범위

`packages/core/src/simple-message.ts`가 top-level literal과 ASCII 식별자 인자만 읽어 FormatJS 형태의 AST를 만든다. 일반 텍스트는 Unicode·LF·CRLF·태그·top-level `#`를 포함할 수 있다. `{name}`, `{_value9}`, `{__proto__}` 등은 처리하지만 숫자로 시작하는 이름·Unicode 인자 이름·인자 안 공백은 기존 FormatJS로 넘긴다.

아포스트로피가 있는 메시지, number/date/time·skeleton·plural/select/ordinal, 그 밖의 형태도 FormatJS를 사용한다. 인자 이름 검사는 문자열 전체가 정확히 일치해야 한다. JavaScript 정규식 `$`가 끝 줄바꿈 앞에서도 일치하는 성질로 `{name\n}`을 잘못 받지 않도록 엄격한 끝 조건을 사용한다. 뒤에서 지원하지 않는 문법을 만나면 부분 AST를 버리고 원문 전체를 FormatJS로 처리한다. 닫는 괄호 단독처럼 top-level literal로 허용되는 경우도 기존 parser에 맡긴다.

`parseCatalog`는 단순 AST 또는 FormatJS AST를 받은 뒤 기존 `inferArguments`와 deep freeze를 그대로 적용한다. locale canonicalization·strict JSON·중복 ID·증분 previous catalog 재사용·오류 위치 매핑·번역 검증도 기존 경로다. 별도 전역 캐시나 locale 간 AST 재사용은 추가하지 않았다.

AST offset은 UTF-16이고 column은 FormatJS와 같은 Unicode 코드 포인트 기준이다. supplementary 문자 한 개는 offset 2·column 1을 차지한다. AST line은 LF에서 증가하고 CR은 일반 column이다. JSON 파일의 `SourcePosition`은 기존 UTF-16 column을 유지한다. AST 위치와 파일 위치를 같은 locator로 계산하지 않는다.

설치된 `@formatjs/icu-messageformat-parser` 3.5.20에는 이미 일반 문자열용 shortcut이 있다. 단순 보간이 이번 변경의 주요 대상이며, 기존 parser 전체를 대체하지 않는다.

## 검증

- core 69개, typegen 5개, Vite 72개 테스트(합계 146개) 통과.
- 새 5개 테스트가 FormatJS AST를 직접 기준으로 비교한다. Unicode·isolated surrogate·LF/CRLF·반복 인자·prototype 이름·빈 문자열·태그·`#`·아포스트로피·인자 공백과 malformed suffix를 다룬다. fragment 조합 121개도 대조한다.
- 인자 계약·실제 번역·깊은 불변성과 escaped JSON 오류 위치를 확인했다. 기존 duplicate ID·ICU conflict·incremental reuse·SSR·production AST chunk 테스트도 통과했다.
- workspace 전체 build와 core 소비자 typecheck 통과. core의 npm pack dry-run 목록에 새 내부 JS와 `.d.ts`가 포함됨을 확인했다. 실제 tarball 외부 소비자 설치 smoke·release publish는 실행하지 않았다.
- 실제 headless Chrome에서 추가→목록→선택→첫 번역→en 복귀→삭제를 12회 실행했다. 입력 노드·값·React 상태를 유지했고 reload가 없었다. 생성 선언 파일의 mtime·size가 유지됐으며 선택 전 새 카탈로그 응답 0개, 선택 뒤 fresh full 응답 1개였다. 종료 후 fixture·browser profile·해당 browser process가 남지 않았다.

## 동일 프로세스 cold 비교

```sh
node benchmarks/live-update/parse-compare.mjs a7367b9 benchmarks/results/parse-compare-simple-cold.json cold
```

`parse-compare.mjs`의 세 번째 선택 인자 `cold`를 추가했다. 기본 `incremental`은 기존 warmup 50·측정 100쌍을 유지한다. cold는 warmup 5·측정 20쌍이고, previous catalog를 넘기지 않고 10,000개 메시지를 매번 새로 파싱한다. en-GB에서 English literal과 ASCII `{name}` 보간을 사용한다. 두 parser의 실행 순서를 번갈아 바꾸며 결과 전체가 같은지 매번 비교한다. stringify·동등성 검사·disk·watcher·번역 검증·browser는 timing에서 제외한다.

기준은 `a7367b9`의 core source를 임시 디렉터리에서 compile한 parser다. 원시 pair와 실제 current module SHA-256은 [비교 결과](../benchmarks/results/parse-compare-simple-cold.json)에 있다. 이 hash는 아래 browser run과 같은 최종 parser를 가리킨다. Node 24.18.0과 같은 checkout 의존성을 사용했다.

| parser-only | 기준 | 빠른 경로 |
| --- | --- | --- |
| p50 | 514.92ms | 353.77ms |
| p95 | 995.91ms | 1,050.21ms |

pair별 after−before 중앙값은 −167.99ms, p95는 +54.30ms이며 18/20쌍이 개선됐다. 대표적인 비용 감소는 관측했지만 tail 지연 개선을 주장하지 않는다. GC·스케줄링 영향은 따로 분리하지 않았다. 모든 ICU 형태와 장비로 일반화하지 않는다.

## 실제 로케일 추가 재측정

```sh
node benchmarks/live-update/run.mjs --mode locale-add --server-file-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-simple-server-files.json
```

Node 24.18.0·Vite 8.3.2·React 19.3.0·HeadlessChrome 154에서 초기 10k×20개 로케일, namespace 1개, 새 파일 1개라는 [14의 조건](14-locale-add-server-measurements.md)을 그대로 썼다. 계측은 파일 저장 직전→목록 DOM ack이며 선택 뒤 full 응답·삭제는 서버 구간에서 제외한다. 요약은 [결과](../benchmarks/results/locale-add-simple-server-files.json), 원시는 [12회 sample](../benchmarks/results/locale-add-simple-server-files.10k-20-locales.samples.json)에 있다. warmup 2회는 제외한다.

| 항목 p95 | 앞선 run | 새 run |
| --- | --- | --- |
| 저장→목록 DOM ack | 1,808.23ms | 514.47ms |
| 카탈로그 파싱 | 1,132.23ms | 331.29ms |
| 선택 준비→첫 번역 ack | 877.85ms | 471.79ms |
| control 왕복 | 14.50ms | 3.45ms |
| 파일 쓰기 | 130.54ms | 14.16ms |

각 run은 warmup 2·측정 10·control 10이다. 10회 p95는 최대값이다. 실행 시점·부하가 다르고 control과 파일 쓰기도 달라졌으므로 감소 전체를 코드 변경 효과로 해석하지 않는다. 동일 프로세스 pair 비교와 따로 보고하며 단계 p95를 합산하지 않는다. 파서 p95가 개선되지 않은 결과도 함께 남긴다.

새 run에서 입력 JSON p95는 387,783 B, full catalog 응답 JSON p95는 4,421,174 B다. AST 형태가 같으므로 이 실행에서 전송 객체 크기는 줄지 않았다. 물리 네트워크 총 바이트도 아니다. 파싱 10회는 각각 1회였고 통계·잔여 구간·code hash를 대조했다. 250ms 목표와 full catalog 선택 비용 최적화가 남아 있다.
