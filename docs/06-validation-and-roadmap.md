# 06. 검증과 로드맵

이 문서는 성능 목표와 측정 정의, 인수 사례, 빌드 순서, 개발 로드맵을 정한다.

## 성능 목표

아래 수치는 목표다. 로컬 벤치마크로 일부를 측정했고, 결과와 한계는 [상세 성능 기록](10-performance-measurements.md)에 남겼다. request-scoped patch 적용 뒤 small은 재실행에서 p95 목표 안에 들어왔지만 같은 코드의 첫 run은 넘었고, large는 어느 run에서도 p95 목표를 넘었다. 어느 시나리오도 안정적 달성을 주장하지 않는다.

| 항목 | 목표 | 조건 |
| --- | --- | --- |
| 개발 중 카탈로그 문자열 수정 반영 | p95 ≤ 100ms | warmed 상태, 로컬 기준 환경 |
| 로케일 추가 후 목록 표시 | p95 ≤ 250ms | 대표 fixture. 새 로케일 최초 번역의 DOM 반영 시간은 별도 보고 |

### 측정 정의

- 측정 시작점은 파일 저장이 끝나고 harness가 그 저장을 관측한 시점이다. 저장 시작 시점을 기준으로 삼지 않는다.
- 종단 간 측정은 하나의 Node monotonic clock으로 한다. 파일 관측부터 브라우저의 DOM commit 확인 응답(ack)까지를 같은 clock으로 잰다. 이 값에는 ack 전달 비용이 들어가므로 그 비용을 함께 표시한다.
- 브라우저 내부의 수신→commit 시간은 별도로 기록한다. 서버 단계와 브라우저 단계를 분리해야 병목이 드러난다.
- 단계별 p95를 더해 종단 간 p95로 쓰지 않는다. 단계 값은 참고로만 병기한다.
- 개발 서버와 브라우저의 `performance.now`는 서로 다른 clock이므로 두 값을 직접 빼지 않는다. 같은 프로세스에서 도는 제어 harness로 한 clock에서 재거나, 동기화 추정 오차를 수치와 함께 명시한다.
- warm은 앱과 변경하지 않은 메시지의 formatter가 준비된 상태를 말한다. 수정된 메시지 자체의 formatter는 warm 조건에 넣지 않는다. 그 메시지는 새 내용이므로 편집 비용에 포함한다.
- 로케일 추가는 두 완료 지점을 구분해 잰다. 첫째는 로케일이 선택 가능한 목록에 나타나는 시점, 둘째는 그 로케일로 전환해 최초 번역이 DOM에 반영되는 시점이다. 파일 수, 총 바이트, namespace 수와 함께 정의해야 비교할 수 있다.
- 수정 반영과 로케일 추가는 p50과 p95를 함께 보고한다.
- 작은 규모에서만 돌린 벤치마크로 일반화하지 않는다. 규모를 나눠 측정한다. 예: 메시지 1k/10k, 로케일 3/20.
- typegen 비용과 cold startup은 수정 반영 수치에서 분리해 별도로 잰다.
- CI에서 광범위한 매트릭스로 비용을 부풀리지 않는다. 필요한 조합만 돌린다.

상세 벤치마크 결과와 프로파일 기록은 [10-performance-measurements.md](10-performance-measurements.md)에 있다.

## 인수 사례

초기 구현이 만족해야 할 핵심 사례다. 아직 통과를 주장하지 않는다.

아래 단계별 검증 기록은 작성 시점의 상태를 그대로 남긴 역사 기록이다. 이후 단계에서 바뀐 항목(예: 패키지 공개 배포와 version)은 그때 문장을 고치지 않고 [09-release.md](09-release.md)와 앞 절의 현행 값을 따른다.

