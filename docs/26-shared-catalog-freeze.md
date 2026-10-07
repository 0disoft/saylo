# 26. 전송 카탈로그의 깊은 동결 경로 공유

[25](25-core-outcome-acceptance-stages.md)에서 동결 비용이 Vite와 코어 두 곳에서 중복 발생함을 확인했다. 본 기록은 카탈로그 동결 경로를 코어로 통합하고 그 효과를 측정한 결과를 담는다.

## 구현

core `src/catalog-freeze.ts`에 `freezeCatalogs(catalogs: readonly ParsedCatalog[]): readonly ParsedCatalog[]`를 추가했다. 이 함수는 기존 `diagnostics.freeze`에 위임하며, 완전히 순회·동결된 객체를 모듈 지역 WeakSet으로 공유한다. `core/runtime`에서 내보내고 core 루트 배럴을 통해 노출한다.

Vite `src/freeze.ts`는 기존 `freezeCatalogs` 래퍼와 공개 API를 유지하되 core `runtime`의 `freezeCatalogs`로 위임한다. Vite가 직접 하던 `Object.isFrozen` 순회를 코어 순회로 대체한다. 공유 카탈로그는 한 번만 순회·동결되고 코어가 표시를 남기므로, 이후 코어 `acceptOutcome`은 카탈로그 트리를 다시 방문하지 않고 outcome과 key만 복사·동결한다.

동결은 입력 배열을 그대로 반환하고 AST·메시지·스키마·위치 참조를 보존한다. 외부에서 얕게 동결된 객체는 순회하여 자식을 동결하며, `Object.isFrozen`만으로 신뢰하지 않는다. 동결은 카탈로그 형상이나 스키마를 검증하지 않고, 기존 디코딩·수용·번역기 검증은 바꾸지 않았다. 버전·의존성 변경과 푸시·배포는 없다. 새 런타임 헬퍼는 로컬에만 있고 공개된 0.1.0-alpha.1에는 없다. 별도 코어 모듈 사본은 다시 안전하게 순회하며, 최적화는 같은 코어 모듈 로드 내 신뢰만 공유한다.

## 검증

Vite 회귀 테스트 두 개를 추가했다. 하나는 Vite→코어 동결→`acceptOutcome` 구간에서 중첩 리터럴 getter 읽기 횟수를 세어 정확히 1로 유지되는지, 코어 신뢰 노드와 동일 참조인지 확인한다. 다른 하나는 얕게 동결된 카탈로그와 배열, 중첩 ICU plural·date skeleton·tag를 사용해 재귀적 `Object.isFrozen`과 코어 신뢰, 정확한 JSON 값·위치, 변경 거부를 확인한다. TS·checkJs 소비자 케이스는 헬퍼 가용성과 readonly 리스트를 검사하고, TS는 스키마를 카탈로그로 넘기는 입력을 거부한다.

core/react/typegen의 workspace 테스트와 Vite 전체 79개 테스트를 통과했다. 신규 테스트에서 파서의 null-prototype 맵과 JSON 전송 후 일반 맵을 비교하던 부분을 고친 뒤 `npm run test --workspace=@0disoft/saylo-vite`를 재실행했다. `npm run build`, `npm run typecheck:consumers --workspaces`, 계측 테스트 5개도 통과했다.

`npm run release:check -- --version 0.1.0-alpha.1 --tag alpha`로 네 패키지의 배포 메타데이터·의존성 버전·라이선스도 확인했다. 버전을 올리거나 게시하지 않았다.

`npm run verify:pack`은 네 tarball을 별도 JS/TS 설치에서 소비하며 함수의 루트/runtime 동일성, 얕은 동결, 번역·인자 오류, React SSR, typegen, Vite lazy build를 통과했다. 별도 소비자 설치는 같은 메이저 범위의 Vite 8.3.3을, benchmark는 Vite 8.3.2를 썼다. 프로덕션 AST runtime 빌드에는 ICU 문자열 파서가 포함되지 않았다.

## 측정과 해석

동일 기기(Windows/Node 24.18.0/Ryzen 5 7430U/Vite 8.3.2/React 19.3.0/HeadlessChrome 154, 2026-10-07 KST)에서 측정했다. 리비전 a52631a, 작업 트리 변경은 `workingTreeStatus`와 codeHashes로 식별했다. before를 먼저, after를 나중에 순차 실행했고, before는 `workingTreeStatus`에 미반영 소스 편집이 보여도 예전 프로덕트 dist를 측정했다. 양쪽 모두 `locale-add --browser-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10`으로 동일하게 실행했다. typegen 켜짐, Saylo prebundle 꺼짐, React prebundle 켜짐, CPU/서버 프로파일링 꺼짐. 계측 함수 경계는 같고 after의 run.mjs는 새 catalog-freeze.js와 runtime.js를 추가로 해시할 뿐 타이밍 경계는 바뀌지 않았다.

