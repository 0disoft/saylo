# 재귀 개선 감사 — goal-objective.md 고려사항 전량 매핑 (2026-10-11, 진행 중)

**진행 중 감사이며 최종 완료 판정이 아니다.** 범위는 Saylo 5패키지와 소비 예제·저장소 도구다. 원본 정적 기준은 c92515d이며, 후속 구현·실행 검증은 각 행의 근거와 [실행 검증 기록](recursive-improvement-evidence-2026-10-11.ko.md)에 누적한다. 목표 파일 3~74행의 고려사항 72개를 그대로 매핑한다. 표의 적용·부분 판정은 적힌 범위의 증거이며 전체 목표 완료나 npm 게시를 뜻하지 않는다.

판정: 적용=제공 경로 있음 / 부분=계층 일부만 / 보완=저장소가 고칠 수 있음 / 비적용=경계 밖. 경계: L0 Saylo(5패키지), L1 소비 앱, L2 저장소·릴리스. 근거는 좁게 읽은 소스·문서이고, 실행 검증은 아래 실행검증 완료에 적은 범위뿐이며 나머지는 이번 감사에서 다시 돌리지 않았다.

## 공통 책임 경계와 비적용 이유

L0는 카탈로그 parse·validate·불변 snapshot·어댑터·타입 생성·Vite dev 연결만 소유한다(`docs/07` 제품 형태, `package.json` workspaces). 서버·계정·조직·DB·과금·운영 콘솔이 없으므로 SaaS 계열 14개(14,16,22,29,30,31,32,33,36,37,38,40,41,42)는 소비 제품 담당이다. 나머지 5개(46,48,64,67,71)는 운영·인프라 계열이고 데이터 저장소·운영자 부재에서 나온다. 저장소는 `gh` 기준 PRIVATE이고 npm 5패키지는 public이므로, 공개 사용자 첫 접점은 npm 설치이며 clone·GitHub 링크 접근을 전제하지 않는다. visibility 변경은 이번 scope에서 실행하지 않는다.

## 매핑 (goal-objective.md 3~74행)

원문은 각 줄 전체를 그대로 옮겼다. 경로는 저장소 루트 기준이다.

