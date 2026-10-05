# Saylo 설계 리뷰 반영 기록

이 문서는 1차 설계 리뷰의 발견을 어떻게 반영하거나 보류했는지 기록한다. 실행 코드와 벤치마크가 없으므로 반영 여부는 문서 계약 수준의 판단이다.

## 반영

| 리뷰 항목 | 반영 위치 | 내용 |
| --- | --- | --- |
| 신규 namespace 경로 | 03, 05 | 개발은 범용 `loadCatalog(locale, namespace)`와 mutable manifest handle로 처리. 정적 loader map은 운영 전용 |
| `t` union 키 | 03 | `TypedCall` tuple로 키·인자 상관관계 유지. typed 경로에 넓은 `string` overload 없음 |
| Snapshot 메타 불완전 | 02, 03, 08 | transport 상태(내부), 카탈로그 레코드(불변), UiSnapshot(공개), BootSnapshot(wire) 4종 분리. `UiSnapshot.catalogs`는 CatalogRecord 맵 |
| resync 범위 | 08 | snapshot 요청에 현재 desired locale·namespace·requestId·generation 포함. 응답이 outcome·schema·tombstone 반환 |
| locales 의미 충돌 | 08 | `availableLocales`/`availableNamespaces`는 매번 전체 목록(replacement) |
| base 변경과 기존 호출부 | 04, 05 | schema-compatible는 DOM 보존 보장, schema-breaking은 즉시 적용 + 진단, 서버 재시작 reload는 제외 |
| React 타입과 읽기 snapshot | 02, 03 | `createSayloReact<AppSchema>()` factory, hook t는 선택한 immutable UI snapshot에 바인딩 |
| JS 인자 검증과 번역 인자 추가 | 03, 04 | 인자 이름은 base 부분집합, 생략 번역도 호출 시 base 필수 인자 검증(JS 포함), `InvalidArgumentError` |
| 로케일 전환·namespace 경쟁 | 04, 08 | desired-state generation으로 조정. 정상 동시 호출은 서로 reject하지 않음 |
| 전송 상태가 UI identity 강제 | 02 | registryRevision·session·dirty를 내부 transport로 이동 |
| base 전체 삭제와 파일별 커밋 | 02 | 안정화한 파일 집합으로 후보 registry 판정, 배치 단위 게시/거부 |
| `[]`와 `.d.ts` 보장 범위 | 02, 05 | `[]`는 훅 처리 범위의 방식일 뿐 전체 그래프 보장이 아님. 생성·임시 파일은 감시 범위에서 제외 |
| Vite 재연결 reload | 05 | 정상 번역 변경의 무리로드와 서버 재시작 후 복구를 분리. 서버 재시작 reload는 DOM 보존 범위 밖 |
| 연결·정리 소유권 | 02, 03, 05 | Vite가 watcher/socket 소유. Saylo는 자신의 listener·route·channel binding만. `connectDev`는 단일 binding + idempotent disposer |
| `fallbackLocale` 미정의 | 03, 04 | 옵션 제거. fallback 대상은 baseLocale 하나 |
| warm latency 범위 | 03, 04, 06 | 메시지 formatter 캐시와 `Intl` 캐시 분리, unchanged 메시지 재사용, warm 정의 명시 |

## 보류

| 항목 | 근거 |
| --- | --- |
| message delta 전송 | 대규모 fixture 벤치마크 후 판단한다. MVP는 전체 replacement |
| selector 미세구독 | 후속 최적화. MVP는 instance 단위 구독 |
| 사용하지 않는 메시지 제거 | 동적 t 키와 충돌한다. 정적 사용 증명 경로가 필요하다 |
| rich text | 값 문법과 타입 계약이 커진다. 순수 텍스트를 먼저 지원한다 |
| 다단계 fallback | 로딩·스키마·포맷 출처까지 함께 설계해야 한다 |
| 추가 프레임워크 어댑터 | 코어가 중립이므로 후속으로 붙인다 |

## 타입 계약 확인

- TS 6.0.3 in-memory strict 검사에서 원본 `t` 선언의 union 키 오류를 재현했다. union 키 호출이 인자를 잃고 통과했다.
- 수정된 공개 선언을 문서에서 추출해 최종 in-memory strict 검사했다. TypeScript 6.0.3에서 TS 10개·typed JS 6개 소비 사례가 diagnostics 0, filesWritten 0으로 통과했다. 정상 호출·union narrowing은 허용하고 필수 인자 누락·잘못된 타입·상관관계가 없는 union 호출은 거부했다.
- 이 결과는 선언의 타입 검사다. 실제 라이브러리 실행, React hydration, 갱신 이벤트 경쟁, 성능 벤치마크는 구현 이후 검증한다.

## 문서 검사

- Markdown 12개, 로컬 링크 45개, JSON 예제 5개를 확인했다. UTF-8·코드 블록 닫힘·파일 끝 개행 검사도 통과했다.
- 모든 문서는 40 KiB 이하이며 `git diff --check`를 통과했다.
