# 81. 구현 현황과 잔여 범위

이 문서는 2026-10-23의 `main` `464392f5abc869bb81ece211dd23fd24e7789819`(`464392f`)를 기준으로 현재 구현 위치와 릴리스 경계를 정리한다. 초기 로드맵 1~13단계는 구현 완료 상태이며, 단계별 완료 기준은 [06](06-validation-and-roadmap.md)에 남아 있다. 이 문서는 최근에 1~13단계 전체를 다시 실행했다고 주장하지 않는다.

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

## 잔여와 릴리스 경계

- core selector API는 선택 후속 항목이다. React·Svelte selector는 현재 소스에 구현돼 있으며, core 공통 selector API의 후속 여부는 별도 결정이다.
- 다단계 fallback과 component 인자 보간은 비목표다.
- Vue 어댑터는 구현돼 있지만 `packages/vue`의 `private: true` workspace이며 게시 대상이 아니다.
- 최신 alpha.5 후보의 제품 소스 `4765870`은 현재 `464392f`보다 오래됐고 현재 개선을 포함하지 않는다. 이 후보의 검증 기록은 당시 상태의 역사 기록으로만 사용한다.
- 실제 앱 pilot, 새 후보 동결·검증, 버전 승격과 게시는 이 구현 현황과 별도 작업이다.

## 성능과 검증의 해석

[75](75-early-disk-rechecks.md)의 성능 수치는 2026-10-11의 역사 측정값이다. 이 문서는 현재 HEAD에서 같은 조건을 다시 측정했거나 성능 목표를 달성했다고 주장하지 않는다.