2026-10-05 로컬 구현은 8단계까지 진행했다. 코어 33개, Vite 어댑터 28개, React 어댑터 5개, typegen 5개 테스트와 JS/TS 소비 타입 검사, React 데모 TS 검사가 통과했다. vanilla와 React production 빌드가 통과했다. 개발 브라우저에서 한국어·영어 파일 저장 후 문구 갱신, 입력값·포커스·커서·스크롤·열린 모달 유지, 잘못된 JSON의 마지막 정상 상태 유지와 수정 후 복구를 확인했다. vanilla에서 일본어 로케일·namespace 추가, 임시 파일 교체 저장, 현재 로케일 삭제 후 기준 언어 전환도 실제 watcher로 확인했다. React StrictMode에서 controlled input과 수량·모달 상태 보존, JSON 오류 복구와 언어 전환을 확인했다. 새 기준 키 추가로 `.d.ts`가 갱신되는 동안에도 React 상태가 유지되고, 문구만 수정하면 선언 파일의 수정 시간이 바뀌지 않는 것을 확인했다. typegen 검사는 초기 readiness, snapshot 우선 게시, generation 취소·최신 결과 수렴, 동일 내용의 쓰기 생략, 실패 후 선언 유지·재시도, 생성 파일 watch 제외와 생성된 타입의 TS/checkJs 소비를 확인한다. 성능 측정·부분 전송·SSR은 미완료다.

9단계의 eager handshake를 추가했다. Vite 어댑터 38개 테스트로 초기 연결, 요청 범위 echo, 중복·과거 응답, revision gap, 새 세션, 재연결 generation 무효화, 여러 store의 요청 분리, 제한된 재시도와 timer 정리를 검증했다. 전체 81개 테스트와 소비 타입 검사가 통과했다. React 개발 브라우저에서 문구 저장 후 입력·포커스·열린 모달 유지, 서버 중단·재기동 후 페이지 새로고침과 최신 카탈로그 복구를 확인했다. 부분 전송·pair별 version은 10단계에서 연결한다.

10a의 지연 로딩 코어를 추가했다. `createI18n`의 교차 의도 완료, 실제 언어 선택 대체, missing 폴백, 실패·timeout, pair별 version과 세션 검증, tombstone 유지, manifest 추가·삭제, dispose와 subscriber 오류를 16개 테스트로 검증했다. 전체 check와 JS/checkJs·TS 소비 검사, `npm run demo:lazy`가 통과했다. 코어 49개, React 5개, typegen 5개, Vite 38개로 총 97개 테스트가 통과했다. Vite 범용 loader·부분 전송과 React lazy 데모는 10b에서 연결한다.

10b의 Vite 범용 조회·부분 전송과 React 연결을 완료했다. 코어 49개, Vite 49개, React 6개, typegen 5개로 총 109개 테스트, 전체 check·JS/TS 소비 검사와 두 production 데모 빌드가 통과했다. 실제 브라우저 WebSocket에서 영어 선택의 `en/demo` 단독 조회, loaded pair 수정, 신규 namespace의 명시 로드 전 AST 미전송·로드 시 base+target 두 pair 조회를 확인했다. 폼 입력·포커스·모달 유지, JSON 오류 복구, 부팅 뒤 로케일 추가·선택, namespace 삭제와 현재 로케일 삭제 후 기준 언어 전환도 확인했다. 이 시점 운영 fallback은 전체 bundle이었고 정적 chunk loader는 11단계로 남아 있었다.

11단계의 운영 정적 로더를 구현하고 실제 결과로 검증했다. `virtual:saylo/lazy`가 전체 metadata manifest와 base+initial locale의 initialNamespaces pair만 inline으로 싣고, 나머지 present pair는 generated virtual module의 literal `import()` loader entry로 분리한다. `createStaticCatalogSource(initialManifest, initialCatalogs, entries)`가 on-demand import·cache·dedupe를 처리하고, 실패나 session·version·fingerprint/key 불일치는 캐시에 반영하지 않으며 missing tombstone은 import 없이 반환한다. dev source와 eager `virtual:saylo`는 기존과 같다. 새 테스트 4개가 실제 Vite production build의 분리된 dynamic chunk 3개, emitted module 실행(locale+namespace fallback), fresh invalid disk build 실패, 정적 source dedupe·cache·retry·missing을 확인하고 기존 lazy test는 fallback에서 chunk 계약 검사로 교체했다. `npm run check`가 통과했고 core 49·Vite 53·React 6·typegen 5로 총 113개, JS/TS 소비 검사와 두 데모 production build가 통과했다. React 운영 브라우저 CDP에서 초기 요청은 HTML·main JS·CSS뿐이었고 영어 선택 시 demo dynamic chunk 하나만 요청됐으며 한국어/영어 재전환에는 추가 요청이 없었다. 폼 입력·포커스와 열린 모달·모달 입력이 유지됐고 WebSocket 연결과 console error/warn은 0이었다. 성능 수치·parser elimination·SSR은 미완료다.

