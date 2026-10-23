# 83. push 구독 수명과 locale 재추가 검증

이 문서는 2026-10-24의 `main` `19640b9`에서 확인한 push 구독 유지보수와 benchmark 결과를 정리한 로컬 검증 기록이다. 제품 수정은 `a9e8b80`, benchmark 계측 수정은 `19640b9`에 있다. `19640b9`는 제품 동작을 바꾸지 않고 receipt와 서버 배치 경계를 보정했다.

이 작업의 실행 근거와 원시 결과 8개 파일의 hash는 [유지보수 후속 기록 `59ea8dd`](../review/maintenance-followup-2026-10-24.json)에 모았다.

## 재현 경로와 원인

재현은 다음 순서로 일어났다.

1. 대상 locale를 사용한 뒤 원래 locale로 돌아가 대상 locale의 모든 namespace 파일을 삭제한다.
2. 캐시에서 대상 locale pair가 제거된 뒤 같은 locale를 다시 추가한다.
3. 새 pair가 선택되기 전에 이전 서버 scope가 남아 있어 대규모 full catalog push가 도착한다.
4. benchmark가 request만 receipt로 세던 때는 이 push를 선택 전 transfer로 기록하지 못했다. 그 결과 선택 전 응답이 거짓 0건으로 보여 검증이 불충분했다.

원인은 manifest 갱신에서 evicted cache entry를 지운 뒤 서버 구독 scope를 다시 보내지 않은 것이다. 서버는 scope를 명시적으로 교체할 때까지 이전 구독을 유지했다.

## 제품 수정

`a9e8b80`은 [catalog-source.ts](../packages/vite/src/catalog-source.ts)에서 evicted pair를 계산해 cache에서 제거한 직후 `sendScope()`를 호출한다. 연결된 push client는 축소된 구독 scope를 받는다. 같은 locale를 다시 만들더라도 선택 전 full push를 받지 않고, 사용자가 선택할 때 fresh full 요청을 한 번 보낸다.

[push.test.mjs](../packages/vite/test/push.test.mjs)에 이 경로의 회귀 테스트를 추가했다. 새 테스트는 locale와 두 namespace pair를 제거한 뒤 다음을 확인한다.

- 서버 scope에서 evicted pair가 빠진다.
- locale를 다시 만들었을 때 선택 전 push에 해당 locale가 없다.
- 원래 locale를 유지한 채 새 locale를 선택하면 요청이 정확히 한 번 발생하고 새 번역을 읽는다.

새 테스트는 수정 전 실패했고 제품 수정 뒤 통과했다.

## 검증 범위

- push·lazy·sync-state와 receipt·profile 관련 테스트 8개 파일에서 62개 테스트가 통과했다.
- 수정 전 root 소스에서 `npm run build`가 통과했고, 제품 수정 뒤 `npm run build --workspace=@0disoft/saylo-vite`가 통과했다.
- 전체 536개 검사 재실행, 새 후보 동결, pack·tarball·registry 소비, 배포는 수행하지 않았다.

62개 검사는 이 수정 경로와 계측 변경을 확인한 범위다. 전체 suite나 새 후보의 수락 결과로 확대 해석하지 않는다.

## benchmark 계측 보정

`19640b9`의 benchmark 변경은 성능 수치를 만들기 전에 수신 경로와 배치 경계를 바로잡았다.

- edit와 locale-add receipt가 request `saylo:catalog`와 push `saylo:catalog-push`를 모두 인식한다.
- 선택 전 push도 locale-add transfer로 집계한다. 따라서 기존의 거짓 0건 통과를 재현하지 않는다.
- 서버 단계는 `boundaryVersion: 3`이다. drain timer 대신 실제 `startBatch` 진입에서 시작하고 `prepareTranslations` 또는 superseded·오류 batch의 `processBatch` 정착에서 끝낸다.
- browser stage transform은 현재 제품 모듈의 `immutableSnapshot` 경계를 계측한다.

이 변경은 benchmark 전용이다. 제품 performance가 개선됐다는 근거로 쓰지 않는다.

## 최종 50회 결과

측정은 warmup 5회, 표본 50회, calibration 25회, 상세 CPU·browser·reply·client 계측을 끈 조건이다. 두 규모 모두 `pushReplies` 50, `requestReplies` 0, `patchReplies` 50이며 한 번에 키 하나를 수정했다. edit의 입력·node·상태 보존과 생성 `.d.ts` 유지가 통과했다. locale-add는 두 규모 모두 선택 전 transfer 0건, 선택 뒤 full 응답 50건, declaration 미재작성을 확인했다.

