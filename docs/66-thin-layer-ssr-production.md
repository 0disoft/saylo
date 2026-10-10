# 66. thin-layer SSR·production hydration

## 범위

[65](65-thin-layer-ast-production.md) 뒤에 실제 production browser와 SSR hydration을 확인한 기록이다. benchmark 전용이고 제품 source·공개 API·버전은 바뀌지 않았다. 지금 범위는 실제 production client의 SSR hydration과 tested CDP host 시간대 매트릭스(12케이스, missing pair 포함)까지다.

lazy·session·reconnect·메모리·large scale·full contract·성능·릴리스는 아직이다. 모든 browser·OS 조합도 아니다.

## 코드

- `hydration-layer.mjs`는 공개 core `decodeBootSnapshot`으로 boot를 검증한 뒤 그 위에 i18next layer를 다시 세운다.
- React `useSyncExternalStore`로 붙는 hydration barrier는 이 실험의 자체 구현이다. i18next가 주는 기능이 아니다.
- barrier는 처음에 boot snapshot에 묶인다. early replace는 queue로만 남고 알림이 0이며, `finishHydration`이 latest 1회만 발행하고 재호출은 멱등이다. hydration 뒤 replacement는 정상 발행하고 dispose는 listener를 비우며 이후 갱신·구독을 거부한다.
- `ssr-fixture.mjs`는 core `parseCatalog`·`createBootSnapshot`·`serializeBootSnapshot`을 쓴다. wire에 `</script><script>` 문자열과 U+2028·U+2029를 넣어 두고, server literal은 HTML-safe로 boot·pending payload는 인코딩으로 escape한다.
- `ssr-view.mjs`는 server와 client가 같은 React 컴포넌트를 공유한다.

## 초기 검증 (`49c21e2`, 3케이스)

- hydration 단위 test 5개 PASS: malformed wire·schema mismatch·timezone 충돌 거부, early replace 뒤 1회 release, invalid queued 번역이 마지막 유효 후보를 덮지 않음, 동시 요청의 분리된 barrier·timezone, dispose 뒤 정리와 거부.
- Node에서 React SSR 동시 요청 3개(ru/UTC, en/Asia/Seoul, ru/America/Los_Angeles)를 렌더한 뒤, 실제 headless Chromium으로 Vite production build 하나를 hydration했다.
- 요청 3개 모두 PASS다. 초기 SSR node identity·title이 boot와 맞고 recoverable error가 0이다.
- Middle·Latest가 hydrate 전에 queue되고 barrier 동안 알림이 0이다. barrier 유지 중에도 버튼 count 1·dialog open이 되고, finish 뒤 latest만 알림 1, 두 번째 finish도 1이다. Post replacement 뒤 알림 2다.
- input draft·focus·caret(3)과 h1·input·dialog identity, component counter 1·dialog open이 보존된다. old bound t는 server 문자열을 유지한다.
- boot의 timeZone이 맞고 fallback source plural은 `0 rows`다. 주입 플래그는 없다.
- 초기 3케이스에서는 browser host가 Asia/Seoul 고정이었고 timeZone 3개는 명시 설정값이었다. host 매트릭스는 아래 section에서 다룬다.
- production client asset은 parser marker false다. 718297 unminified·146136 gzip은 React·DOM·bootstrap 검증을 포함하므로 translator-only small fixture 크기와 비교하지 않는다.
- React가 mode를 process에서 읽어 `process.env.NODE_ENV`을 production으로 명시 define했다. 초기 harness 실패는 이 define 누락이었고 제품 결함이 아니다.

## 비용·남은 목표

- custom layer·barrier는 private 실험이고 유지보수 대상이다. i18next 기본 기능이 아니다.
- boot는 로드한 pair 데이터와 전체 manifest 목록을 함께 싣는다. 선언된 로케일 유지까지 확인했고, manifest 갱신·빈 로드 범위·namespace 계약은 아직 미완이다.
- 남은 목표는 lazy·session·reconnect·메모리·large scale·full contract·성능·릴리스다. 제품 source는 그대로라 root full check는 돌리지 않았다.
- [원시 결과](../benchmarks/results/thin-layer-ssr-production-2026-10-11.json)에 요청 3건과 production client 정보가 있다.

## 재현

```sh
npm --prefix benchmarks/thin-layer run test:hydration
node benchmarks/thin-layer/ssr-production-probe.mjs --out benchmarks/results/thin-layer-ssr-production-2026-10-11.json
```

## browser host 시간대 매트릭스 (`e208980`)

