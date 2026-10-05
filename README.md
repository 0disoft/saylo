# Saylo (설계 문서)

Saylo는 개발 중 번역 문구를 고칠 때 재컴파일을 기다리지 않고 화면에 즉시 반영하는 것을 목표로 하는 i18n(국제화) 라이브러리다. JavaScript와 TypeScript 프로젝트를 함께 지원하고, 개발 서버에서 문구 수정, 로케일 추가, namespace 추가가 입력 폼, 모달, 스크롤 위치 같은 기존 DOM 상태를 그대로 둔 채 반영되는 것을 목표로 한다.

## 현재 상태

- 이 저장소에는 설계 문서만 있다. 설치 가능한 패키지, 배포물, 실행 가능한 코드는 아직 없다.
- 성능 수치는 전부 목표치다. 측정 결과가 아니며, 벤치마크도 아직 없다.
- 지원 버전 범위, 패키지 배포 방식, 런타임 요구사항은 확정하지 않았다.
- npm 패키지 이름 `saylo`의 사용 가능 여부는 확인하지 않았다. 라이선스도 아직 정하지 않았다.
- 구현 완료, 성능 달성, npm 배포 상태를 주장하는 문서가 아니다. 문서에 나오는 모듈 구조, 이벤트 이름, API 시그니처는 초기 기술 제안이며 구현 과정에서 바뀔 수 있다.
- 문서 기준일: 2026-10-05

## 설계 방향 한 줄 요약

개발 서버가 파일 변경을 감지하면 그 파일만 파싱·검증하고, 로케일+namespace 단위의 카탈로그 스냅샷(또는 패치)을 클라이언트 store에 전달한다. 라이브러리는 그 변경만 구독해 다시 렌더링한다. JS 코드 생성 완료를 기다리지 않고, 전체 앱 모듈 무효화나 full reload도 하지 않는다. 없애려는 것은 코드 생성 대기이고, 파싱과 검증에 드는 시간은 남는다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [docs/README.md](docs/README.md) | 문서 읽는 순서와 상태 표기 규칙 |
| [docs/01-product-and-scope.md](docs/01-product-and-scope.md) | 문제 정의, 목표, 범위, 비목표, 용어 |
| [docs/02-architecture.md](docs/02-architecture.md) | 개발 파이프라인, 코어/어댑터 경계, store 모델 |
| [docs/03-catalog-and-api.md](docs/03-catalog-and-api.md) | 카탈로그 파일, ID/namespace, ICU 정책, HMR 프로토콜, 공개 API와 예제 |
| [docs/04-live-update-and-types.md](docs/04-live-update-and-types.md) | 라이브 반영 규칙, revision, 실패 복구, 타입 생성 |
| [docs/05-build-and-ssr.md](docs/05-build-and-ssr.md) | 운영 빌드, 지연 로딩, Vite 변환, SSR, 보안 |
| [docs/06-validation-and-roadmap.md](docs/06-validation-and-roadmap.md) | 성능 목표, 인수 사례, 검증 방식, 로드맵 |
| [docs/07-decisions.md](docs/07-decisions.md) | 확정 목표, 설계 선택, 미해결 위험, 참고 자료 |
