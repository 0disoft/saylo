# 07. 결정 대장

이 문서는 확정된 목표, 초기 설계 결정, 미해결 위험을 한곳에 모은다.

## 확정된 사용자 목표

| 항목 | 상태 |
| --- | --- |
| 번역 수정·로케일 추가 시 재컴파일 대기 제거 | 확정 |
| 개발 서버에서 즉시 반영 | 확정 |
| 입력 폼·모달·스크롤 상태 유지 | 확정 |
| JS/TS 동시 지원 | 확정 |
| 이름 Saylo | 확정 |

## 초기 설계 결정 (검증 전, 바뀔 수 있음)

| 선택 | 내용 |
| --- | --- |
| 코어 형태 | 프레임워크 중립 TypeScript, 배포는 ESM JS + `.d.ts` |
| instance 생성 | 동기 `createI18n<AppSchema>` + `initialSnapshot` + `loaders`. schema는 타입 전용, 런타임 schema는 snapshot 메타에서 |
| 첫 dev plugin | Vite plugin, `handleHotUpdate`에서 커스텀 이벤트 + `[]` 반환 |
| 첫 프레임워크 어댑터 | vanilla subscription과 React. Svelte/Vue는 후속 |
| 갱신 단위 | 로케일+namespace 카탈로그 스냅샷. selector 미세구독은 후속 |
| 갱신 적용 | envelope 먼저 원자 반영, 로드된 카탈로그만 payload 적용, 미로드는 dirty |
| ICU 구현 | `@formatjs/icu-messageformat-parser` + `intl-messageformat` 재사용, AST 입력 |
| 태그 처리 | parser `ignoreTag`로 literal 처리. rich text는 MVP 제외 |
| argument 타입 | 기준 메시지 내 사용 교집합으로 추론. 번역은 기준 타입 전체를 수용, 더 좁으면 오류, 인자 생략 허용 |
| baseline schema 변경 | 유효한 변경은 커밋, 부적합한 secondary는 quarantine + fallback |
| 번역 누락 | baseline fallback 기본 허용. 완역 강제는 선택 옵션 |
| 로케일 목록 타입 | 런타임 `readonly string[]` + 검증된 setter. key·인자 타입은 strict |
| revision 구분 | registry revision(전송)과 instance stateRevision(UI) 분리 |
| 오류 타입 | unknown key는 `UnknownMessageError`, 미로드 namespace는 `NamespaceNotLoadedError` |
| 시간대 | timeZone 명시 config, 기본 UTC 권장 |

## 미해결 위험

| 항목 | 상태 |
| --- | --- |
| 라이선스 | 미해결. 자동으로 정하지 않는다 |
| npm `saylo` 이름 확보 | 미검증 |
| 성능 목표 달성 | 미측정. 목표치만 존재 |
| 지원 버전 범위 | 미해결 |
| build-time parser 런타임 제거 | bundler alias/no-parser 전략 검증 필요 |
| unused message 제거 최적화 | 동적 t 키 tradeoff 검증 필요 |
| selector 미세구독 최적화 | 후속 |
| ICU 정규화·중복 감지 | parser 전처리 필요 |
| full catalog replacement 비용 | 큰 namespace 변경 시 payload·parse 비용이 커진다. 대규모 fixture 벤치마크 후 message delta 최적화를 판단한다(후속) |

## 다른 도구와의 관계

Saylo는 코드 생성 방식 도구가 겪는 재컴파일 대기를 줄이는 것을 목표로 한다. HMR 기반 접근을 쓰는 도구와 방향이 겹친다. 구체 수치 비교나 측정 결과는 아직 없으므로 비교는 정성적·한정적 표현에 머문다.

## 참고 자료

- [Vite HMR API](https://vite.dev/guide/api-hmr) — `handleHotUpdate` 커스텀 이벤트와 모듈 무효화
- [Vite 플러그인 API](https://vite.dev/guide/api-plugin) — `handleHotUpdate` 훅과 커스텀 이벤트 전달
- [React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — store 구독과 스냅샷 동일성
- [FormatJS ICU 문법](https://formatjs.github.io/docs/core-concepts/icu-syntax/) — 지원하는 메시지 문법
- [FormatJS intl-messageformat](https://formatjs.github.io/docs/intl-messageformat/) — AST 입력과 `ignoreTag`
- [Paraglide 메시지 컴파일](https://paraglidejs.com/compiling-messages) — 코드 생성 방식의 대기 지점
- [Wuchale HMR 가이드](https://wuchale.dev/guides/hmr/) — HMR 기반 반영 접근
- [TypeScript 선언 파일 배포](https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html) — `.d.ts` 배포 형태
