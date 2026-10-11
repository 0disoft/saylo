# 보안 정책

Saylo의 보안 문제는 공개 이슈가 아니라 비공개 이메일로 제보한다. 일반 문의·기능 제안·일반 버그는 [SUPPORT.md](SUPPORT.md)를 따른다.

## 창구

- 이메일: <mailto:rodisoft1@gmail.com>
- 제목 형식: `Saylo security · <패키지> <버전> · <한 줄 요약>`
- 프로필: <https://github.com/0disoft>

GitHub 저장소와 보안 권고(advisory) 작성 폼은 외부에 공개되어 있지 않고, 인증 없는 요청에 404를 반환한다(2026-10-11 확인). 그래서 위 이메일을 제보 연락처로 안내한다. 이 문서와 패키지 연락처 변경은 로컬 준비 상태이고 기존 alpha.4 tarball에는 없다.

## 제보에 담을 것

- 영향받는 패키지와 버전: `@0disoft/saylo-core`·`saylo-react`·`saylo-svelte`·`saylo-vite`·`saylo-typegen` 중 무엇인지.
- 환경: OS, Node 버전, Vite 버전, 프레임워크·브라우저 버전.
- 도달 경로와 영향: 어떤 입력·설정·호출이 어떤 결과로 이어지는지.
- 최소 재현: 합성 카탈로그와 설정으로 줄인 절차.

credential, API 키, 세션 쿠키, 실제 사용자의 번역 문구와 개인 입력은 보내지 않는다. 재현에 그런 값이 필요해 보이면 같은 구조를 합성 값으로 바꿔 적는다.

## 대상

Saylo는 JavaScript·TypeScript i18n 라이브러리 다섯 패키지다.

| 패키지 | 역할 |
| --- | --- |
| `@0disoft/saylo-core` | 카탈로그 파싱·검증, 번역과 포맷, 불변 store |
| `@0disoft/saylo-vite` | Vite 개발 플러그인, 운영 빌드 변환, SSR boot, 개발 연결 |
| `@0disoft/saylo-react` | React context와 snapshot-bound hook |
| `@0disoft/saylo-svelte` | Svelte 5 어댑터 |
| `@0disoft/saylo-typegen` | 기준 스키마의 타입 선언 생성 CLI와 worker |

## 입력과 노출 경계

- 카탈로그와 메시지는 앱이 지정한 로케일·namespace 경로에서 읽는다. 로케일·namespace allowlist와 경로 검증은 그 범위 밖 파일을 읽지 않기 위한 경계다. 이 경계를 우회할 수 있는 경로가 있으면 재현과 함께 제보한다.
- 메시지 값은 문자열이고, 임의 HTML이나 코드를 자동 주입하지 않는다. 이스케이프는 쓰는 프레임워크에 맡긴다.
- 개발 경로(파일 watch, 커스텀 이벤트, websocket)는 개발 서버 전용이고, 운영 빌드는 상시 채널을 열지 않는다.
- SSR boot 데이터를 HTML에 넣으면 브라우저에서 읽을 수 있다. 비밀값을 넣지 않으며, 직렬화·HTML 삽입 경계의 문제는 사용하는 어댑터와 삽입 방법을 함께 제보한다.
- Saylo 패키지는 계정, 원격 업로드, 자체 서버를 두지 않는다. 카탈로그를 어디서 읽고 무엇을 노출하는지는 앱이 정한다.

## 위험 판단 기준

도달 경로와 영향으로 판단한다. 같은 코드라도 어떤 앱에 어떻게 붙었는지에 따라 노출 범위가 달라지므로, 재현 절차와 영향 범위를 함께 적어 준다. 카탈로그·메시지 입력, SSR boot, Vite 개발 플러그인 관련 제보는 그 경로를 짚어 주면 확인이 빠르다.
