# 82. Admin support 페이지 Saylo 파일럿

문서 정리 `ab220c2`에 이어 제품 소스 `d4eb6e8`에서 확인한 admin 고객 지원 화면 pilot 기록이다. Saylo 전체 기능의 완료 인증이나 게시 결과가 아니다.

## production typegen 잠금 문제

Vite production typegen이 SSR `writeBundle` 안의 nested client build와 겹치면 `OUTPUT_LOCKED`가 재현됐다. `production.test.mjs` 회귀는 수정 전 실패했고 수정 뒤 14개가 통과했다. production `buildStart`의 typegen 갱신이 끝난 뒤 generator를 stop해 lock을 해제하고, watch rebuild에서는 다시 생성하는 동작으로 정리했다. 관련 경로는 [`packages/vite/src/index.ts`](../packages/vite/src/index.ts), [`packages/typegen/src/generator.ts`](../packages/typegen/src/generator.ts), `packages/vite/test/production.test.mjs`다.

## admin 지원 화면 범위

admin `/support`에는 한국어·영어 각 30개 키를 넣어 제목, 필터, 표, 상세, 사유, 답변과 건수 표시를 번역했다. 오류·복구·운영 상태 등 나머지 화면 문구는 기존 한국어이며, 전체 화면 번역으로 주장하지 않는다.

웹 앱은 request-local `createStore`를 만들고 SSR `?locale=en` 또는 `?locale=ko`를 따른다. 클라이언트는 `onMount`에서 `connectDev`를 연결하고 `onDestroy`에서 dispose한다. 관련 구현 위치는 `zdp-platforms/admin-ops/zdp-admin-console/apps/web`, 번역 파일은 `apps/web/locales/ko/support.json`·`en/support.json`이다.

## 검증 결과

`scripts/check-web-saylo-pilot.mjs`는 exit 0이며 합성 admin 데이터로 실행했다. JSON 결과의 `liveEdit`, `parseRecovery`, `localeAddRemove`, `filterSelectionDraftIdentity`, `focusCaret`, `englishHydration`은 true였고, 동시 SSR은 ko/en 모두, `pageErrors`는 0이었다. 실제 API 쓰기는 수행하지 않았다.

`d4eb6e8`의 최신 Vite tarball을 npm으로 다시 설치한 기존 typegen-on 구성에서 실제 admin SvelteKit Cloudflare build가 exit 0(21.36s)으로 끝나 잠금 수정이 실앱에서도 통과했다. 최종 portable CLI config build도 exit 0(21.82s)이었고 최종 `check`는 오류 0·경고 0, support-page·command-snapshot·detail-client의 20개 테스트 103개 assertion과 경계 검사가 통과했다.

registry alpha.4를 `bun install --force --frozen-lockfile --ignore-scripts`로 설치한 뒤 core·vite `dist`가 로컬 tarball과 다름을 확인했다. 이 상태의 최종 CLI config Cloudflare build는 client 5.81초·server 24.82초에 exit 0이었고, registry 재브라우저 검사도 exit 0으로 같은 pilot JSON 항목이 모두 true이며 `pageErrors`는 0이었다. 이는 설치·실행 결과이고 실시간 npm metadata 조회 결과가 아니다.

Windows browser fixture에서 `taskkill /F` 뒤 test 전용 typegen stale lock이 남는 경우가 있어 fixture callback에 `serverPid`를 노출했고, pilot script의 `finally`는 `owner.pid`가 해당 실행 PID·hostname·정확한 target과 일치하고 PID 부재를 확인한 경우에만 `owner.json`과 빈 lock 디렉터리를 정리한다. 같은 `finally`에서 기존 파일 복원과 추가한 `ja` 파일 삭제를 처리하며, 알 수 없는 stale lock의 자동 삭제는 보장하지 않는다.

## 로컬 tarball 경계

최신 `dist`가 든 local tarball 네 개는 `npm --no-save --package-lock=false`로 설치했고 각 패키지의 `dist` SHA-256이 일치했다. 같은 버전의 Bun `--no-save` 설치는 최초에 registry의 기존 패키지를 재사용해 불일치가 났으며, npm 설치로 로컬 tarball을 직접 검증했다. 이 로컬 tarball 검사는 registry alpha.4 설치 후 재검증과 별개다.

admin의 기본 의존성은 여전히 registry alpha.4다. 운영 build는 typegen CLI를 Vite보다 먼저 실행하고, Vite typegen은 `command === 'serve'`에만 연결해 nested client build를 피하는 구성이 현재 최종 config다. registry alpha.4의 최종 build와 재브라우저 검사까지 완료됐으며, 검증은 설치된 package와 실행 결과를 기준으로 한다.
