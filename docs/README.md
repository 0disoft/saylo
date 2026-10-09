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
