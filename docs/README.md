# 문서 안내

이 디렉터리는 Saylo의 설계 계약과 로컬 검증 기록을 함께 담는다. 설계 초안과 이미 구현·검증한 현행 동작이 섞여 있으므로, 문서와 실제 코드가 어긋나면 `packages/*/README.md`와 `packages/*/src`의 현행 코드가 우선이다. 이 디렉터리에서 `제안`·`목표`·`미해결`·`미검증`은 설계 의도이고, `로컬 구현 완료` 같은 표기는 실행한 검증 범위를 가리킨다. 갱신 wire의 단일 출처는 [08-update-protocol.md](08-update-protocol.md)이고, 실측·직접 검증 기록은 [06-validation-and-roadmap.md](06-validation-and-roadmap.md)에 있다.

로컬 검증을 마친 항목은 이 디렉터리와 `packages/*/README.md`에 함께 적는다. 아직 구현하지 않은 기능은 문서가 완료를 주장하지 않는다.

## 읽는 순서

Svelte 어댑터와 데모의 현행 범위는 [38-svelte-adapter.md](38-svelte-adapter.md)에 정리했다. 기존 성능 측정 기록은 그대로 유지한다.
SvelteKit의 실제 요청·페이지 이동·종료와 재진입 연결은 [39-sveltekit-example.md](39-sveltekit-example.md)에 정리했다.