| 줄 | 고려사항(원문) | 판정 | 근거 · 다음 검증 |
| --- | --- | --- | --- |
| 3 | 사용자 목적 달성 — "사용자가 이 프로젝트를 켜서 원하는 결과를 얻기까지 직접 따라가 보고, 중간에 막히는 부분을 찾아줄래?" | 부분(L0+L1) | npm 예제 첫사용·오류복구는 `1336aa5`+`review/npm-demo-error-recovery-2026-10-11.json`, 렌더 오류 복구는 `8febdda`+`review/npm-demo-render-error-recovery-2026-10-11.json`으로 실행검증완료. 시작 문서 경로는 `verify:starter`와 실브라우저로 확인(근거 `review/getting-started-acceptance-2026-10-11.json`). vanilla·React는 상태 표시·복구까지 실브라우저 확인(`c92515d`, `review/dev-sync-ui-acceptance-2026-10-11.json`). Svelte·SvelteKit도 실제 연결 실패·복구를 확인했다(별도 실행 기록). 다음: 프레임워크별 첫사용 안내. |
| 4 | 미완성 기능 찾기 — "겉으로는 완성돼 보이지만 실제로는 임시 데이터, 빈 구현, 수동 작업에 기대고 있는 부분이 있어?" | 보완(L0) | `docs/53`가 게시·부분·남음을 구분, `docs/06` 로케일 large 안정성, `docs/07` 미해결. 다음: 실행 재확인. |
| 5 | 기능 사이 연결 — "각 기능은 작동하는데 함께 사용할 때 끊기는 흐름이 있는지 확인해줄래?" | 부분(L0+L1) | `core/catalog.ts`→`vite/catalog-patch.ts`→`vite/client.ts`→`react|svelte/index.ts`. eager·lazy 분리(`client.ts`/`lazy-connection.ts`). 다음: 조합 실행. |
| 6 | 첫 사용 경험 — "처음 온 사람이 설명을 따로 듣지 않고 첫 번째 성과를 얻을 수 있도록 무엇을 바꾸면 좋을까?" | 부분(L0) | vanilla·React·Svelte·SvelteKit 시작 안내가 있다. public npm만으로 독립 설치한 문서를 실제 Chromium dev·production에서 확인했다(각 `review/*starter-acceptance-2026-10-11.json`). Svelte는 TypeScript 6 peer 호환, SvelteKit은 요청별 SSR·hydration·Node 운영 서버까지 확인했다. PRIVATE 저장소 밖의 문서 전달 경로는 남아 있다. |
| 7 | 빈 화면과 예외 상황 — "데이터가 없거나, 결과를 찾지 못하거나, 작업에 실패했을 때도 다음 행동을 알 수 있게 돼 있어?" | 부분(L0+L1) | `docs/01` 원칙4·quarantine와 `LiveDiagnostic.operation`으로 실패를 구분한다. npm 예제의 키 삭제 복구는 `review/npm-demo-render-error-recovery-2026-10-11.json`을 따른다. React·Svelte·SvelteKit 저장소 예제와 독립 시작 안내도 빈 카탈로그·키 삭제·복원 중 입력·모달을 유지하고 수정 안내를 표시한다(`review/react-render-recovery-2026-10-11.json`·`review/svelte-render-recovery-2026-10-11.json`·`review/sveltekit-render-recovery-2026-10-11.json`·세 starter-render-recovery 기록). 최신 SvelteKit 시작 안내는 dev 15단계·빈 첫 실행 3단계·운영 미리보기 4단계와 빈 SSR/boot 8요청을 통과했다. 전체 기준 파일이 없어 서버를 시작할 수 없는 조건은 플러그인 진단부터 해결한다. 다음: 안내의 공개 전달. |
| 8 | 입력 실수 대응 — "사용자가 잘못 입력했을 때 문제를 정확히 알려주고, 이미 입력한 내용을 살려서 고칠 수 있어?" | 적용(L0) | `core/translation-errors.ts`·`loading-errors.ts` 6종, `diagnostics.ts` 위치 계산. 폼 UI는 L1. typegen CLI는 .d.ts·BCP47 옵션을 디스크 읽기 전에 검사하고 사용 오류에서 --help 힌트와 exit1을 준다. 도움말은 파일 IO 없이 exit0이다. 기존 선언·JSON 보존과 독립 tarball -h를 확인했다(`review/typegen-cli-acceptance-2026-10-12.json`, typegen11검사 통과). |
| 9 | 작업 중단과 복귀 — "새로고침하거나 앱을 닫았다 돌아와도 진행하던 작업을 이어갈 수 있어야 할 부분은 어디야?" | 부분(L1+L2) | npm 예제가 cached pagehide에서 핸들러를 제거하는 문제를 운영 번들+jsdom으로 재현·수정했다. `verify:demo:npm` 수명 회귀 2개 통과, 근거 `review/npm-demo-history-lifecycle-2026-10-11.json`. React도 생산 ESM 번들에서 cached 이탈 시 root 해제를 재현·수정하고 `verify:demo:react`로 반복 복귀·입력·모달·진단 자료·lazy 언어 로딩·최종 해제를 확인했다(`review/react-demo-history-lifecycle-2026-10-11.json`). 실제 브라우저는 캐시를 쓰지 않아 새로 로드됐다. 실제 BFCache 채택은 미검증. 재시작·새로고침 뒤 초안 저장은 소비 앱 책임이다. |
| 10 | 취소와 되돌리기 — "실수하기 쉬운 행동 중 취소하거나 되돌릴 수 없어 곤란해지는 부분을 찾아줄래?" | 부분(L0) | `client.ts` idempotent disposer, `store.dispose()`, typegen `generator.ts` 취소·race. 다음: late 응답 폐기 실행. |
| 11 | 중복과 동시 작업 — "버튼을 두 번 누르거나 여러 창과 여러 사용자가 동시에 작업하면 결과가 꼬이는 부분이 있어?" | 적용(L0) | `client.ts` bindings WeakMap 단일 binding, `vite/types.ts` requestId·generation. 다중 사용자 없음(14행). 다음: 동시요청 실행. |
| 12 | 느린 응답과 연결 끊김 — "네트워크나 외부 서비스가 느려지거나 끊겼을 때 사용자가 기다림, 재시도, 실패를 구분할 수 있어?" | 부분(L0+L1) | `client.ts` timeout 5000ms·3회, RangeError, SupersededRequestError, CatalogLoadError. 이제 `onSyncState`가 재시도·최종 실패를 신호한다(`connecting`·`retrying`·`failed`와 `attempt`/`maxAttempts`, `b534b4f`, 계약 `docs/dev-sync-state.md`). 표시 구분은 L1. vanilla·React는 실제 Vite 응답 차단으로 `connecting` 1/3, `retrying`(Vanilla 3/3, React 2/3), `failed` 3/3을 표시하고 응답 복구 뒤 정상 연결로 돌아오며 이름·확인 메모·모달·포커스가 유지됐다(`c92515d`, `review/dev-sync-ui-acceptance-2026-10-11.json`). npm 예제의 서버 정지 표시는 그대로다(`5db3517`, `review/npm-demo-connection-status-2026-10-11.json`). Svelte·SvelteKit에도 같은 표시와 모달 안내를 적용하고 실제 실패·복구 중 입력·모달·포커스 유지를 확인했다(`review/dev-sync-ui-svelte-2026-10-11.json`·`review/dev-sync-ui-sveltekit-2026-10-11.json`). 서버 재시작 뒤 초안 복원은 별도 소비 앱 책임이다. |
| 13 | 데이터 정확성 — "저장된 값과 화면에 보이는 값이 어긋나거나, 계산·날짜·단위 때문에 잘못된 결과가 나올 수 있는 곳이 있어?" | 적용(L0) | `docs/07` timeZone 고정·불일치 생성 오류, `vite/types.ts` getCanonicalLocales, `core/schema.ts` fingerprint, `docs/63`·`64`. |
| 14 | 권한 경계 — "다른 사용자나 다른 조직의 정보를 보거나 바꾸는 일이 가능한지, 실제 접근 경로를 기준으로 확인해줄래?" | 비적용(L1+L2) | 계정·조직·API·DB 없음. 실제 경계는 npm OIDC 게시·git push. repo PRIVATE, visibility 변경은 scope 밖. |
| 15 | 민감한 정보 처리 — "비밀번호, 토큰, 개인정보가 화면·로그·오류 메시지·저장소에 불필요하게 남는 곳이 있어?" | 부분(L0+L2) | 런타임 자격증명 없음, `verify-oidc.mjs` 토큰 미저장, `.release/` gitignore, 진단은 키·위치만. L1 로그는 미통제. |
| 16 | 데이터의 전체 수명 — "사용자가 데이터를 가져오고, 내보내고, 삭제하고, 탈퇴하는 과정까지 필요한 기능이 갖춰져 있어?" | 비적용(L1) | 데이터는 소비 앱 로케일 JSON. 추가·수정·삭제 수렴·tombstone만 지원(`vite/catalog-registry.ts`). JSON이 교환 형식(35행). |
| 17 | 접근성 — "키보드만 사용하거나 화면을 확대하거나 보조 기술을 쓰는 사람도 핵심 작업을 끝낼 수 있어?" | 부분(L0+L1) | 키보드·lang·페이지 확대2·3배는 분리 기록과 `review/page-magnification-acceptance-2026-10-11.json` 참조(4배 요청은3배만 적용). 안내·placeholder·입력 테두리·포커스 대비7쌍을 개선하고 실브라우저 색·키보드 모달을 확인했다(`review/contrast-acceptance-2026-10-11.json`). Chromium+axe 20상태(5예제·ko/en·모달)에서 npm 닫기 대비4.46을 재현해6.30으로 고쳤고, 최종 위반·incomplete0이다(`review/demo-accessibility-acceptance-2026-10-12.json`). React·Svelte 예제의 IAB 키보드 입력으로 언어 선택·폼·모달·Escape 복귀·진단 생성/초기화와 값 보존도 확인했다(`review/react-keyboard-flow-acceptance-2026-10-12.json`·`review/svelte-keyboard-flow-acceptance-2026-10-12.json`). Chromium 일반 페이지 확대100/200/400%의 60상태에서 reflow·입력·모달 조작을 확인했다(`review/demo-page-zoom-acceptance-2026-10-12.json`). 원래 대비 incomplete7상태는 후속 검사에서 400% 스크롤 가림5건과, 샘플 가림이 없고 대비13.69:1이지만 axe incomplete가 남은 npm 한국어 제목2건으로 구분했다(`review/demo-contrast-review-acceptance-2026-10-12.json`). 픽셀/AT 검증을 대신하지 않는다. OS 글자 확대·실제 AT·전체 포커스 순환은 남음. |
| 18 | 실제 사용 환경 — "작은 화면, 긴 텍스트, 다른 언어, 낮은 사양처럼 실제 사용에서 흔한 조건에서도 화면과 기능이 유지돼?" | 부분(L0+L1) | 긴 무공백 번역이 320 CSS px에서 페이지 폭을 3,074px로 늘리는 것을 재현하고 예제 CSS를 수정했다. 같은 문구에서 폭 303px, 1,120px에서는 1,103px이며 모달도 가로 넘침이 없다(`review/narrow-layout-acceptance-2026-10-11.json`). React·Svelte 공유 CSS와 SvelteKit 사본에 반영했다. 긴 문구 검증은 vanilla 한정이다. 다섯 예제의 일반 페이지 확대에서는 CSS 폭1262→631→315px와 가로 넘침0을 확인했다(`review/demo-page-zoom-acceptance-2026-10-12.json`). 모달 대비 후속은 5건의 스크롤 복귀와 2건의 샘플 가림 없음·계산 대비를 확인했다. npm 제목의 axe incomplete2건·저사양·다른 브라우저는 남음. |
| 19 | 성능 병목 — "사용자가 가장 자주 하는 작업 중 느린 부분을 측정하고, 효과가 큰 개선부터 골라줄래?" | 적용(L0) | `npm run bench:live`, `benchmarks/results/`, 목표 `docs/06`(100ms/250ms), 최신 `docs/75`. 로컬 warmed 한정. 다음: 재측정. |
| 20 | 운영 비용 — "사용량이 늘 때 서버·외부 API·저장 공간 비용을 크게 늘리는 구조가 어디고, 먼저 줄일 수 있는 낭비는 뭐야?" | 부분(L0+L2) | 서버·API·스토리지 비용 없음. 실체는 런타임(`docs/73`·`docs/65` parser 제거)과 CI(`release.yml`). CI run 38088660390 jobs 합계 ~81초, `npm ci` 3초. 다음: 자동화 확장 전 효용 측정. |
| 21 | 문제 발견과 추적 — "사용자가 오류를 신고하면 어떤 작업에서 왜 실패했는지 운영자가 찾을 수 있어?" | 부분(L0+L1) | `LiveDiagnostic`의 오류 코드·좌표·작업 종류를 `createSupportRecorder`가 축약해 최근 32이벤트 자료로 만든다(`d7097dc`, `review/support-report-api-2026-10-11.json`). vanilla 실브라우저에서 실패·복구와 합성 ICU 오류·입력값 제외를 확인했다(`review/support-report-ui-2026-10-11.json`). 원문 오류와 request ID는 자료에서 제외하므로 원인 재현은 합성 입력·작업 절차를 함께 제공한다. 서버 로그 상관 규약은 남음(63행). |
| 22 | 운영자의 일상 업무 — "문의 처리, 잘못된 데이터 수정, 계정 관리처럼 운영에 필요한 일을 매번 개발자에게 부탁해야 하는 부분이 있어?" | 비적용(L1+L2) | 운영자·문의·계정 개념 없음. 유지보수 운영은 `docs/09` 절차·이슈 트래커가 담당. |
| 23 | 장애 복구 — "서비스가 멈추거나 데이터가 손상됐을 때 복구 방법이 준비돼 있고, 실제로 복구 가능한지도 확인할 수 있어?" | 부분(L0+L2) | last-good 유지(`docs/01` 원칙4), resync(`docs/04`), 게시 실패 시 새 패치 정책·SHA-512 대조(`docs/09`, `scripts/registry-release.mjs`). 다음: 복구 리허설. |
| 24 | 설치·업데이트·배포 — "새 환경에서 실행하고 새 버전으로 바꾸는 과정에 빠진 설정이나 수동 단계가 있고, 실패하면 이전 상태로 돌아갈 수 있어?" | 적용(L2) | `docs/09-release.md` runbook, `scripts/release-*.mjs`·`verify-oidc.mjs`·`pack-smoke.mjs`, `release.yml`, `verify:registry:alpha4`. 게시는 비원자적. 다음: 실행. |
| 25 | 사용자에게 한 약속 — "소개 문구, 도움말, 요금제 설명이 현재 기능과 일치하는지 확인하고, 과장되거나 빠진 내용을 찾아줄래?" | 부분(L2) | `docs/README.md` 우선순위 규칙, `docs/06` "실행하지 않은 검사는 pass 아님", `docs/77` 미게시 코드 구분. repo PRIVATE·npm public 접점 주의. 다음: 링크·예제 자동검사(74행). |
| 26 | 다음 작업의 우선순위 — "지금까지 확인한 문제와 사용자 의견을 기준으로, 다음에 할 일 세 가지와 당분간 하지 않을 일을 이유와 함께 골라줄래?" | 적용(L0+L2) | `docs/06` 로드맵, `docs/07` 미해결. 이 감사 6절 Top3·제외. |
| 27 | 첫 실행 안내 — "처음 사용하는 사람이 설정부터 첫 작업 완료까지 따라갈 수 있는 시작 안내를 만들까?" | 부분(L0) | 네 시작 안내를 루트·docs README에서 연결하고 public npm만으로 독립 설치·실행을 검증한다. 최신 언어 영역·키 삭제·빈 카탈로그·입력 복구는 `review/npm-starter-language-regions-2026-10-11.json`·`review/framework-starter-language-regions-2026-10-11.json`을 따른다(React8·Svelte10·SvelteKit19파일). SvelteKit SSR·공유 layout·Node 서버와 로컬 Vite tarball의 문서13파일·설치 내용·내부 파일 링크도 확인했다. registry 공개 전달과 나머지 활용 안내의 충분성은 남음. |
| 28 | 체험 공간 — "설치나 가입 전에 핵심 기능을 써볼 수 있는 데모와 샘플 데이터를 추가할까?" | 부분(L0) | 호스팅 데모 없음. 실제 체험 접점은 npm 설치 후 예제 5종(`examples/*`)과 `scripts/pack-smoke.mjs` 독립 설치 검증(`docs/77`). |
| 29 | 작업 템플릿 — "자주 하는 작업을 빈 화면부터 시작하지 않도록 기본 템플릿과 예제를 제공할까?" | 비적용(L1) | "작업" 도메인 없음. 대안은 예제 카탈로그(`examples/*/locales/`)·pack fixture·typegen `.d.ts`. 소비 제품 담당. |
| 30 | 통합 검색 — "프로젝트 안의 데이터, 기능, 설정을 한곳에서 찾아 바로 이동하는 검색을 만들까?" | 비적용(L1) | 프로젝트·설정 화면 없음. 인접 실체는 typegen 타입과 키·namespace 오류 메시지(`core/translation-errors.ts`)뿐. |
| 31 | 일괄 처리 — "여러 항목을 선택해 수정·이동·내보내기 같은 반복 작업을 한 번에 처리하게 할까?" | 비적용(L1) | 선택·수정 UI 없음. 파일 일괄 처리는 편집기·스크립트 몫이고 Saylo는 watch로 수렴. typegen이 로케일 디렉터리 일괄 처리(`typegen/catalog-files.ts`). |
| 32 | 자동 저장과 이어하기 — "작업을 자동으로 저장하고, 다음에 돌아왔을 때 중단한 지점부터 이어가는 기능을 넣을까?" | 비적용(L1) | 편집 세션·초안 없음. 저장 주체는 에디터. `client.ts` 재연결은 화면 복원이 아님(9행). |
| 33 | 변경 이력과 되돌리기 — "무엇이 바뀌었는지 비교하고 원하는 시점으로 되돌리는 기능을 구축할까?" | 비적용(L1) | 사용자향 이력 없음. 내부 registry revision·catalogVersion(`docs/01`·`docs/08`)은 전송용. 이력은 git·에디터 담당. |
| 34 | 실행 전 미리보기 — "큰 변경을 적용하기 전에 예상 결과와 영향 범위를 보여주는 미리보기를 추가할까?" | 부분(L0) | 적용 전 검증: `requireCompleteTranslations`(`vite/complete-translations.ts`, `docs/42`), quarantine 진단, typegen 선행. diff dry run UI는 없음. |
| 35 | 가져오기와 내보내기 — "사용자가 기존 데이터를 가져오고 작업 결과를 다른 도구에서 쓸 수 있도록 파일 입출력을 만들까?" | 적용(L0) | 열린 JSON 형식 `<localesDir>/<locale>/<namespace>.json`, `typegen/cli.ts` 파일→`.d.ts`. 외부 형식 변환기는 없음(미검증). |
| 36 | 공유와 공동 작업 — "작업 결과를 링크로 공유하고, 다른 사람과 함께 수정하거나 의견을 남길 수 있게 할까?" | 비적용(L1) | 링크·공동편집·댓글 없음. 협업은 git PR. 서버 저장소 없음. |
| 37 | 개인별 작업 공간 — "자주 쓰는 기능, 저장한 조건, 화면 배치를 개인별로 설정하고 다시 불러오게 할까?" | 비적용(L1) | 계정·워크스페이스 없음. 인접 옵션은 `createI18n`·`createStore`의 locale·timeZone·namespace뿐. |
| 38 | 알림과 작업함 — "처리가 끝났거나 사용자의 행동이 필요할 때 알려주고, 할 일을 모아 보여주는 작업함을 만들까?" | 비적용(L1) | 작업함 없음. typegen worker는 로그·파일만(`typegen/worker.ts`). 알림면은 Vite dev 콘솔 경고. |
| 39 | 반복 작업 자동화 — "사용자가 여러 단계를 묶어 저장하고, 정해진 시간이나 조건에 따라 자동 실행하게 할까?" | 부분(L0+L1) | 저장→watch→parse→patch 파이프라인(`vite/index.ts`)은 자동. 스케줄러·워크플로 빌더 없음. |
| 40 | 역할과 권한 관리 — "관리자·편집자·조회자처럼 역할을 나누고, 팀이나 조직별로 접근 권한을 관리하게 할까?" | 비적용(L1+L2) | 역할 모델 없음(14행). 저장소 쪽은 npm 게시 권한·GitHub environment(npm-release). |
| 41 | 검토와 승인 흐름 — "중요한 변경을 초안 작성, 검토, 승인, 반영 단계로 처리하는 기능을 추가할까?" | 비적용(L1+L2) | 제품 승인 워크플로 없음. 릴리스는 수동 dispatch·`publish` 기본 false·Trusted Publisher(`docs/09`). |
| 42 | 운영자 관리 화면 — "계정, 데이터, 작업 상태를 운영자가 직접 관리할 수 있는 관리 화면을 구축할까?" | 비적용(L1) | 관리 화면 없음. 운영 접점은 Vite dev 콘솔·CLI 로그뿐. |
| 43 | 문의용 진단 자료 — "사용자가 문제를 겪으면 민감한 정보를 제외한 실행 환경과 오류 기록을 한 번에 모아 보내게 할까?" | 부분(L0+L1) | `createSupportReport`·`createSupportRecorder`와 `docs/support-report.md`로 환경 버전·오류 코드·위치·연결 상태를 허용 목록 자료로 제공한다. vanilla 생성·검토·초기화 UI와 실브라우저 검사, 독립 JS/TS tarball 검사 완료(`d7097dc`, `review/support-report-api-2026-10-11.json`·`review/support-report-ui-2026-10-11.json`). 원문·파일명·키·request ID 제외, 최근32이벤트/각64행 제한. 환경값은 caller 제공이고 React·Svelte·SvelteKit 생성·검토·초기화와 실브라우저 검증도 완료(분리 실행 기록). 문의 안내와 메타데이터는 로컬 준비 완료(45행), 실제 제출·수신은 미확인. 자동 제출 없음. |
| 44 | 제품 안의 도움말 — "사용 중인 기능 옆에서 설명과 예제를 보고 바로 따라 할 수 있는 도움말을 추가할까?" | 부분(L0) | 문서형은 `packages/*/README.md`·`docs/03`·`docs/08`. 인라인 도움말 없음. JSDoc·타입 힌트가 일부 대체. |
| 45 | 의견 수집 창구 — "불편 신고와 기능 제안을 제품 안에서 받고, 처리 상태도 사용자에게 보여줄까?" | 부분(L2) | `SUPPORT.md`·`SECURITY.md`와 다섯 README에 공개 프로필 연락처를 연결하고 `bugs.email`로 교체했다. npm CLI가 메일 주소와 공개 npm homepage를 출력하는지 다섯 패키지에서 확인했다. Vite 문서 15파일의 tarball 독립 설치 검증도 통과했다(`review/public-reporting-destination-acceptance-2026-10-11.json`). 로컬 미게시이며 메일 수신·처리 상태 UI는 미확인. CONTRIBUTING·CODE_OF_CONDUCT는 별도다.
| 46 | 사용 현황 대시보드 — "어떤 기능이 쓰이고 어디서 사용을 포기하는지 볼 수 있도록 필요한 지표를 수집하고 보여줄까?" | 비적용(L1) | 텔레메트리 없음. 대체 지표는 npm 다운로드·CI 테스트 수. 계측은 프라이버시·번들 비용. |
| 47 | 오래 걸리는 작업 관리 — "시간이 걸리는 작업을 백그라운드에서 실행하고, 진행률·취소·재시도를 제공하는 작업 큐를 만들까?" | 부분(L0+L1) | typegen worker·generation 취소·race(`typegen/worker.ts`, `generator-race.test.mjs`). 진행률·재시도 큐 없음. 다음: 대형 카탈로그 관측. |
| 48 | 백업과 복원 — "데이터를 자동으로 백업하고, 사용자가 필요한 백업을 골라 복원하는 기능을 구축할까?" | 비적용(L1+L2) | 백업 대상 저장소 없음. 카탈로그는 소비 앱 git. 인접: CI artifact 7일·`releases/*.json` 승인 기록. |
| 49 | 외부 서비스 연동 — "다른 도구와 데이터를 주고받도록 API와 웹훅을 제공하고, 자주 쓰는 서비스의 연동 기능을 추가할까?" | 부분(L0) | 교환면은 JSON·typegen CLI·공개 타입·subpath(`saylo-core/runtime`, `saylo-vite/client`). 웹훅·REST·외부 i18n 플랫폼 커넥터 없음. |
| 50 | 확장 기능 구조 — "새 기능을 본체에 계속 붙이지 않아도 되도록 플러그인이나 확장 모듈을 연결하는 구조를 만들까?" | 적용(L0) | 코어 프레임워크 중립(`docs/01` 원칙2), 어댑터 분리(`packages/react`·`svelte`), Node 전용 `vite`·`typegen`, `exports` subpath. Vue는 후속(`docs/07`). |
| 51 | 재현 가능한 개발 환경 — "새 컴퓨터에서도 같은 환경으로 개발을 시작할 수 있도록 도구 설치, 버전 관리, 초기 설정을 자동화할까?" | 부분(L2) | `engines.node` 24.x, `package-lock.json`, workspaces, `docs/09` 검증 버전. 시작 문서 기준 클린 설치는 `verify:starter`가 저장소 밖 임시 폴더에서 공개 npm alpha.4·Vite 8.3.4 설치로 확인했다. `.nvmrc`·`devcontainer`·도구 자동설치 없음. 다음: 나머지 예제 클린 재현. |
| 52 | 공통 개발 명령 — "실행·빌드·검증·정리를 일관된 명령으로 묶어, 개발자마다 다른 절차를 쓰지 않도록 할까?" | 적용(L2) | `package.json` scripts(`build`·`test`·`check`·`verify:*`·`release:*`), `docs/06` 빌드 순서(typegen→tsc→vite build). |
| 53 | 모듈 경계와 의존 규칙 — "각 모듈의 책임과 의존 방향을 정하고, 경계를 넘는 코드가 들어오면 자동으로 알려주는 기반을 만들까?" | 적용(L0+L2) | `verify:boundaries`가 다섯 패키지 의존 방향·선언·공개 exports·상대 경로 우회와 브라우저 실행 경로의 Node builtin을 AST로 검사한다. 54소스·240참조·36브라우저 파일에서 0위반, 회귀7건·전체 check 통과. 임시 node:fs 주입 시 CLI exit1을 확인하고 원본 복원했다(`review/package-boundaries-acceptance-2026-10-12.json`). 기존 릴리스 check에 연결했고 새 CI job 없음. 외부 node_modules·생성 virtual 문자열·eval은 별도 bundle/pack 검증 범위다.
| 54 | 설계 결정 기록 — "중요한 설계의 선택 이유와 포기한 대안을 남겨, 다음 개발자도 판단을 이어갈 수 있는 기록 체계를 만들까?" | 적용(L0) | `docs/07-decisions.md`, `docs/76` 결정·재검토 조건, 원복 기록(`docs/33`·`37`·`40`·`41`), `docs/README.md` 상태 표기. |
| 55 | 인터페이스 계약 — "API와 모듈 사이의 입출력을 명세로 관리하고, 타입·문서·호환성 검증이 함께 따라오는 구조를 구축할까?" | 적용(L0+L2) | typegen `.d.ts` + 소비 fixture(`packages/*/test/consumer.ts`)·`pack-smoke.mjs`, wire 계약 `docs/08`, `release-check.mjs` 내부 의존 정확 일치. |
| 56 | 설정과 비밀정보 관리 — "환경별 설정을 검증하고 비밀정보를 안전하게 주입하도록, 설정 로딩과 배포 방식을 통일할까?" | 부분(L0+L2) | `SayloViteOptions` 검증(`vite/types.ts`), requestTimeoutMs RangeError, timeZone 불일치 생성 오류(`docs/07`), 게시 비밀은 OIDC. L1 환경별 설정은 미검증. |
| 57 | 개발용 데이터 기반 — "대표적인 정상·오류·경계 상황을 재현하는 샘플 데이터와 초기화 도구를 만들어 개발 시간을 줄일까?" | 적용(L0+L2) | 정상 `examples/*/locales`, 오류·경계 케이스(`core/test`·`vite/test/patch.test.mjs`·`plugin.test.mjs`), 완역 fixture, 벤치 fixture, `setup:sveltekit`. |
| 58 | 핵심 회귀 검증 기반 — "핵심 동작을 빠르게 검증하고, 발견한 버그를 재현 사례로 남길 수 있는 테스트 구조를 구축할까?" | 적용(L0+L2) | `packages/*/test` node:test, `npm test`·`check`, CI alpha.4 229 tests(`README.md`), 실패 재현 관례(`docs/59`~`62`·`docs/74`), npm 예제 `verify:demo:npm`(생산 bundle jsdom 3개, `8febdda` 추가 사례 포함), 시작 문서 `verify:starter`. 다음: 실행. |
| 59 | 변경 범위에 맞춘 CI — "바뀐 영역에 필요한 검증만 실행하고 캐시를 재사용하도록, CI 시간과 비용을 줄이는 기반을 만들까?" | 부분(L2) | `release.yml`은 workflow_dispatch 전용 단일 job이고 docs push 자동 CI가 없다. run 38088660390 jobs 합계 ~81초·`npm ci` 3초, all-5 게시는 whole pack/check가 필요하다. cache off·paths 부재를 그 자체 결함으로 보지 않는다. 다음: 필요성·효용 측정. |
| 60 | 의존성 업데이트 체계 — "같은 메이저 버전의 안정 업데이트는 자동으로 따라가고, 새 메이저 버전은 호환성 검증 후 올리는 체계를 만들까?" | 부분(L2) | 추적된 `renovate.json`이 npm minor/patch의 범위 내 lock 갱신을 월간 PR로 묶고 major를 승인 대기로 둔다. 자동 merge 없음, Saylo 동시 릴리스 버전은 자동 변경 제외. 공식 JSON schema valid(봇 semantic/원격 활성화 미검증). 패치 갱신은 ea69df3이며 루트 check·npm 예제·SvelteKit SSR 검증 통과(`review/dependency-refresh-acceptance-2026-10-12.json`, `review/dependency-policy-acceptance-2026-10-12.json`). Node24.x·Kit TS6 유지. 상속 강제 정책과 실제 대시보드 적용은 남음.
| 61 | 코드 품질 자동화 — "포맷·정적 분석·금지 패턴·파일 크기 기준을 자동으로 적용해 리뷰에서 반복하는 지적을 줄일까?" | 부분(L0+L2) | TypeScript·소비 타입·핵심 단위 검사와 AST 패키지 경계 검사가 있다(`verify:boundaries`). 40KB는 리팩토링 후보 기준이며 일괄 실패 게이트가 아니다. 초과 test·bench 문서는 가독성 개선 후보로 두고 실제 사용자 막힘부터 고친다. |
| 62 | 공통 오류 처리 — "오류 분류, 사용자 메시지, 원인 기록, 재시도 가능 여부를 일관되게 다루는 기반을 구축할까?" | 적용(L0) | 6개 오류 클래스(`translation-errors.ts`·`loading-errors.ts`), CatalogDiagnostic+SourcePosition, 3회 재시도·supersede·last-good, CatalogError 메시지 형식. `onSyncState`가 재시도·최종 실패를 상태로 노출한다(`b534b4f`). retryable 필드는 없음. |
| 63 | 구조화된 로그 — "요청과 작업에 식별자를 붙이고 로그 형식을 통일해, 여러 구성요소를 거친 문제도 추적할 수 있게 할까?" | 보완(L0) | wire 식별자(requestId·generation·sessionId·revision, `vite/types.ts`)는 있으나 로그 형식·레벨 규약이 없고 `vite/index.ts` logger.warn 3곳뿐. 다음: 진단에 request id 상시 포함. |
| 64 | 관측과 알림 기반 — "지연·실패율·자원 사용량을 수집하고, 운영자가 대응해야 할 상황을 알려주는 대시보드와 알림을 구축할까?" | 비적용(L1) | 메트릭·대시보드·알림 없음(22행). 개발자용 기록은 `benchmarks/results/`를 사람이 읽는 수준. |
| 65 | 외부 장애 대응 정책 — "타임아웃·재시도·호출 제한·장애 전파 차단을 공통으로 제공해, 외부 서비스 장애를 일관되게 처리할까?" | 부분(L0) | 공통 정책은 Vite dev 연결 한정(timeout·3회·supersede·last-good·CatalogLoadError)이고 그 상태를 `onSyncState`로 노출한다(`b534b4f`). 운영 외부 호출은 L1 CatalogSource가 하고 재시도 정책은 미강제. |
| 66 | 데이터 변경과 마이그레이션 — "스키마와 데이터 변경을 버전으로 관리하고, 중단 후 재개와 실패 시 복구를 지원하는 기반을 만들까?" | 부분(L0) | namespaceSchemaFingerprint(`core/schema.ts`), catalogVersion·tombstone(`vite/catalog-registry.ts`), quarantine(`translation-quarantine.ts`), gap 복구(`docs/08`). 마이그레이션 도구는 없음. |
| 67 | 인프라를 코드로 관리 — "서버·네트워크·저장소·권한 설정을 코드로 선언해, 환경을 재구축하고 변경 이력을 추적할 수 있게 할까?" | 비적용(L2) | 관리할 서버·네트워크 없음. 유일한 선언은 `release.yml`이고 Trusted Publisher 등록값은 `docs/09` 표 기록(코드 재현 불가). |
| 68 | 배포 전 검증 환경 — "운영 환경의 주요 조건을 재현하는 검증 환경을 만들고, 필요한 변경은 임시 환경에서 확인할 수 있게 할까?" | 부분(L2) | staging 없음. `pack-smoke.mjs`(저장소 밖 설치·JS/TS·SSR·lazy), `pack-sveltekit.mjs`(독립 앱+Chromium), 게시 후 `verify:registry:*`. SvelteKit은 게시본 전용 fixture로 alpha.2·3·4와 최신 로컬 예제를 각각 검증했다(`ca3e946`, `review/sveltekit-registry-fixture-2026-10-11.json`). |
| 69 | 릴리스와 롤백 자동화 — "검증된 산출물로 배포하고, 배포 후 상태 확인과 이전 버전 복귀까지 연결하는 릴리스 체계를 구축할까?" | 부분(L2) | 게시는 검증→pack→dry run→OIDC 순서, `publish` 기본 false. 배포 후 확인은 `verify:registry:alpha4` 수동 실행. 복귀는 unpublish 대신 새 패치 정책. 런타임 롤백은 L1. |
| 70 | 기능 활성화 제어 — "배포와 기능 공개를 분리하고, 일부 대상에게 먼저 적용하거나 문제가 생기면 즉시 끌 수 있는 기반을 만들까?" | 부분(L0+L2) | 플래그 `astRuntime`·`requireCompleteTranslations`, dist-tag `alpha`/`next`/`latest` 분리. 원격 플래그·점진 배포·kill switch 없음. |
| 71 | 백업과 복구 자동화 — "백업 생성·보관·복원 검증을 자동화하고, 장애 때 정해진 절차로 복구할 수 있는 기반을 구축할까?" | 비적용(L1+L2) | 백업 대상 데이터 없음(48행). 자동 보관은 CI artifact 7일과 `releases/*.json`. tarball SHA-512 대조가 복원 검증 일부. |
| 72 | 운영 절차의 실행 도구화 — "장애 대응과 정기 관리 절차를 문서와 실행 도구로 함께 만들어, 담당자가 바뀌어도 운영할 수 있게 할까?" | 적용(L2) | `docs/09-release.md` runbook과 `scripts/release-check.mjs`·`release-publish.mjs`·`verify-oidc.mjs`·`registry-release.mjs`. CLI 재현 명령까지 기재. |
| 73 | 보안 검증 파이프라인 — "비밀정보 유출·취약 의존성·위험한 권한 변경을 개발과 배포 과정에서 잡아내는 기반을 구축할까?" | 부분(L2) | OIDC·SHA-512 게시 검증, SECURITY.md와 별개로 `audit:dependencies`를 기존 release job의 npm ci 다음에 연결했다. 루트·npm 예제·SvelteKit의 개발 포함 advisory 조회는 모두 0건. wrapper의 실패 exit코드 전파·allow-scripts 환경 호환 처리를 확인했다(`review/dependency-policy-acceptance-2026-10-12.json`). 로컬 미게시·CI 미실행이며 코드 취약점·비밀 유출·권한 변경 스캔 전체를 수행했다는 뜻이 아니다.
| 74 | 코드와 문서의 동기화 — "API 명세·설정 항목·개발 명령을 실제 코드에서 추출하고, 변경 때 관련 문서도 함께 갱신되는 구조를 만들까?" | 부분(L0+L2) | typegen이 기준 스키마에서 `.d.ts` 추출(`typegen/generator.ts`)하고 fixture가 검증. 나머지는 수동: `docs/README.md` 우선순위 규칙, `docs/06` 사람이 링크·예제 확인. CI 문서 검증 없음. |