12단계의 SSR serializer와 hydration을 구현하고 로컬 검증을 진행했다. `createBootSnapshot`·`serializeBootSnapshot`·`decodeBootSnapshot`을 공개했고, boot wire는 parsed catalog의 sourceName·locale·AST·인자를 배열로 싣는다. 직렬화는 모든 `<`를 `\u003c`로, U+2028·U+2029를 escape한다. loaded base+target pair의 present/missing outcome을 빠짐없이 명시하고 누락·중복 outcome과 stamp·schema 불일치는 `INVALID_BOOT`로 거부하며, boot timeZone은 config와 일치해야 한다. `createServerI18n`은 async scope를 준비해 `getServerSnapshot`이 생성 시점 snapshot이 되는 문제를 피하고, `createHydrationAdapter`는 boot S1을 유지하면서 이후 snapshot을 최신 하나로 buffer해 `finishHydration()`에서 한 번 publish한다. SSR fixture는 `examples/ssr/{app,entry-server,client,config,server,demo}.mjs`로 추가했고, `npm run demo:ssr`가 ko/en 동시 요청 renderToString과 boot locale 검사를 수행한 뒤 종료하며 `npm run dev:ssr`는 127.0.0.1:5190/?locale=en에서 실제 서버·client hydrateRoot(StrictMode)·live connectDev를 확인한다. 이미 실행한 검사는 core의 html-safe roundtrip·timeZone·metadata 거부·요청 간 격리, React의 renderToString+hydrateRoot boot S1 `t` 고정·S2/S3 buffer 1회 적용·DOM·입력·포커스·state 보존, Vite SSR의 개발 watcher 다음 요청 최신 문구와 production SSR bundle 동적 import·요청별 ko/en 분리다. 전체 `npm run check`, JS/TS 소비 검사와 두 production 데모 빌드가 통과했다. core 53·React 9·Vite 55·typegen 5로 총 122개 테스트가 통과했다. 실제 SSR 브라우저에서 영어 첫 화면의 hydration과 클릭·입력 동작, 파일 수정 뒤 입력·수량 상태 유지, 다음 서버 응답의 최신 문구 반영을 확인했고 콘솔 경고·오류는 없었다. 카탈로그 요청의 초기 generation이 서버 검증을 만족하도록 수정하고 lazy fixture에도 실제 서버 검증기를 연결했다. 패키지 공개 배포는 미완료다.

라이브 갱신 최적화 라운드를 진행했다. `node --cpu-prof`로 병목을 확인하고 core 동결·schema·fingerprint·이전 AST 재사용을 손봤다. `npm run check`의 126개 테스트와 추가 Vite 통합 테스트 1개가 통과했다(core 57, Vite 56, React 9, typegen 5, 합 127). JS/TS 소비 검사와 vanilla·React production 빌드도 통과했다. 같은 fixture로 벤치마크를 다시 돌려 전후 값을 [live-update-optimized.json](../benchmarks/results/live-update-optimized.json)에 남겼고, raw sample summary가 nearest-rank 집계와 일치했다. 두 시나리오 모두 입력 상태가 유지되고 문구만 수정했을 때 `.d.ts`의 mtime과 size가 바뀌지 않았다. 성능 수치는 결과 파일 기준이며, 패키지 공개 배포는 미완료다.

