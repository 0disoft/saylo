# 77. 로컬 릴리스 준비 상태 (`0f7840f`, `eb66af8`)

관측일 2026-10-11(KST). 현행 소스로 로컬 검증을 돌린 결과를 짧게 남긴다. 근거는 [review/local-readiness-2026-10-11.json](../review/local-readiness-2026-10-11.json)이고 `observedAt`은 2026-10-10T21:25:04Z, 기록 revision은 `38ee9be`다.

## 범위

- 이 문서는 로컬 검증 결과 기록이다. 게시, 버전 승격, 원격 CI, OIDC 토큰 교환, registry 대조는 포함하지 않는다.
- `0f7840f`는 검증 기준 소스, `eb66af8`은 마지막 제품 코드 변경, `38ee9be`는 검증 기록을 저장한 커밋이다. JSON의 `recordedAtRevision`은 저장 전 HEAD인 `abd4c8a`다.
- 제품 파일은 이후 바뀌지 않았고, 기록한 해시 86개가 현재 파일과 일치하는 것을 재확인했다.
- 해시 대상은 루트 package·lock, 다섯 패키지의 package·src·tsconfig, 두 pack 스크립트·pack fixture·release-check다. 모든 테스트 입력이나 tarball 전체의 integrity manifest는 아니다.

## 검증 결과

세 명령 모두 exit 0이다.

- `npm run check`: 다섯 패키지 build와 단위 테스트, JS·TS 소비 5종, React 예제, OIDC·registry 단위 검사.
- `npm exec -- node scripts/pack-smoke.mjs`: 다섯 tarball을 저장소 밖에서 독립 install하고 CLI·typegen·README 예제, Node 번역·인자 거부·React SSR, React·Svelte selector SSR, Vite production lazy, 완역 거부·복구, 개발 의존성 제거 후 SSR을 확인한다. 관측 Vite 8.3.4.
- `npm exec -- node scripts/pack-sveltekit.mjs`: 독립 5-tarball install, svelte-check 0 error·0 warning, Vite 8.3.4 production Node·client build, ko/en 동시 SSR과 boot 일치·canonical fallback, listener 정리와 runtime 취소, 운영 HTTP, Chromium 154 hydration과 ko→en→ko 전환·공통 layout 상태 유지·종료·재진입. 관측 HeadlessChrome 154.0.0.0.

## 게시본과 구분

- 이 pack은 미게시 후속 코드를 `0.1.0-alpha.3` metadata로 묶은 로컬 proof다. npm에 게시된 `alpha.3` artifact가 아니다.
- selector 공개 API는 현행 소스에 구현돼 있고 로컬 pack으로 검증했지만 게시본에는 없다.
- 원격 관측(2026-10-11): 다섯 패키지의 `alpha` tag가 `0.1.0-alpha.3`, `latest`는 placeholder `0.0.0-stage`, `alpha.4`는 없다. 근거는 [review/remote-state-2026-10-11.json](../review/remote-state-2026-10-11.json)이고, 게시 검증 이력(2026-10-09, [릴리스 기록](../releases/0.1.0-alpha.3.md))과 날짜를 구분해 읽는다. 마지막 성공 원격 run의 head는 `534a912`로 현행 소스가 아니다.
- 현행 head에 대한 외부 CI 실행과 OIDC 토큰 교환은 이번 검증이 아니다.

2026-10-11 후속: `d26506f`의 alpha.4 CI·OIDC 게시, 승인 manifest·registry SHA-512 대조, 게시본 JS/TS·selector SSR·SvelteKit Chromium 검증을 완료했다([릴리스 기록](../releases/0.1.0-alpha.4.md)). 위 alpha.3·미게시·원격 상태는 사전 로컬 검증 당시 기록이며 현재 게시 상태가 아니다.

## 하지 않은 것

- 버전 승격, push, publish, 승인 manifest `releases/0.1.0-alpha.3.json`과 `.release/` 갱신은 하지 않았다.
- 성능 수치는 [75](75-early-disk-rechecks.md)의 로컬 warmed 대표 조건 기록을 인용했고 cold·startup을 다시 재지 않았다. 제품 형태 결정은 [76](76-runtime-decision.md)을 따른다.
- 임시 tarball·소비 앱·브라우저·서버는 pack 스크립트가 정리했다.