## 실행검증 완료

실행 검증 기록은 [실행 검증 기록 파일](recursive-improvement-evidence-2026-10-11.ko.md)로 분리했다. 이 문서에는 판정 매핑과 집계만 남긴다.

## 집계

적용 15 (8,11,13,19,24,26,35,50,52,54,55,57,58,62,72) · 부분 34 (3,5,6,7,9,10,12,15,17,18,20,21,23,25,27,28,34,39,43,44,47,49,51,53,56,59,60,61,65,66,68,69,70,74) · 보완 4 (4,45,63,73) · 비적용 19 (14,16,22,29,30,31,32,33,36,37,38,40,41,42,46,48,64,67,71). 합계 72다. 이전 판의 부분 30·보완 7·비적용 20은 표와 어긋나 바로잡았다. 9행과 61행은 부분이다. 비적용 19개 중 14개는 SaaS 계열이고 5개(46,48,64,67,71)는 운영·인프라 계열이다.

## 미검증 — 이번 감사에서 재실행하지 않음

여기 적은 항목은 이전 실행 결과가 없다는 뜻이 아니라, 이번 감사가 그 명령과 관측을 다시 돌리지 않았다는 뜻이다. 이전 턴의 실행 결과는 분리한 [실행 검증 기록](recursive-improvement-evidence-2026-10-11.ko.md)에 그대로 남아 있다.