1. [01-product-and-scope.md](01-product-and-scope.md) — 왜 만드는지, 무엇을 하지 않는지, DOM 보존 범위
2. [02-architecture.md](02-architecture.md) — 개발 반영 경로, 계층 구조, 상태 모델, 소유권
3. [03-catalog-and-api.md](03-catalog-and-api.md) — 카탈로그 형식, argument 계약, 공개 API
4. [04-live-update-and-types.md](04-live-update-and-types.md) — 갱신 판정, 복구, 타입 생성 규칙
5. [05-build-and-ssr.md](05-build-and-ssr.md) — 운영 빌드, SSR, 보안
6. [06-validation-and-roadmap.md](06-validation-and-roadmap.md) — 성능 목표와 측정 정의, 인수 사례, 로드맵
7. [07-decisions.md](07-decisions.md) — 결정 대장과 미해결 항목
8. [08-update-protocol.md](08-update-protocol.md) — 갱신 wire 프로토콜의 단일 출처
9. [10-performance-measurements.md](10-performance-measurements.md) — 로컬 벤치마크 결과와 프로파일 기록
10. [11-parser-measurements.md](11-parser-measurements.md) — 파서 내부 비용과 최적화 검증
11. [12-locale-add-measurements.md](12-locale-add-measurements.md) — 새 로케일 목록·최초 번역 반영 측정
12. [13-paraglide-comparison.md](13-paraglide-comparison.md) — Paraglide 동일 규모 측정과 초기 준비 실패 관측
13. [14-locale-add-server-measurements.md](14-locale-add-server-measurements.md) — 대규모 로케일 추가의 서버 읽기·파싱·검증 비용
14. [15-simple-message-parser.md](15-simple-message-parser.md) — 단순 메시지 파싱 최적화와 cold 교차 비교
15. [16-compact-catalog-transport.md](16-compact-catalog-transport.md) — lazy full 카탈로그의 compact 개발 전송과 검증
16. [17-cold-parser-measurements.md](17-cold-parser-measurements.md) — 새 카탈로그 파싱의 내부 구간과 GC 관측
17. [18-shared-argument-schemas.md](18-shared-argument-schemas.md) — 동일 인자 스키마 공유와 cold 교차 비교
18. [19-ast-freeze-measurements.md](19-ast-freeze-measurements.md) — 파서 소유 AST 동결 최적화와 cold·incremental 비교
19. [20-locale-add-remeasurement.md](20-locale-add-remeasurement.md) — 최적화 후 로케일 추가·선택의 종단 간 재측정
20. [21-locale-add-server-remeasurement.md](21-locale-add-server-remeasurement.md) — 현행 대규모 로케일 추가의 서버 구간과 다음 파서 후보
21. [22-relative-position-sharing.md](22-relative-position-sharing.md) — 단순 AST 상대 좌표·구간 공유와 파서 비교
22. [23-position-sharing-locale-add.md](23-position-sharing-locale-add.md) — 상대 위치 공유 후 목록·첫 번역 반영 재측정
23. [24-full-selection-browser-stages.md](24-full-selection-browser-stages.md) — 첫 언어 선택의 full 디코딩·동결·snapshot 계측
24. [25-core-outcome-acceptance-stages.md](25-core-outcome-acceptance-stages.md) — core 응답 검증·동결 분리와 중복 순회 최적화 후보
25. [26-shared-catalog-freeze.md](26-shared-catalog-freeze.md) — Vite/core 깊은 동결 경로 공유와 같은 조건의 전후 비교
26. [27-shared-freeze-locale-add.md](27-shared-freeze-locale-add.md) — 일반 prebundle 설정의 목록·첫 번역 반영 50회 재측정
27. [28-full-reply-stages.md](28-full-reply-stages.md) — 기본 prebundle의 full 응답 준비·수신 이후 구간 계측
28. [29-prebundle-client-stages.md](29-prebundle-client-stages.md) — 기본 prebundle의 client 수신 이후·publication·commit 구간 계측
29. [30-prebundle-freeze-sharing.md](30-prebundle-freeze-sharing.md) — core root import로 정상 prebundle의 동결 신뢰 공유
30. [31-prebundle-freeze-locale-add.md](31-prebundle-freeze-locale-add.md) — 상세 계측을 끈 로케일 목록·첫 번역 반영 50회 재측정
31. [32-prebundle-server-measurements.md](32-prebundle-server-measurements.md) — 현행 large 목록의 서버 파일 구간과 파서 비용 재계측
32. [33-owned-message-freeze-trial.md](33-owned-message-freeze-trial.md) — 메시지·위치 직접 동결 실험의 비교 결과와 원복
33. [34-message-freeze-stages.md](34-message-freeze-stages.md) — AST·절대 위치·레코드 동결 구간 분리와 다음 후보
34. [35-shared-ast-seal.md](35-shared-ast-seal.md) — AST 동결 `seal` 헬퍼 모듈화와 cold·incremental 교차 비교
35. [36-shared-ast-seal-locale-add.md](36-shared-ast-seal-locale-add.md) — AST 동결 seal 공유 후 상세 계측을 끈 large 로케일 목록·첫 번역 반영 재측정
36. [37-seal-locale-add-comparison.md](37-seal-locale-add-comparison.md) — seal 공유 전후 locale-add 격리 비교와 원복 결정
37. [40-simple-argument-trial.md](40-simple-argument-trial.md) — 단순 파싱·인자 수집 통합 실험의 cold·incremental 비교와 원복
38. [41-json-entry-visitor-trial.md](41-json-entry-visitor-trial.md) — JSON 임시 entry 배열 제거 실험의 cold·incremental 비교와 원복
39. [42-complete-translations.md](42-complete-translations.md) — Vite 운영 빌드의 선택적 번역 키·namespace 완역 검사
40. [43-react-selectors.md](43-react-selectors.md) — React 선택자 미세구독의 계약·로컬 검증과 현행 게시 상태
41. [44-svelte-selectors.md](44-svelte-selectors.md) — Svelte 선택자 구독의 계약·로컬 검증과 현행 게시 상태
42. [45-review-fixes-performance-baseline.md](45-review-fixes-performance-baseline.md) — 리뷰 수정 커밋 `9cfb844`의 편집 반영·로케일 추가 현행 성능 기준값
43. [46-review-fixes-server-file-stages.md](46-review-fixes-server-file-stages.md) — 리뷰 수정 기준 large 읽기·후보 구간 분리 계측
44. [47-json-field-scanner-trial.md](47-json-field-scanner-trial.md) — JSON 항목 정규식 통합을 교차 비교하고 원복한 기록
45. [48-parser-cpu-profile.md](48-parser-cpu-profile.md) — 현행 파서의 CPU 표본·줄 귀속과 다음 맵 동결 후보
46. [49-owned-message-map-freeze.md](49-owned-message-map-freeze.md) — 파서 소유 메시지 맵 재순회 생략과 편집·신규 파싱 교차 비교
47. [50-owned-message-map-live-measurements.md](50-owned-message-map-live-measurements.md) — 맵 동결 최적화 뒤 실제 편집·로케일 추가 측정과 목표 미달
48. [51-owned-message-map-comparison.md](51-owned-message-map-comparison.md) — 맵 동결 최적화 전후 종단 간 교차 비교와 목표 미달
49. [52-server-runtime-tail.md](52-server-runtime-tail.md) — read/candidate 잔여 구간·GC·타이머 지연 진단과 신규 파싱 후보
50. [53-completion-audit.md](53-completion-audit.md) — 원래 명시 요구사항·로드맵 대조 완료 감사와 남은 작업
51. [54-plain-argument-contracts.md](54-plain-argument-contracts.md) — plain argument contract 재사용의 cold·incremental 교차 비교와 로컬 채택
52. [55-next-turn-edits.md](55-next-turn-edits.md) — 다음 턴 편집 병합의 Vite·브라우저 교차 비교와 편집 목표 미달
53. [56-thin-layer-contract-probe.md](56-thin-layer-contract-probe.md) — i18next·Wuchale 공개 확장점 위 계약 프로브 36개 관측과 전체 계층 평가 보류
54. [57-thin-layer-browser-probe.md](57-thin-layer-browser-probe.md) — 얇은 계층 브라우저 기능 스모크 8개 시나리오와 상태 보존, 성능·SSR·lazy 판정 보류
55. [58-trailing-disk-rechecks.md](58-trailing-disk-rechecks.md) — 첫 게시 뒤 60ms 꼬리 디스크 재확인으로 watcher throttle 복구, 편집 목표 미달 기록
56. [59-json-leaf-edits.md](59-json-leaf-edits.md) — JSON leaf 단일 문자열 편집의 파서·브라우저 측정과 로케일 추가 목표 미달 기록
57. [60-next-turn-additions.md](60-next-turn-additions.md) — 다음 턴 신규 로케일 파일 즉시 읽기, 서버 파일 구간·파서 trial 원복·최신 단일 run 기록
58. [61-superseded-parse-reuse.md](61-superseded-parse-reuse.md) — superseded 성공 파싱 재사용, 직전 60 single-read 단정 실패 재현과 성능 안정성 미달 기록

