# 81. 구현 현황과 잔여 범위

이 문서는 2026-10-24 문서 정리를 시작한 `main` `247d116974eea20a1c49e3f6c4bcd7132768bfe9`(`247d116`)의 구현 위치와 릴리스 경계를 정리한다. `247d116`은 직전 제품·검증 커밋 `d3e5252b98b975b89b5a86d1f39b363471298e65`(`d3e5252`) 뒤에 릴리스 계획과 유지보수 검토 기록만 추가했다. 최신 후보의 제품 소스와 검증 기준은 `d3e5252`다.

초기 로드맵 1~13단계는 구현 완료 상태이며, 단계별 완료 기준은 [06](06-validation-and-roadmap.md)에 남아 있다. 이 문서는 최근에 1~13단계 전체를 다시 실행했다고 주장하지 않는다.

## 기능별 현재 소스

### core

| 영역 | 현재 소스 |
| --- | --- |
| catalog parsing | [catalog-json.ts](../packages/core/src/catalog-json.ts), [simple-message.ts](../packages/core/src/simple-message.ts), [schema.ts](../packages/core/src/schema.ts), [rich-text.ts](../packages/core/src/rich-text.ts) |
| runtime | [runtime.ts](../packages/core/src/runtime.ts), [translator.ts](../packages/core/src/translator.ts), [formatters.ts](../packages/core/src/formatters.ts) |
| store | [store.ts](../packages/core/src/store.ts) |
| lazy loading | [i18n.ts](../packages/core/src/i18n.ts), [loading-runtime.ts](../packages/core/src/loading-runtime.ts), [loading-registry.ts](../packages/core/src/loading-registry.ts) |

### Vite

| 기능 | 현재 소스 |
| --- | --- |
| dev sync | [dev-sync.ts](../packages/vite/src/dev-sync.ts) |
| translation quarantine | [translation-quarantine.ts](../packages/vite/src/translation-quarantine.ts) |
| catalog push | [catalog-push.ts](../packages/vite/src/catalog-push.ts), [catalog-patch.ts](../packages/vite/src/catalog-patch.ts) |
| build automatic keys | [auto-key-analysis.ts](../packages/vite/src/auto-key-analysis.ts), [auto-keys.ts](../packages/vite/src/auto-keys.ts), [build-keys.ts](../packages/vite/src/build-keys.ts) |
| static SSR source | [static-catalog-source.ts](../packages/vite/src/static-catalog-source.ts), [server-source.ts](../packages/vite/src/server-source.ts) |

### typegen

| 기능 | 현재 소스 |
| --- | --- |
| catalog CLI | [catalog-cli.ts](../packages/typegen/src/catalog-cli.ts) |
| translation workflow | [catalog-sync.ts](../packages/typegen/src/catalog-sync.ts), [catalog-import.ts](../packages/typegen/src/catalog-import.ts) |
| approvals | [catalog-approvals.ts](../packages/typegen/src/catalog-approvals.ts), [catalog-approve.ts](../packages/typegen/src/catalog-approve.ts), [review-check.ts](../packages/typegen/src/review-check.ts) |
| refresh | [catalog-refresh.ts](../packages/typegen/src/catalog-refresh.ts) |
| work context | [catalog-work-context.ts](../packages/typegen/src/catalog-work-context.ts), [catalog-workfile.ts](../packages/typegen/src/catalog-workfile.ts) |
| format preservation | [catalog-json-edit.ts](../packages/typegen/src/catalog-json-edit.ts) |
| import diff | [catalog-diff.ts](../packages/typegen/src/catalog-diff.ts) |

## 최신 후보와 검증 기록

- 후보 원본 커밋은 `d3e5252`, 제안 버전은 `0.1.0-alpha.5`다. 후보 스냅샷은 `.release/candidate-0.1.0-alpha.5-fTJYGI`, 검증 기록은 같은 디렉터리의 `validation-1osDCF`에 있다.
- [유지보수 검토 기록](../review/maintenance-2026-10-23.json)은 `2026-10-23T10:49:27.507Z`에 `npm ci`, 빌드, 검사, 릴리스 메타데이터, pack, publish dry-run을 확인했다. 전체 `npm run check`의 8개 그룹, 총 536개 테스트는 `c6a1ad7`에서 성공한 결과를 재사용했다. 유일한 변경 파일이 pack 전용 watcher fixture였음을 비교한 뒤 영향받는 pack 단계는 새로 실행했다. 이 숫자는 당시 검증 기록이며 2026-10-24에 다시 실행한 결과가 아니다.
- 공개 선언 14개는 비교 기준과 바이트 단위로 같다. pack 단계는 로컬 tarball의 독립 설치와 JS·TS 소비를 확인했고, SvelteKit 검증은 별도로 tarball 설치, client·SSR 빌드, Chromium에서 hydration과 언어 전환을 확인했다.
- 후보 검증은 로컬 tarball 소비까지다. registry에서 후보 버전을 설치하는 소비 인수는 수행하지 않았다.

## 잔여와 릴리스 경계

- core selector API는 선택 후속 항목이다. React·Svelte selector는 현재 소스에 구현돼 있으며, core 공통 selector API의 후속 여부는 별도 결정이다.
- 다단계 fallback과 component 인자 보간은 비목표다.
- Vue 어댑터는 구현돼 있지만 `packages/vue`의 `private: true` workspace이며 게시 대상이 아니다.
- 실제 앱 pilot, 새 후보 동결·검증, 버전 승격과 게시는 이 문서의 검증 결과에 포함되지 않는다.

| 구분 | 현재 상태 |
| --- | --- |
| 추적 중인 `main` 소스 | 공개 패키지 5개는 `0.1.0-alpha.4`, Vue는 `0.1.0-alpha.4`이며 `private: true`다. |
| alpha.5 후보 스냅샷 | 공개 패키지 5개를 `0.1.0-alpha.5`로 준비했다. Vue는 alpha.4, `private: true`를 유지하며 tarball 대상에 포함하지 않았다. |
| 버전 승격 | 수행하지 않았다. `main`의 package manifest는 alpha.4다. |
| npm 게시 | 수행하지 않았다. publish 단계는 dry-run으로 계획만 검증했다. |
| registry 소비 인수 | 수행하지 않았다. 확인한 소비 경로는 로컬 tarball이다. |

## 성능과 검증의 해석

[75](75-early-disk-rechecks.md)의 성능 수치는 2026-10-11의 역사 측정값이다. 이 문서는 현재 HEAD에서 같은 조건을 다시 측정했거나 성능 목표를 달성했다고 주장하지 않는다.

현재 성능 측정은 75의 역사값과 분리해 별도 기록으로 다룬다. 이 문서에는 진행 중인 측정 결과나 현재 성능을 적지 않는다. benchmark harness의 수정도 [75](75-early-disk-rechecks.md)의 역사값을 소급해 바꾸지 않는다.

[82-admin-support-pilot.md](82-admin-support-pilot.md)는 admin 고객 지원 화면의 부분 번역 pilot과 production typegen 잠금 수정 과정을 남긴 역사 기록이다. 후속 적용 범위를 제안하는 문서가 아니며, 이 문서의 최신 후보 기준이나 검증 결과를 바꾸지 않는다.
