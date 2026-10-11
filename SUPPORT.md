# Saylo 지원 안내

이 문서는 Saylo의 일반 문의, 기능 제안, 버그 제보 창구와 보내면 좋은 정보를 정한다. 보안 문제는 [SECURITY.md](SECURITY.md)를 따른다.

## 창구

- 이메일: <mailto:rodisoft1@gmail.com> — 유지보수자(0disoft)의 [공개 GitHub 프로필](https://github.com/0disoft)에 기재된 연락처다.
- 제목 형식: `Saylo · <패키지> <버전> · <한 줄 요약>`
- 프로필: <https://github.com/0disoft>

제목 예시는 `Saylo · @0disoft/saylo-vite 0.1.0-alpha.4 · 문구를 저장해도 화면이 안 바뀜`이다. 제목에 `Saylo`와 패키지·버전을 넣으면 다른 저장소의 메일과 섞이지 않는다.

기존 게시본 alpha.4의 `bugs` 항목은 외부 접근 시 404인 GitHub issues를 가리킨다(2026-10-11 확인). 로컬 소스에서는 다섯 패키지의 `bugs.email`을 위 연락처로 바꿨다. 이 문서와 메타데이터 변경은 아직 npm에 게시하지 않았다.

## 보낼 내용

문의 종류가 무엇이든 다음을 적어 준다. 모르는 항목은 비워 둬도 된다.

- 패키지와 버전: `@0disoft/saylo-core`·`saylo-react`·`saylo-svelte`·`saylo-vite`·`saylo-typegen` 중 무엇인지, 버전(`0.1.0-alpha.4` 등).
- 환경: OS, Node 버전, 프레임워크와 버전(React·Svelte 등), Vite 버전, TypeScript 사용 여부.
- 실제 동작과 기대한 동작.
- 최소 재현: 관련 카탈로그 JSON 조각, 설정, 실행한 명령.

## 최소 재현

- 실제 서비스 문구 대신 구조만 옮긴 합성 카탈로그를 쓴다. 키 이름은 `demo` 같은 일반 이름으로 바꾼다.
- 예시는 [문의용 진단 보고서](docs/support-report.md)의 원인 재현 절에 있는 형식을 참고한다.
- 비밀값(토큰·키·쿠키), 실제 사용자 입력, 개인정보는 보내지 않는다.

## 진단 자료 (선택)

- 진단 JSON은 필수가 아니다. 위 정보만으로 먼저 보내면 된다.
- 현재 checkout이나 `0.1.0-alpha.5` 후보 tarball의 `createSupportRecorder`로 만든 보고서가 있으면 첨부할 수 있다. 현재 npm 게시본 `0.1.0-alpha.4`에는 이 API가 없다. 후보는 아직 게시하지 않았고, 문의를 위해 설치나 사용을 요구하지 않는다.
- 형식과 수집 범위는 [문의용 진단 보고서](docs/support-report.md)에 있다. 첨부 전에 그 문서로 무엇이 들어가는지 확인한다.

## 설치 태그

게시본은 `0.1.0-alpha.4`이고 dist-tag는 `alpha`다. `latest` 태그는 실제 사용 패키지가 아닌 등록용 placeholder를 가리킨다. `@alpha`로 설치한다. 설치한 버전은 `package.json`이나 `npm ls`로 확인한다.