이번 감사에서 재실행하지 않은 것: `npm run test`·`build` 전체, `verify:registry:*`, `bench:live` 재계산, `release:check`·`release:pack`(산출물 저장)·`oidc`·dispatch, registry 조회, 시작 문서 밖의 클린 설치 재현. (`check`·`typecheck:consumers`·`verify:pack`은 `b534b4f` 범위에서 돌렸다.) 59·60·73행의 remote 상태(자동 갱신 체계, 취약점 스캔, 이슈 창구 접근성)도 미확인이다.

## 실제 효용 우선 Top 3

1. npm 한국어 제목의 대비 incomplete2상태와 실제 보조 기술 흐름을 확인한다(17·18행). 모달 대비 후속에서 400%의 5건은 스크롤을 위로 올린 뷰의 재검사로 확인했고, npm 2건은 텍스트 샘플의 가림 없음과 계산 대비13.69:1을 확인했지만 원래 axe incomplete를 유지한다(`review/demo-contrast-review-acceptance-2026-10-12.json`). 다섯 예제의 일반 페이지 확대100/200/400%는 임시 Chromium 프로필로 적용해 CSS 폭1262→631→315px·가로 넘침0·입력/모달 조작을 확인했다(`review/demo-page-zoom-acceptance-2026-10-12.json`). axe incomplete는 통과로 보지 않는다. OS 글자 확대·AT 발음·다른 브라우저·저사양은 남아 있다.
2. 다음 승인 릴리스에서 문의·보안 안내와 메타데이터 교체를 공개 전달한다(45·73행). 공개 프로필 이메일을 연결했고 다섯 로컬 패키지의 npm CLI 목적지·tarball 독립 설치를 확인했다(`review/public-reporting-destination-acceptance-2026-10-11.json`). 메일 전송·수신과 registry 갱신은 미검증이며 저장소 visibility는 바꾸지 않았다.
3. 다음 승인 릴리스에서 동봉 문서의 공개 전달을 확인한다(6·27행). `packages/vite` 빌드가 네 시작 안내·다섯 API README·두 계약·문의와 보안 안내를 15파일로 묶고, 실제 tarball의 독립 설치에서 내용·내부 파일 링크를 확인했다(`review/package-docs-acceptance-2026-10-11.json`). 로컬 준비는 끝났지만 public alpha.4에는 없으므로 게시·registry 확인을 완료로 보지 않는다. 버전 승격·푸시·게시는 이번 범위에서 하지 않았다.