| 모드·규모 | 지표 | p50 | p95 | 목표 | 판정 |
| --- | --- | ---: | ---: | ---: | --- |
| edit small(1k×3) | 저장→DOM ack | 22.60ms | 53.12ms | 100ms | 통과 |
| edit large(10k×20) | 저장→DOM ack | 400.00ms | 866.01ms | 100ms | 미달 |
| locale-add small(1k×3) | 저장→목록 ack | 56.44ms | 282.33ms | 250ms | 미달 |
| locale-add large(10k×20) | 저장→목록 ack | 227.13ms | 1,969.58ms | 250ms | 미달 |
| locale-add large(10k×20) | 선택→DOM commit | 531.80ms | 795.60ms | - | 성능 목표와 별도 기록 |

전송 및 보존 계약은 통과했지만 네 성능 목표 중 edit small만 통과했다. locale-add는 small과 large 모두 p95가 250ms 목표를 넘었다. large p50 227.13ms는 목표 안이었다.

locale-add의 file write p95는 small 568.74ms, large 403.51ms였다. wall time에 파일 I/O·스케줄링·장비 부하가 섞여 변동 폭이 크므로 이 값을 이전 결과나 상세 10회 결과와 직접 비교해 최적화 효과나 회귀를 주장하지 않는다.

## 상세 10회 진단

large locale-add에서 server file stage와 boundary v3를 켠 별도 10회 표본이다. warmup 2회, calibration 10회였으며 최종 50회 성능 결과와 같은 실행이 아니다.

| 구간 | p50 | p95 |
| --- | ---: | ---: |
| `queueToDrainMs` | 4.63ms | 18.52ms |
| `readAndCandidateMs` | 105.01ms | 356.17ms |
| `pathCheckMs` | 0.97ms | 4.81ms |
| `fileReadMs` | 1.50ms | 6.22ms |
| `catalogParseMs` | 96.03ms | 353.28ms |
| `candidateOtherMs` | 1.25ms | 39.65ms |
| `translationPreparationMs` | 12.14ms | 66.50ms |
| `validationMs` | 0.03ms | 0.04ms |

이 표본에서는 `readAndCandidateMs`의 대부분이 `catalogParseMs`로 기록됐다. 다만 단일 run이고 계측 overhead가 있으며 파일 구간의 wall time 변동도 크다. 파싱을 원인으로 확정하거나 최적화·회귀 효과를 주장하지 않는다. v3의 candidate·queue 값은 v2 이하와 직접 비교하지 않는다.

## 후보와 릴리스 경계

- `.release/candidate-0.1.0-alpha.5-fTJYGI`는 제품 source `d3e5252`를 대상으로 한 과거 동결 후보와 검증 기록이다. 해당 동결 입력에는 계속 유효하지만 `a9e8b80` 제품 수정을 포함하지 않는다.
- 현재 `main` package manifest는 공개 패키지 5개가 `0.1.0-alpha.4`, Vue가 `0.1.0-alpha.4`이며 `private: true`다. 버전 승격은 하지 않았다.
- git push, npm publish, workflow 실행은 하지 않았다. 새 후보 동결과 full suite, pack, 새 후보 tarball의 framework 브라우저 소비 인수, registry 소비 인수도 수행하지 않았다.
- 현재 source를 배포하려면 eviction 수정을 포함한 새 후보를 동결하고 전체 검증을 다시 통과시켜야 한다.

초기 locale 실행 결과는 push를 선택 전 transfer로 세지 못해 검증이 불충분했다. `.release/maintenance-locale-add-before-fix-2026-10-24.json`은 보존만 하며 정상 역사 결과나 성능 전후 비교에 사용하지 않는다.

## 원시 결과

- edit: [요약 JSON](../benchmarks/results/maintenance-edit-2026-10-24.json), [small samples](../benchmarks/results/maintenance-edit-2026-10-24.1k-3-locales.samples.json), [large samples](../benchmarks/results/maintenance-edit-2026-10-24.10k-20-locales.samples.json)
- locale-add: [요약 JSON](../benchmarks/results/maintenance-locale-add-2026-10-24.json), [small samples](../benchmarks/results/maintenance-locale-add-2026-10-24.1k-3-locales.samples.json), [large samples](../benchmarks/results/maintenance-locale-add-2026-10-24.10k-20-locales.samples.json)
- 상세 locale stages: [요약 JSON](../benchmarks/results/maintenance-locale-stages-2026-10-24.json), [large samples](../benchmarks/results/maintenance-locale-stages-2026-10-24.10k-20-locales.samples.json)

새 edit와 locale-add 50회 결과는 `19640b9` harness로 측정했다. 이전 run의 edit 수치를 현재 결과로 섞지 않는다. [75](75-early-disk-rechecks.md)의 역사 성능값도 변경하지 않는다.