모든 시간의 단위는 ms이다.

| 단계 | before p50 | before p95 | after p50 | after p95 |
| --- | ---: | ---: | ---: | ---: |
| Vite 동결 | 46.40 | 51.80 | 84.80 | 308.60 |
| 코어 acceptFreeze | 73.10 | 320.20 | 0.00 | 0.00 |
| 합산 동결 | 119.60 | 368.10 | 84.80 | 308.60 |
| 선택 커밋 | 247.80 | 491.70 | 237.90 | 486.70 |
| 리스트 ack | 258.39 | 462.08 | 364.71 | 556.27 |
| 선택 기타(참고) | 92.40 | 135.70 | 112.70 | 138.20 |

before는 변경 전 제품 dist, after는 변경 후 빌드된 dist로 각각 실행했다.

```sh
node benchmarks/live-update/run.mjs --mode locale-add --browser-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-shared-freeze-before.json
node benchmarks/live-update/run.mjs --mode locale-add --browser-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-shared-freeze-after.json
```

각 실행은 원시 12회/측정 10회, 고유 토큰, 8단계 각각 표본당 호출 수 1, 선택 전 대상 응답 0건, 선택 후 saylo-catalog-v1 전체 응답 1건, 응답 p95 1,241,401 B, 추가 JSON 387,783 B였다. 10k 메시지×초기 로케일 20개, 네임스페이스 1개이다. 입력 노드·값·React 상태와 생성 선언의 mtime·크기를 유지했고 리로드 없이 리셋·제거를 완료했다. 소규모 편집(측정 2+warmup 1)과 계측을 끈 locale-add(1+0)는 기능을 검증했다. 외부 pack 설치 중 실행한 smoke의 시간을 대표 성능으로 사용하지 않는다. 원시 수·요약·잔여·호출·wire·hash를 대조했고 임시 fixture·browser가 남지 않았음을 확인했다.

core acceptFreeze의 after p50·p95 0.00ms는 시계 정밀도 아래의 관측이다. 비용 일부는 첫 Vite 동결로 옮겨갔다(중앙값 46.40→84.80ms). 표본별 `freezeMs + acceptFreezeMs`를 계산한 뒤 nearest-rank로 요약한 합계 p50은 119.60→84.80ms(29.10% 감소), p95는 368.10→308.60ms(16.16% 감소)였다. p95끼리 더하지 않는다.

선택→DOM commit p50은 247.80→237.90ms, p95는 491.70→486.70ms로 낮게 관측됐다. 목록 ack p50은 258.39→364.71ms, p95는 462.08→556.27ms로 높게 관측돼 목록 250ms 목표는 미달이다. 서버·파서는 바꾸지 않았고 목록 차이의 원인은 분리하지 못했다. 무작위 순서의 반복 비교가 아니므로 전체 시간 차이를 코드 효과로 확정하지 않는다.

10회 nearest-rank p95는 최댓값이다. 함수의 경과 시간은 runtime 일시정지·GC와 계측 비용을 포함하고 이들을 차감하지 않는다. 프로세스 시계는 서로 빼지 않는다. 중첩 구간의 p95를 더하거나, prebundle 설정이 다른 계측/일반 실행을 직접 비교하지 않는다.

측정으로 중복 순회 제거 자체는 확인했으나, 종단 간 성능은 더 넓은 재측정이 필요하다. 한계는 단일 기기·단일 네임스페이스·dev·헤드리스·단일 DOM 프로브이며 페인트와 콜드 스타트는 제외한다.

원시는 [before 요약](../benchmarks/results/locale-add-shared-freeze-before.json)·[표본](../benchmarks/results/locale-add-shared-freeze-before.10k-20-locales.samples.json), [after 요약](../benchmarks/results/locale-add-shared-freeze-after.json)·[표본](../benchmarks/results/locale-add-shared-freeze-after.10k-20-locales.samples.json), [표본별 동결 합계](../benchmarks/results/locale-add-shared-freeze-comparison.json)에 있다. [편집 smoke](../benchmarks/results/shared-freeze-edit-smoke.json)와 [계측 끔 smoke](../benchmarks/results/shared-freeze-disabled-smoke.json)도 보존한다. 문서의 로컬 링크·코드 블록·40KB 이하 크기와 `git diff --check`를 확인했다.

## 다음 작업

다음은 일반 prebundle 설정에서 상세 계측을 끄고 small/large 종단 간 시간을 재측정하는 작업이다. 추가 최적화 없이 현재 목록·첫 번역 반영 시간을 확인한다. 선택 잔여에는 전송·서버·WS 파싱·기타 client·React가 포함되며 필요하면 이후에 구간을 나눈다.
