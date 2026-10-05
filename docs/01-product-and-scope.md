# 01. 제품과 범위

이 문서는 Saylo가 풀려는 문제와 다루지 않는 범위, DOM 상태 보존 범위를 정한다.

## 문제

코드 생성(codegen) 방식 i18n은 메시지를 빌드 산출물로 굽는다. 그래서 문구 한 줄을 고치거나 로케일을 추가할 때마다 메시지 컴파일이 다시 돌아야 하고, 그 대기 시간이 개발 흐름을 끊는다. 컴파일이 끝나기 전에는 화면에 바뀐 문구가 나오지 않는다.

또 다른 불편은 상태 초기화다. 전체 모듈 무효화나 full reload로 새 문구를 반영하면 열어 둔 입력 폼, 모달, 스크롤 위치, 임시 입력값이 사라진다. 번역을 다듬는 작업은 저장을 반복하는 일이라 이 손실이 자주 누적된다.

## 목표

- 문구 수정, 로케일 추가, namespace 추가가 개발 서버에서 즉시 반영된다.
- 반영이 기존 DOM 상태(입력값, 포커스, 모달 열림, 스크롤 위치)를 파괴하지 않는다.
- JavaScript와 TypeScript 프로젝트를 모두 지원한다.
- 코어는 프레임워크 중립이고, 프레임워크 어댑터로 확장한다.
- 개발과 운영이 같은 파싱·검증·포맷·폴백 규칙을 공유한다.

## 개발 반영 경로

파일 watch → 수정 파일 parse/validate → 로케일+namespace 단위 catalog transaction → Vite custom event로 snapshot/patch 전달 → 클라이언트 store 갱신 → 프레임워크 구독 재렌더.

이 경로는 JS 산출물 생성 완료, 전체 앱 모듈 무효화, full reload, typegen 완료를 기다리지 않는다. 없애려는 것은 코드 생성 대기와 전체 리로드다. 파싱과 검증에 드는 시간은 남는다.

## DOM 상태 보존 범위

- 문구 값 수정과 로케일 추가는 기존 DOM 상태를 보장한다.
- schema-compatible 편집(값만 바꾸는 키 편집)은 기존 DOM 상태를 보장한다.
- schema-breaking 편집(키 삭제, 필수 인자 추가)은 새 schema를 즉시 적용하고 진단과 typegen을 함께 낸다. 기존 호출부는 `InvalidArgumentError`를 낼 수 있고, 그 편집의 DOM 상태는 보장하지 않는다. 자세한 규칙은 [04-live-update-and-types.md](04-live-update-and-types.md)를 따른다.
- Vite dev server 재시작이나 websocket 재연결에서 Vite client가 스스로 full reload를 하는 경우는 이 보장 범위 밖이다. 자세한 내용은 [05-build-and-ssr.md](05-build-and-ssr.md)를 따른다.
- Saylo가 DOM을 다시 만들지 않아도 문구 길이 변화로 레이아웃과 스크롤 위치가 달라질 수 있다. 상태 보존 인수 검사는 같은 레이아웃 조건에서 수행한다.

## 비목표

| 비목표 | 이유 |
| --- | --- |
| 전체 리로드로 반영 | DOM 상태를 파괴한다. |
| 화면 컴포넌트 전면 remount | 입력·포커스·스크롤 상태를 잃는다. |
| Rich text 컴포넌트 보간 MVP | 값 문법과 타입 계약을 복잡하게 만든다. 순수 텍스트를 먼저 지원한다. |
| selector 단위 미세구독 최적화 | MVP는 instance 단위 locale/catalog revision 구독으로 시작한다. |
| 사용하지 않는 메시지 제거 최적화 | 동적 t 키와 충돌한다. 근거가 모인 뒤 별도로 다룬다. |
| 컴파일러·번들러 대체 | Saylo는 i18n 계층만 담당한다. |

## 대상 사용자

- 문구를 자주 고치며 개발 중 대기를 줄이고 싶은 JS/TS 개발자.
- 상태를 유지한 채 문구를 반영하고 싶은 폼·대시보드 중심 화면을 만드는 팀.
- 프레임워크 중립 코어와 프레임워크 어댑터를 함께 쓰려는 프로젝트.

## 용어

| 용어 | 정의 |
| --- | --- |
| catalog | 한 로케일 안의 한 namespace에 해당하는 메시지 집합 |
| namespace | 카탈로그를 나누는 파일 단위. 예: `common`, `cart` |
| registry revision | 세션 안에서 전송 순서를 식별하는 단조 증가 번호 |
| catalogVersion | 로케일+namespace별 카탈로그와 삭제 상태의 버전 |
| stateRevision | 공개 UI snapshot의 변경을 식별하는 번호 |
| snapshot | 특정 시점의 불변 상태. UI·boot·전송 snapshot은 용도가 다르다. |
| patch | base revision에서 새 revision으로 가는 변경 묶음 |
| base locale | 기준 로케일. 키와 argument 스키마의 원본이다. |
| generated types | 기준 스키마에서 만드는 타입 선언 |
| typegen | generated types를 만드는 배경 작업 |

## 원칙

1. 텍스트 우선. 값은 문자열이고, 임의 코드 실행이나 자동 HTML 주입을 하지 않는다.
2. 코어는 프레임워크를 모른다. 프레임워크 의존은 어댑터에만 둔다.
3. 개발과 운영이 같은 정규화·검증·포맷·폴백 경로를 쓴다.
4. 실패하면 마지막 정상 카탈로그를 유지하고 진단을 노출한다. 세부 규칙은 [04-live-update-and-types.md](04-live-update-and-types.md)를 따른다.
5. 검증하지 않은 성능·버전·생태계 주장을 하지 않는다.