완료로 내린 항목: lazy 갱신 observer 오류 처리(7·21·62행). lazy `onUpdate` 예외를 eager와 같은 `observer`로 보고하도록 고쳤고, 최초 `onUpdate`가 던져도 binding·locale 커밋·이후 복구가 유지된다. 수정 전 회귀 2 fail(최초 update view 실패, locale 커밋 뒤 `AggregateError` rejection), 수정 후 `vite build`+lazy/sync-state/client/support-report 49 pass, consumer `tsc` pass다(근거 `review/lazy-update-observer-2026-10-11.json`).

기존 `docs/04`에는 동기화 상태·진단 유지·문의 자료·BFCache 범위와 로컬 미게시 표시를 반영했다. 게시본 SvelteKit은 최신 예제의 미게시 API 때문에 생긴 타입 오류 8건을 재현한 뒤 `ca3e946`의 전용 fixture로 분리했다. alpha.2·3·4 및 최신 로컬 pack 검사가 모두 통과했다. 실행 범위는 분리 기록과 JSON 근거를 따른다.

시작 안내는 vanilla·React·Svelte·SvelteKit 모두 public npm 설치로 실행 근거를 확보했다. React 8파일·Svelte 10파일·SvelteKit 19파일의 최신 검사는 렌더 오류 복구도 포함한다. SvelteKit의 이전 18파일 검증은 당시 입력의 이력이며, 현재 문서는 `review/sveltekit-starter-render-recovery-2026-10-11.json`을 따른다. 문서의 공개 전달 경로와 나머지 활용 안내는 남아 6·27행은 부분으로 유지한다.