13단계의 request-scoped message patch를 구현했다. pair 응답이 직전 baseline과 맞으면 바뀐 메시지 delta가 되고, 아니면 full로 돌아간다. 서버는 pair마다 직전 present version 하나만 보관하고, 클라이언트는 요청마다 immutable baseline을 고정한다. `validateTranslation`은 깊게 동결한 번역·기준 인자 스키마가 이전 검증 때와 같은 객체이고 ID도 같으면 결과를 재사용하고, 서버 version 판정은 정렬·stringify를 없앴다. core 58·React 9·typegen 5·Vite 68로 총 140개 테스트가 통과했다. 전체 스위트는 140개 중 139개가 한 번에 통과했고, typegen background Windows rename EPERM으로 실패한 1개는 그 테스트만 단독 재실행해 통과했다. JS/TS 소비 검사와 React TS 검사도 따로 통과했다. 거부된 delta가 부분 mutation을 남기지 않는지, messageCount와 위치 유효성 검사, 클라이언트의 full 재요청을 테스트로 확인했다. 두 production 데모 빌드가 통과했다. 같은 fixture로 첫 run과 재실행 두 번 측정해 각각 [live-update-patch.json](../benchmarks/results/live-update-patch.json)와 [live-update-patch-repeat.json](../benchmarks/results/live-update-patch-repeat.json)에 보존했다. 운영 pack 소비 검증과 첫 배포 준비는 아직 미완료다.

운영 pack 소비 검증을 추가했다. `npm run verify:pack`이 [scripts/pack-smoke.mjs](../scripts/pack-smoke.mjs)로 네 패키지를 `npm pack --workspaces`로 묶어 저장소 밖 `os.tmpdir()/saylo-pack-*`의 JS·TS 소비 앱 두 개에 tarball로 설치한다. 각 tarball의 `exports`·`bin` 파일 존재, non-link 설치, 설치된 `saylo-typegen` binary 타입 생성, JS checkJs와 TS strict 타입 검사(누락·잘못된 인자·없는 키 `@ts-expect-error`), Node 번역·`InvalidArgumentError`·React `renderToString`·public subpath, Vite production lazy chunk manifest(`isDynamicEntry`)를 확인한 뒤 자신이 만든 임시 디렉터리만 지운다. 2026-10-06 Node 24.18.0·Vite 8.3.2에서 exit 0으로 통과했고, 성공·fail run 뒤 `os.tmpdir()` 잔여 `saylo-pack-*`는 0개였다. pack 크기는 core 19098, react 2032, typegen 4501, vite 17481바이트로 참고값이다. root `package.json`에는 `verify:pack`만 추가했고 나머지 스크립트·`private`·version은 그대로이며 공개 배포는 하지 않았다.