- `chrome-protocol.mjs`는 소유 headless profile의 `DevToolsActivePort`만 읽어 local로 접속한다. 남의 브라우저나 OS 시간대는 건드리지 않는다.
- `/json/protocol`에서 `Target.createTarget`·`Target.attachToTarget`·`Emulation.setTimezoneOverride`·`Page.navigate` 제공을 확인한 뒤 target session에 시간대를 override하고 페이지를 옮긴다.
- `--host-matrix`는 production asset 하나를 build하고 Node SSR 9개를 동시에 미리 렌더한 다음 CDP로 9페이지를 순회한다. host UTC·Asia/Seoul·America/Los_Angeles × config UTC(ru)·Asia/Seoul(en)·America/Los_Angeles(ru)다.
- browser는 실제 `Intl` host 값을 보고하고 HTTP server가 기대값과 맞는지 검증한다. Node SSR의 timeZone은 host와 무관한 config 값이다. snapshot은 설정 timeZone을 따르고 fallback date는 host와 무관하게 `1/1/2026 / 00:30`·`09:30`·`12/31/2025 / 16:30`으로 갈린다.
- 9페이지 모두 recoverable error 0이고 input focus·caret, h1·input·dialog identity, count·dialog open이 보존된다. 알림은 early 0 → release 1 → Post 2다.
- old `t`는 server의 unsafe literal 문자열을 그대로 유지하고 주입 플래그는 없다.
- plural 인자를 21로 올려 en `other`(`21 rows`)를 server·client가 함께 확인한다. v1의 `0 rows`보다 locale·source 선택이 분명하게 갈린다.
- production asset은 parser marker false이고 718532 unminified·146191 gzip이다. 이 값은 새 파일에서 읽은 것이라 위 v1 수치와 합치지 않는다.
- 범위는 실제 Chromium의 emulated host 시간대 매트릭스까지다. 모든 browser·OS 조합과 lazy·session·reconnect·full contract·성능·메모리·릴리스는 아니다.

### v1 기록과 현재 source

- 위 v1 raw(`thin-layer-ssr-production-2026-10-11.json`, `49c21e2`)는 format v1·3케이스·plural `0 rows`로 그대로 보존한다.
- 현재 source는 format v2를 쓰고 plural이 21이다. default 3케이스 모드는 남아 있지만 지금 다시 돌리면 v1 raw가 아니라 v2가 나온다. v1을 재현하려면 `49c21e2` 소스가 필요하다.
- 재현은 `node benchmarks/thin-layer/ssr-production-probe.mjs --host-matrix --out benchmarks/results/thin-layer-ssr-production-host-matrix-2026-10-11.json`이다. [원시 결과](../benchmarks/results/thin-layer-ssr-production-host-matrix-2026-10-11.json)

## 누락 pair bug 수정 (`9312a2a`)

- 관측된 bug는 boot locale ru·manifest availableLocales en·ru인데 ru/demo outcome이 missing일 때였다. 복원한 layer가 locale en·availableLocales en만으로 바뀌었다.
- `catalog-layer`가 options.availableLocales를 받으면 canonical·unique·base 포함을 검증하고, 로드한 catalog locale이 선언 밖이면 거부한다. snapshot.availableLocales는 선언 목록을 쓰고 target이 unloaded여도 selected locale을 유지한다. hydration layer는 boot manifest 목록을 넘기고 SSR server constructor도 같다.
- options가 없는 일반 eager factory는 기존 derived 목록 동작 그대로다.
- 단위 test는 hydration 6개 + timezone 5개 = 11개 PASS다. 추가된 하나는 "explicit missing target pairs preserve the selected boot locale and manifest availability"다.
- host matrix에 `--missing-target`을 붙여 12페이지를 확인했다. base en/demo는 present, target ru/demo는 missing이고, ru availability를 정당화하도록 ru/help·en/help를 다른 namespace로 실제 넣었다. boot의 loadedNamespaces는 demo이고 help catalog는 boot에 없다.
- Middle·Latest가 hydrate 전에 queue된 사이 실제 ru/demo가 도착하고 help resource도 eager update로 들어온다. barrier 전까지는 locale ru·greeting English fallback이고, release 뒤 Latest가 ru로 게시된다. retained old bound는 English를 유지한다.
- 12페이지는 CDP host 3 × (표준 config 3 + missing ru/UTC 1)이고 모두 PASS다. error 0, 상태 보존, source plural `21 rows` 구분도 유지된다.
- production asset은 parser marker false다. [원시 결과](../benchmarks/results/thin-layer-ssr-production-missing-pair-fix-2026-10-11.json)
- 남은 한계는 snapshot API에 fresh manifest refresh가 없고 빈 loaded boot 처리·full namespace 의미론이 아직 없다는 점이다. lazy·full contract 항목이고, 전체 manifest가 다 맞다고 주장하지 않는다.
- 앞선 3페이지 v1(`49c21e2`)·9페이지 v2(`e208980`) raw는 보존한다. metadata·runtime harness가 달라 같은 파일로 재생산되지는 않는다.
- 재현은 `node benchmarks/thin-layer/ssr-production-probe.mjs --host-matrix --missing-target --out benchmarks/results/thin-layer-ssr-production-missing-pair-fix-2026-10-11.json`이다.
- `b809e08`에서 metadata의 case 수 hardcode를 실제 관측값으로 고쳤다. 현재 파일은 `caseCount` 12·`missingTargetCases` 3을 기록하고, 재실행도 같은 12케이스 전부 PASS다. 코드 지문도 함께 갱신했다.