## 당분간 제외 항목과 이유

비적용 19개는 실패가 아니라 담당자 경계다. SaaS 계열 14개(14,16,22,29,30,31,32,33,36,37,38,40,41,42)는 서버·계정·조직·DB가 없어 소비 앱이 담당한다. 운영·인프라 5개 중 46·64는 운영 주체와 텔레메트리 부재, 48·71은 소유 데이터 부재, 67은 선언할 인프라가 `release.yml` 하나뿐이라는 이유다. 부분·보완 중 "L1 책임"으로 적은 몫(17,18,20행 등)은 소비 앱이 자기 제품 기준으로 결정한다. 12행의 재시도·최종 실패 UI는 네 예제 실행검증으로 확인해 Top 목록에서 내렸다.

## 이력 출처

goal file(74줄, 3~74행 72개) · `docs/53-completion-audit.md`(2026-10-10 `40bfa5a` 한정 감사(이 문서 판정 아님)) · `docs/09-release.md`·`.github/workflows/release.yml`·CI run 38088660390 · GitHub issue #1 Dependency Dashboard(Renovate 탐지·승인 대기 조회 확인) · `1336aa5`·`c3d4036`·`8febdda`와 `review/npm-demo-error-recovery-2026-10-11.json`·`review/npm-demo-history-lifecycle-2026-10-11.json`·`review/npm-demo-render-error-recovery-2026-10-11.json` · `docs/getting-started.md`·`scripts/verify-getting-started.mjs`·`npm run verify:starter`·`npm run verify:demo:npm`·`review/getting-started-acceptance-2026-10-11.json`(`d424345`) · `review/local-readiness-2026-10-11.json`·`review/remote-state-2026-10-11.json` · `review/npm-demo-connection-status-2026-10-11.json`·`5db3517` · `b534b4f`(동기화 API: `packages/vite/src/dev-sync.ts`·`client.ts`·`lazy-connection.ts`·`catalog-source.ts`)·`packages/vite/test/sync-state.test.mjs`·`docs/dev-sync-state.md`·`packages/vite/README.md`·`review/dev-sync-state-acceptance-2026-10-11.json` · `b8540cb`(계약 문서·기록) · `928377e`(handshake 진단 분리) · `c92515d`(vanilla·React 상태 UI, `review/dev-sync-ui-acceptance-2026-10-11.json`) · HEAD `c92515d`(시작 안내 `d424345`, 연결 종료 표시 `5db3517`).