이 검증은 npm registry에서 peer·도구를 설치하므로 네트워크가 필요하고, 소비 앱은 루트 `devDependencies`의 major 범위(react 19, vite 8, typescript 7, @types/*)를 쓴다. 설치는 `--ignore-scripts`로 하고 상속된 `npm_config_allow_scripts`는 스크립트가 걸러 내므로 전역 npm 설정을 바꾸지 않는다. tarball 설치는 배포가 아니며 실제 브라우저·HMR·SSR hydration은 여기서 확인하지 않는다. `npm run check`는 새 core 변경이 없어 이전 커밋의 140개 pass를 그대로 둔다.

패키지 이름을 `@0disoft/saylo-core`·`@0disoft/saylo-react`·`@0disoft/saylo-typegen`·`@0disoft/saylo-vite`로 정리했고 문서의 샘플·import·`compilerOptions.types`도 이 이름으로 통일했다. 제품명 Saylo, `virtual:saylo/*`, CLI `saylo-typegen`은 그대로다. 2026-10-05T17:38:29Z(KST 2026-10-06)에 npm 공개 registry에서 네 이름을 Node `fetch`로 조회해 모두 HTTP 404를 받았는데, 공개 등록이 아직 없다는 뜻이며 이름 예약이나 실제 배포 권한 검증이 아니다. package.json은 `private: true`·version 0.0.0을 유지하고 아직 공개 배포하지 않았다. 배포는 Mensor의 workflow_dispatch·Node 24·id-token: write·npm publish --provenance 구성을 참고했지만 Saylo 배포 workflow와 Trusted Publisher 설정은 아직 구성하지 않았고 확인되지 않았다. 이번 변경에서 워크플로 파일은 추가하지 않았다. 스코프 이름에서는 `pack.name.split('/')[1]`이 디렉터리명과 달라지므로 pack 스크립트가 논리 이름에서 `packages/<dir>`로 매핑하도록 고쳤다. 이름 변경 뒤 다시 돌린 `npm run check`는 140개 테스트와 JS/TS 소비 검사·React TS가, `npm run verify:pack`은 새 이름 tarball 4개의 JS/TS 앱 설치와 installed CLI·checkJs·TS·runtime·React SSR·public subpath·Vite production chunk가 모두 exit 0으로 통과했다. offline 설치에서 4개 추가·4개 제거로 workspace 링크와 lock이 갱신됐고 third-party 버전은 그대로다.

패키지 소개 문서와 npm 메타데이터를 추가했다. `packages/core`·`packages/react`·`packages/typegen`·`packages/vite`에 README를 새로 쓰고, 각 `package.json`에 `description`·`repository`·`homepage`·`bugs`·`keywords` 다섯 필드만 더했다. 이름은 `@0disoft/saylo-*`이고 저장소는 `https://github.com/0disoft/saylo.git`다. `private: true`·version 0.0.0·exports·bin·scripts·license는 그대로이며 공개 배포는 하지 않았다. README의 설치 명령은 게시 후 기준으로 표시했고 현재 공개 registry에는 없다. 2026-10-06 `npm run verify:pack`(Node 24.18.0·Vite 8.3.2)이 exit 0으로 통과했다. 네 README가 pack 목록에 들어가고, 저장소 밖 JS·TS 소비 앱에 설치한 tarball의 README 바이트와 metadata 다섯 필드가 원본과 일치했다. core README 첫 JS 블록은 Node로 실행하고, React tsx·typegen TS·Vite TS 블록은 실제 발췌를 독립 앱에서 tsc·generated `.d.ts`로 검사했다. manifest audit에서 다섯 필드 외 JSON 구조는 원본과 같고 README 로컬 링크 대상·코드 울타리도 확인했다. CLI·checkJs·TS·번역 인자 거부·React SSR·public subpath·Vite production chunk 기존 검사도 통과했다. code 변경이 없어 140개 `npm run check`는 다시 돌리지 않았다.

secondary quarantine을 Vite plugin에 구현했다. `LiveRegistry`가 raw desired와 파일별 last-good 번역을 유지하고, 기준 schema가 바뀌면 직전 정상 번역에서 부적합 메시지만 제거한 immutable catalog를 게시하며 빠진 메시지는 base fallback으로 둔다. 잘못된 secondary 편집은 그 파일의 last-good을 유지하고 다른 파일 변경은 계속 반영한다. last-good이 없는 새 secondary는 게시하지 않고, 삭제 시 last-good을 지운다. 기준이나 번역이 복구되면 raw 번역을 자동 재검증해 복원하고 진단을 해제한다. startup·build의 전체 엄격 검증과 코어 `createStore.replaceCatalogs`의 동작은 그대로이고, 격리는 plugin 계층에만 있다. Vite test의 plugin·lazy·patch·production·server 스위트 합 56개가 통과했고 `vite build`와 소비 TS 검사도 통과했다. 이후 성능 fastpath 수정을 반영한 커밋 `6023fb2`에서 관련 Vite plugin 30개 테스트를 다시 통과했다. 실제 브라우저 확인 결과는 아래에 있다.

2026-10-07(KST), `8382eb7`, Windows Node 24.18.0·Vite 8.3.2·Codex IAB에서 vanilla 데모의 실제 watcher·WebSocket 자동 갱신을 확인했다. 서버 재시작이나 수동 reload 없이 다음을 관측했다.

- 영어 선택·수량 3·폼 입력·열린 dialog 상태에서 ko `summary`를 plural에서 `격리 폴백: 상품 {count}개`로 바꿨다. 기준 `count` 계약이 number에서 string|number로 넓어지자 영어 plural 메시지만 격리되고 나머지 12키와 영어 선택은 유지됐다. 화면에는 `격리 폴백: 상품 3개`가 표시됐고 `en/demo.json [summary]`에 인자 타입 진단이 나왔다.
- 미리 추가한 임시 `ja/demo.json`은 영어 카탈로그를 복제하고 `summary`를 plain count로 바꾼 fixture였다. ja로 전환한 뒤 heading을 수정하자 새 문구가 반영됐고 영어의 격리 진단은 유지됐다. 다른 파일의 정상 편집이 차단되지 않았다.
- 영어 `summary`를 `Recovered translation: {count} items`로 고치자 번역이 자동 복원되고 진단이 해제됐다.
- 영어 원본 plural을 다시 저장하면 아직 기준 계약과 맞지 않아 직전 정상 번역이 유지되고 진단이 재표시됐다. 이후 한국어 원본만 복원하자 영어를 다시 저장하지 않아도 `3 items`가 자동 복원되고 진단이 해제됐다.

이 편집에서 `#name`·`#note`·`#confirmation-note` 입력값, 수량과 열린 dialog 상태가 유지됐다. schema-breaking 편집의 한 관측 사례이며 일반 상태 보존 보장은 확대하지 않는다. 브라우저 콘솔 오류·경고는 없었고 서버에는 예상된 스키마 진단 경고 2회가 남았다. 원본 JSON은 바이트 단위로 복원했고 임시 로케일·백업·브라우저 탭을 제거하고 개발 서버를 종료했다. 구현 코드 변경이 없어 기존 전체 테스트는 재실행하지 않았다.

Vite production build에 parser 제거를 구현했다. `@0disoft/saylo-core/runtime`은 `parseCatalog`를 제외하고, `astRuntime`(기본 `true`)은 Saylo formatter에만 FormatJS의 공개 `no-parser.js` 경로를 적용한다. 외부 문자열 기반 FormatJS 소비와 SSR external 의존성은 유지한다. 적용 범위와 끄는 방법은 [05-build-and-ssr.md](05-build-and-ssr.md)를 따른다. quarantine과 parser 제거는 아직 npm `0.1.0-alpha.1`에 포함되지 않은 로컬 변경이다.

전체 `npm run check`가 exit 0으로 통과했다(core 58·React 9·typegen 5·Vite 72, 합 144개, JS/TS 소비·React TS 검사, OIDC helper 3개 별도). production 검사는 AST-only 번들의 parser 오류 표식 부재, 숫자·날짜·시간 skeleton·plural offset·selectordinal·select·중첩·태그 8벡터의 최적화 전후 출력 일치, 외부 FormatJS 문자열 번역, lazy chunk 실행·fallback, 잘못된 디스크 카탈로그의 build 거부를 확인했다. `npm run verify:pack`도 exit 0으로 통과했다. 저장소 밖 JS·TS 앱에서 tarball 설치·CLI·typegen·checkJs·strict TS·README 예제·runtime 엔트리·React SSR·Vite lazy build와 parser 오류 표식 부재를 확인했다.

이 run에서 비교 fixture의 압축 전 JS 청크 합은 168,462 B → 117,385 B였다. 같은 fixture의 `astRuntime: false`/`true` 빌드 비교이며, gzip 크기나 대표 앱 결과가 아니다. 이후 2026-10-07 실제 vanilla·React 데모의 기본 minify 적용 JS를 같은 옵션으로 비교했다. 초기 JS gzip 합은 vanilla 19,656→12,796 B, React 92,241→85,139 B이고 React의 영어 지연 청크는 유지됐다. 조건·청크별 원본과 gzip 크기는 [10-performance-measurements.md](10-performance-measurements.md)에 기록했다.

2026-10-07 격리 구현 후 현재 코드로 라이브 반영도 재측정했다. warmup 5회·측정 50회·control 25회, CPU profiler 끔 조건에서 small(1k×3) save→DOM ack p95는 72.26ms, large(10k×20)는 209.23ms였다. 두 시나리오의 50회 측정 모두 patch 응답이고 full 응답은 0회였으며 입력 노드·값과 컴포넌트 state가 유지되고 생성 `.d.ts`는 다시 쓰이지 않았다. 대규모 목표는 여전히 미달이다. 서버 번역 준비를 별도 구간으로 분리한 조건·raw 결과·다음 최적화 후보는 [10-performance-measurements.md](10-performance-measurements.md)의 격리 구현 후 기록을 따른다. 로케일 추가 지연과 다른 라이브러리 비교는 아직 측정하지 않았다.

이후 benchmark 전용 브라우저 구간 계측을 추가하고 immutable catalog의 signature fragment를 재사용했다. 같은 계측 옵션에서 large signature 생성 p95는 16.90→6.20ms, snapshot 생성은 28.60→16.00ms로 낮게 관측됐다. 계측 없는 일반 개발 설정의 최적화 후 p95는 small 68.00ms·large 185.87ms여서 대규모 목표는 여전히 미달이다. content 기반 no-op·schema 변경·SSR boot·full resync를 포함한 관련 테스트 44개가 통과했다. 옵션에 따른 prebundle 차이, control 왕복과 run 간 부하, 메모리 비용을 포함한 조건·한계는 [10-performance-measurements.md](10-performance-measurements.md)를 따른다. 로컬 변경이며 npm 게시본에는 없다.

서버 파일 구간을 benchmark-only Node hook으로 분리 계측했다. large의 UTF-8 읽기 p95는 1.43ms, parseCatalog 호출은 46.82ms였다. runtime 변경 없이 측정했고 다음 최적화 대상은 파서 내부 JSON 처리·위치 계산·메시지 순회다. 읽기·파싱 내부 clock 및 비동기 대기, 원시 residual 정의, 정상 단일 파일 편집이라는 한계는 [10-performance-measurements.md](10-performance-measurements.md)의 서버 파일 계측 기록을 따른다.

| # | 사례 | 확인 내용 |
| --- | --- | --- |
| 1 | 상태 보존 | 문구 수정 후 입력값·모달·스크롤 위치가 유지된다 |
| 2 | 추가·수정·삭제 | 키 추가, 값 수정, 키 삭제가 각각 수렴한다 |
| 3 | 파싱 복구 | 깨진 JSON/ICU를 넣어도 마지막 정상값이 유지되고 진단이 나온다 |
| 4 | 재연결·갭 | 새 세션·revision gap에서 full snapshot으로 복구하고, 중복·오래된 patch는 discard한다. Vite 재시작 후 DOM 보존은 요구하지 않는다 |
| 5 | 비동기 타입 schema | baseline schema 변경 시 quarantine과 fallback이 동작한다(quarantine는 plugin 구현 완료. 단위·통합 테스트와 2026-10-07 실제 브라우저 검증을 통과했다). 키 삭제·필수 인자 추가 후 기존 호출 오류는 진단하며 DOM 보존을 요구하지 않는다 |
| 6 | 포맷 일치 | 변수, number/date/time, plural/select가 같은 Intl locale data·런타임에서 dev/prod 동일 출력을 낸다(고정 timeZone, 고정 시각 입력) |
| 7 | SSR 동시성 | 요청 간 로케일·카탈로그가 섞이지 않는다 |
| 8 | JS/TS 소비 | JS 프로젝트와 TS 프로젝트에서 모두 설치·소비가 된다(스모크) |
| 9 | union t 타입 | union 키는 먼저 좁혀야 하고, 잘못된 인자와 인자 누락이 거부된다 |
| 10 | checkJs 소비 | JSDoc typed JS에서 같은 인자 오류를 잡는다 |
| 11 | 신규 namespace 로더 | 부팅 뒤 추가된 namespace를 범용 `loadCatalog`가 로드한다 |
| 12 | locales 전체 목록 | `availableLocales`가 매번 전체 목록으로 교체된다 |
| 13 | desired generation 교차 완료 | `setLocale`와 `loadNamespace`가 교차 완료해도 최신 desired state로 수렴한다 |
| 14 | snapshot-bound hydration | hydration 동안 t가 S1을 읽고, S2는 barrier 뒤 한 번만 적용된다 |
| 15 | JS 런타임 인자 검증 | JS에서도 base required arg 검증이 `InvalidArgumentError`로 동작한다 |

날짜·시간을 다루는 검사는 timeZone을 고정하고 고정 시각 입력을 쓴다. 런타임에서 현재 시각(`Date.now`/`currentTime`)을 호출하지 않는다. 네이티브 ICU 지원은 OS·브라우저마다 다르므로 parity는 같은 Intl 데이터·런타임 매트릭스 아래에서만 의미가 있다.

## 빌드 순서

순서는 typegen(generate) → tsc(consumer 타입 체크) → build(Vite)다. Vite build 자체는 consumer TS 타입 체크를 하지 않으므로 tsc를 build 앞에 둔다. 별도 package/version 설정 파일 구현은 이번 범위 밖이다.

## 검증 방식

- 문서와 구현을 함께 갱신한다. 공개 타입 선언과 소비 fixture 검사, 실제 production build·정적 loader 검증을 수행하고, Markdown 링크·JSON 예제·코드 블록·파일 크기도 확인한다. 현재 구현의 결과는 이 문서의 단계별 검증 기록에 남긴다. 문서 설계 리뷰는 [리뷰 반영 기록](../review/feedback-resolution.ko.md)을 참고한다.
- 실행하지 않은 검사는 pass가 아니다. 문서 링크 확인도 항목별로 남긴다.
- 검증하지 않은 항목은 미검증으로 유지한다. 성능은 로컬 실측 기록과 목표를 구분해 적는다.

## 로드맵

작은 커밋 단위로 나눠 순차 진행한다. 각 단계는 그 자체로 쓸 수 있는 데모를 남기는 것을 목표로 한다. 처음에는 작은 fixture를 eager로 실어 상태 보존을 보여주고, 이후 같은 API 아래에서 전송을 세분화한다. 1~13단계 로컬 구현에 secondary quarantine과 build-time parser 런타임 제거(`astRuntime`)를 더했다. 두 변경 모두 로컬이고 게시된 npm alpha에는 아직 없다. unused message 제거·selector 미세구독·completeTranslations·Svelte/Vue 어댑터·대규모 성능 목표·비교 실험은 후속이다.

| 순서 | 커밋의 한 가지 책임 | 완료 기준 |
| --- | --- | --- |
| 1 | 계약 수정과 타입 fixture | union 키 반례를 막고, snapshot·locale 목록·fallback 의미를 확정한다 |
| 2 | JSON/ICU 파싱과 baseline schema 추출 | 중복 ID·문법 오류·인자 호환성을 작은 fixture로 판정한다 |
| 3 | AST 포맷과 순수 snapshot 조회 | 고정 locale·timeZone에서 t와 fallback이 동작한다 |
| 4 | immutable store와 vanilla 폼 데모 | eager snapshot 교체만으로 텍스트가 바뀌고 입력 DOM은 유지된다 |
| 5 | Vite change 연결 | 관리 카탈로그 수정이 앱 모듈 교체 없이 데모에 반영된다. 첫 핵심 데모다 |
| 6 | add/unlink와 listener 정리 | locale·namespace 추가, atomic save, 해제 후 재연결을 처리한다 |
| 7 | React typed context와 snapshot-bound hook | 타입을 유지하면서 같은 상태 보존 데모가 React에서 동작한다 |
| 8 | baseline typegen | 초기 readiness, 배경 생성, generation 취소, 내용이 바뀔 때만 `.d.ts` 쓰기를 구현한다 |
| 9 | 세션·snapshot handshake와 resync | 범위가 있는 snapshot 요청, 중복·gap·늦은 응답을 처리한다 |
| 10a | 지연 로딩 코어와 전환 조정 | desired locale·namespace 준비 상태, missing·failure·stale 결과를 처리한다. 로컬 구현 완료 |
| 10b | Vite 범용 로더와 부분 전송 | boot 이후 새 namespace 조회, pair별 version·tombstone, loaded scope 갱신과 React 데모를 연결한다. 로컬 구현 완료 |
| 11 | fresh production build | 현재 디스크 검증 → typegen → consumer 검사 → AST·정적 loader 산출을 연결한다. 로컬 구현 완료 |
| 12 | SSR serializer와 hydration fixture | 요청별 snapshot, boot escape, hydration 직전 갱신을 검증한다. 로컬 구현 완료 |
| 13 | 변경 메시지별 patch 전송 | 바뀐 메시지만 보내고 상태 보존·수렴을 유지한다. wire 크기와 브라우저 검증·동결 비용이 줄어든다. 로컬 구현 완료 |

1~8단계에서는 작은 fixture를 eager로 실어도 된다. 9~10단계에서 부분 전송과 미로드 상태가 들어올 때 카탈로그별 버전 계약을 적용한다. 위 표의 완료 기준은 그 단계의 데모·검증 목표이고, 1~13단계는 로컬 구현을 마쳤다.