59. [62-multi-read-measurements.md](62-multi-read-measurements.md) — 다중 읽기 batch 소유권·interval union 계측과 상세 조건 25회 재측정

60. [63-thin-layer-timezone.md](63-thin-layer-timezone.md) — 얇은 계층 시간대 프로브의 호스트 시간대 누출과 named style 우회 gap 기록

61. [64-thin-layer-timezone-adapter.md](64-thin-layer-timezone-adapter.md) — i18nFormat 직접 구현 어댑터의 시간대 고정, Node 336·브라우저 8단계 결과와 production parser 경계 위험

62. [65-thin-layer-ast-production.md](65-thin-layer-ast-production.md) — benchmark 전용 AST runtime helper로 layer-ast production build의 parser emission 제거 검증

63. [66-thin-layer-ssr-production.md](66-thin-layer-ssr-production.md) — 실제 production client의 host 시간대 매트릭스 12페이지 SSR hydration과 누락 pair bug 수정 검증

64. [67-thin-layer-lazy-contracts.md](67-thin-layer-lazy-contracts.md) — 독립 i18next lazy coordinator의 14 시나리오 교차 검증과 production 부분 로딩

65. [68-thin-layer-lazy-browser.md](68-thin-layer-lazy-browser.md) — 실제 Chromium/Vite dev에서 core·layer 두 fixture의 compact·patch wire 12단계와 실제 소켓 종료 뒤 Vite 기본 reload 상태 초기화

66. [69-thin-layer-typegen.md](69-thin-layer-typegen.md) — 실제 Vite dev typegen worker와 strict·checkJs 소비자 9단계, any-return 대조 선언으로 오류 검사 확인

67. [70-thin-layer-lazy-production-browser.md](70-thin-layer-lazy-production-browser.md) — 실제 Vite production build 두 개의 static HTTP·headless Chromium lazy 부분 로딩 12단계와 parser marker 부재 관측

68. [71-thin-layer-lazy-session-browser.md](71-thin-layer-lazy-session-browser.md) — 실제 Vite 개발 서버 두 fixture에서 product reply 보류·순서 변경, locale supersede, 세션 교체 뒤 늦은 응답 무시 12단계×2

69. [72-thin-layer-sync-construction.md](72-thin-layer-sync-construction.md) — 동기 생성자 계약, unit 64개와 typegen·production browser --sync 재확인

70. [73-thin-layer-runtime-cost.md](73-thin-layer-runtime-cost.md) — 동기 layer와 core의 격리 런타임 비용과 snapshot 보유 heap delta 1k·10k

71. [74-immutable-validation-reuse.md](74-immutable-validation-reuse.md) — deep-frozen identity pair 검증 재사용, 격리 비용·CPU 표본과 편집 small 미달 기록
72. [75-early-disk-rechecks.md](75-early-disk-rechecks.md) — 10ms 이른 재확인 단독 미채택과 30ms 보완 채택, enqueue origin 분해·small·large ABBA

73. [76-runtime-decision.md](76-runtime-decision.md) — 런타임 형태 결정: 독립 런타임 유지, FormatJS parser·IMF 재사용 지속, i18next prototype 미채택


## 상태 표기 규칙

| 표기 | 의미 |
| --- | --- |
| 확정 | 사용자 목표로 확인된 항목 |
| 설계 선택 | 구현 방향으로 제안한 기술 결정. 검증 전이며 바뀔 수 있다. |
| 목표 | 측정하지 않은 성능 수치. 달성 주장이 아니다. |
| 미해결 | 아직 정하지 않았거나 확인하지 않은 항목 |
| 미검증 | 외부 사실(배포 여부, 생태계 지원 등)을 확인하지 않은 상태 |

## 작성 원칙

- 문서 본문은 명료한 한국어 `-한다/-이다` 문체로 쓴다.
- 아직 만들지 않은 기능을 제공한다고 쓰지 않는다.
- 근거 없는 수치, 버전, 생태계 주장을 넣지 않는다. 확인한 사실과 제안을 구분한다.
- 검증하지 않은 항목은 미검증으로 표시한다.
- 각 문서는 40KB를 넘기지 않는다. 넘기기 시작하면 분리 후보다.