## 다음 단계

2026-10-12 최신 후보: `7518290`를 동결한 alpha.5 사본에서 입력 983개 대조·전체 261개 테스트·독립 JS/TS 소비·게시 계획 dry run·SvelteKit SSR/Chromium과 모달 이동 포커스를 통과했다. 진단 관측자 예외 격리 회귀 5개와 동봉 계약도 포함한다. SvelteKit 뒤 입력 불변·다섯 tarball 재pack SHA-512 일치·기존 승격 패치 적용 가능 검사를 확인했으며 원본 버전은 alpha.4다(`review/release-alpha5-diagnostic-candidate-acceptance-2026-10-12.json`). 원격 CI/OIDC·실제 게시·registry 인수·실제 AT와 npm 제목 대비 incomplete2건은 계속 남아 있다.

2026-10-12 진단 관측자 후속: onDiagnostic의 동기 예외가 eager 초기 binding·커밋 revision 처리와 공유 진단 fan-out을 중단하는 문제, lazy 외부 source의 진단 예외·stop 뒤 예약 콜백을 5회귀 실패로 재현했다. 공통 진단 전달 보호와 lazy binding 검사를 적용해 focused54·Vite 전체125·소비 타입·경계7·다섯 독립 JS/TS tarball을 통과했다(`review/diagnostic-observer-isolation-acceptance-2026-10-12.json`). 콜백 자신의 오류를 재귀 보고하거나 원문을 자동 로그로 남기지 않는다. async Promise rejection·실브라우저 fault 주입은 별도 범위이며, 기존 722e497 후보는 수정 전 이력이라 최종 후보를 다시 동결해야 한다.

