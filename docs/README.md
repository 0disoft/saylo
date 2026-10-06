# 문서 안내

이 디렉터리는 Saylo의 설계 계약과 로컬 검증 기록을 함께 담는다. 설계 초안과 이미 구현·검증한 현행 동작이 섞여 있으므로, 문서와 실제 코드가 어긋나면 `packages/*/README.md`와 `packages/*/src`의 현행 코드가 우선이다. 이 디렉터리에서 `제안`·`목표`·`미해결`·`미검증`은 설계 의도이고, `로컬 구현 완료` 같은 표기는 실행한 검증 범위를 가리킨다. 갱신 wire의 단일 출처는 [08-update-protocol.md](08-update-protocol.md)이고, 실측·직접 검증 기록은 [06-validation-and-roadmap.md](06-validation-and-roadmap.md)에 있다.

로컬 검증을 마친 항목은 이 디렉터리와 `packages/*/README.md`에 함께 적는다. 아직 구현하지 않은 기능은 문서가 완료를 주장하지 않는다.

## 읽는 순서

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