2026-10-12 대비 incomplete 후속: 선택형 확대 검사에 진단 보조 모듈을 연결했다. 원래 axe 결과를 보존한 채 텍스트 줄의 기하·아홉 지점 hit-test·불투명 단색 조상 배경 대비를 기록하고, 모달 scrollTop=0의 별도 대비 재검사 뒤 원래 위치를 복원한다. 7상태를 검사해 400% 영어5건은 스크롤 복귀 뒤 visible 샘플·재검사 통과, npm 한국어2건은 visible 샘플·대비13.69:1이나 axe incomplete 유지로 구분했다(`review/demo-contrast-review-acceptance-2026-10-12.json`). 테스트 도구와 설명만 바꿨으며 생산 CSS·모달 동작·게시 상태는 그대로다.

2026-10-12 일반 페이지 확대 후속: 선택형 접근성 명령에 `--zoom 1|2|4`를 추가했다. 새 임시 프로필의 Chromium 기본 페이지 확대를 적용하고 DPR·CSS 폭·visualViewport 배율로 확대가 실제 적용됐는지 검사한다. 다섯 예제×두 언어×모달 닫힘/열림×세 배율의 60상태에서 가로 넘침·입력 보존·모달 초기 포커스·닫기 접근·opener 복귀와 axe 위반0을 확인했다. 대비 incomplete7상태는 남아 별도 확인한다(`review/demo-page-zoom-acceptance-2026-10-12.json`). 생산 코드·새 CI job·게시 상태는 바꾸지 않았다.

2026-10-12 SvelteKit 키보드 후속: 열린 공통 layout 모달에서 링크를 Enter로 실행하면 페이지는 이동하지만 포커스가 body로 빠지는 문제를 재현했다. 모달 안 링크에만 SvelteKit 3의 `data-sveltekit-reset="false"`를 적용하고 시작 안내·alpha.5 소비 fixture를 맞췄다. IAB의 Tab/Enter 입력으로 이동 뒤 링크 포커스·입력 3개·열린 모달 보존과 닫기 뒤 opener 복귀를 확인했다. 독립 설치한 다섯 tarball의 타입·SSR·Chromium 인수에도 `modal-navigation-focus`를 추가해 통과했다(`review/sveltekit-keyboard-navigation-focus-acceptance-2026-10-12.json`). 실제 보조 기술·일반 확대·전체 포커스 순환 검증은 계속 남아 있다.

2026-10-12 이전 후보: `722e497`를 동결한 alpha.5 사본에서 입력 977개 대조·전체 256개 테스트·JS/TS 소비와 SvelteKit SSR/Chromium·모달 이동 포커스 검사를 통과했다. SvelteKit 뒤 입력 불변과 다섯 tarball 재pack integrity도 확인했다. 기존 8파일 버전 승격 패치는 `git apply --check`만 했으며 원본 버전은 alpha.4다(`review/release-alpha5-focus-candidate-acceptance-2026-10-12.json`). 앞선 `b39b3fd` 후보의 이력은 `review/release-alpha5-candidate-refresh-2026-10-12.json`에 남긴다. 로컬 검토 근거를 마련했지만 CI/OIDC·실제 게시·새 registry 인수·보조 기술 실사용은 계속 남아 있다.

2026-10-12 registry 검사 후속: alpha.5 이후에는 문의 진단 API·동기화 상태·동봉 문서·CLI 도움말을 필수로 검사하도록 바꿨다. 고정한 새 SvelteKit 예제는 로컬 tarball의 상태 관측·보고서 생성/초기화와 실제 Chromium 인수를 통과했다. 로컬 독립 JS/TS와 기존 승인 alpha.4 registry 소비도 통과했다(`review/registry-consumer-contract-acceptance-2026-10-12.json`). 앞선 문서 후속의 "새 API를 건너뛰는 경로"는 준비 코드에서 해결했으며, 새 버전의 실제 게시·CI 승인 manifest·registry 인수는 여전히 남아 있다. alpha.5 승인 JSON은 만들어 넣지 않았다.

2026-10-12 문서 후속: alpha.5의 변경 범위와 남은 승격·게시·복귀 절차를 `releases/0.1.0-alpha.5-plan.md`에 정리하고, API 안내를 checkout·후보 tarball·기존 alpha.4로 구분했다. 동봉 15파일과 최신 소스의 독립 JS/TS pack은 통과했다(`review/release-alpha5-documentation-acceptance-2026-10-12.json`). 공개 registry에서 alpha.5 미게시·다섯 alpha 태그의 alpha.4를 다시 확인했다(`review/release-alpha5-registry-preflight-2026-10-12.json`). registry 경로는 아직 support-report fixture를 건너뛰고 SvelteKit은 alpha.4 계약 전용 fixture를 쓰므로, 새 API의 registry 인수도 남은 작업이다. 승인 CI manifest를 로컬 후보 JSON으로 대체하지 않는다.

2026-10-12 후속: 원본 버전과 기존 릴리스 산출물을 유지하는 후보 생성·검증 명령을 추가했다. `5d90701`의 입력 937개와 버전 변경만 허용한 alpha.5 임시 사본에서 전체 check·다섯 tarball 독립 JS/TS 소비·게시 계획 dry run을 통과했다. 도구 회귀 2건과 근거는 `review/release-candidate-acceptance-2026-10-12.json`에 있다. 최종 버전 승격·공개/미게시 문서 정리·원격 게시·registry 인수는 남아 있으므로 24·68행과 문의/동봉 문서의 공개 전달 상태는 부분으로 유지한다.

상태 UI·진단 수집 UI·React cached 수명·lazy observer 오류 처리는 분리 실행 기록의 범위까지 확인했고, 기존 동작 문서와 게시본 검증 예제 경계도 정리했다. 세 프레임워크 예제와 독립 시작 안내의 빈 카탈로그 복구, 문서 동봉 tarball의 독립 설치도 확인했다. vanilla의 키보드·좁은 화면·긴 문구는 확인하고 넘침을 수정했다. 다음은 확대·보조 기술, 문의 수신과 승인 릴리스의 문서·연락처 공개 전달이다. 문의·보안 안내의 로컬 문서와 메타데이터는 독립 tarball 검사까지 완료했다. 같은 입력의 유효한 기존 검증은 재사용한다. 이 문서는 전체 목표의 완료를 뜻하지 않는다.

---
작성 2026-10-11(KST). 초기 감사 기준 `c92515d`. 후속 검증 범위·커밋·근거는 분리 실행 기록과 각 JSON을 따른다. 개발 클라이언트·예제·시작 문서의 로컬 변경을 포함하며 패키지 버전·registry 상태는 그대로다.

