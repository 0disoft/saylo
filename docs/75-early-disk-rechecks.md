# 75. 이른 디스크 재확인 (`08b1d7c`, `eb66af8`)

## 범위

[74](74-immutable-validation-reuse.md) 뒤에 Vite watcher가 짧은 throttle 창의 두 번째 저장을 놓치는 문제를 꼬리 60ms 재확인보다 앞에서 잡으려 한 시도를 기록한다. 제품 source 변경은 `packages/vite/src/disk-rechecks.ts` 하나이고, 계측은 `benchmarks/live-update/profile.mjs`와 benchmark 전용 프로브에 있다.

확인한 것은 두 단계 제품 변경의 계약과 테스트 통과, enqueue origin 분해, 같은 하네스의 small·large ABBA 비교, 로케일 목록 단발이다. 성능 판정은 이 조건들에 한정하고 전체 원인 확정·메모리·릴리스는 주장하지 않는다. 관측은 2026-10-11(KST)이고 Node v24.18.0·Vite 8.3.2·headless Chromium·React 19.3.0 development mode다.

## 코드

### 계측 (`c184fcb`)

- `benchmarks/live-update/profile.mjs`가 `DiskRechecks.verify`를 별도 `AsyncLocalStorage` origin으로 감싸 `LiveRegistry.enqueue`의 호출 출처와 offset을 남긴다. 실제 꼬리 재확인은 `disk-recheck`, 밖에서 들어온 읽기는 `external-enqueue`로 나뉜다.
- 외부 enqueue는 실제 OS watcher 이벤트를 동반한다는 보장이 없어, 두 경로를 한 bucket으로 세면 꼬리 지연 원인을 잘못 귀속한다. 이 구분이 tail 판정의 근거다.
- 프로브 `benchmarks/live-update/enqueue-origin.test.mjs` 1개가 external-enqueue origin·hasReader, disk-recheck origin·hasReader, `offsetMs >= 0`, 계측 전후 product dist hash 불변을 확인한다(부모 실행 PASS).

### 제품 (`08b1d7c` → `eb66af8`)

- `08b1d7c`는 기존 60ms 재확인 앞에 10ms 이른 확인을 붙였다. 변경이 잡히면 두 timer를 취소하고 enqueue하고, 이른 확인이 일치하면 꼬리 재확인을 남긴다. 변경이 없으면 stat 한 번이 늘고 parser는 변경된 경우에만 돈다.
- `eb66af8`는 30ms 중간 확인을 더해 현재 10/30/60 세 단계다. 10·30이 일치해도 60ms guard를 남기고, 어느 단계에서든 변경이 잡히면 세 timer를 취소한 뒤 enqueue한다. reset·stop도 세 timer를 취소한다.
- stat 시간과 timer 분해능 때문에 10/30/60이 정확히 그 시각에 도는 것은 아니다. 공개 API·의존성·버전은 그대로이고 `08b1d7c`의 `packages/vite/package.json` 변경은 `test` 스크립트에 `test/disk-rechecks.test.mjs`를 더한 한 줄뿐이다.

## 검증

- `08b1d7c` timer mock 3개(`early change`, `change after early match`, `reset and stop`)와 전체 Vite 104개·benchmark 4개·build가 PASS했다.
- `eb66af8` timer unit 4개(`early change`, `change after early match`, `change after middle match`, `reset and stop`)를 포함한 Vite plugin·server·timer 합계 54개가 PASS했고, 비교용 스냅샷에서 모듈 hash를 대조해 `dist/disk-rechecks.js`만 다른 것을 확인했다.
- 실제 watcher SSR rapid-recovery 5개(`json-0-a`·`json-60`·`json-0-b`·`schema-0`·`valid-0`)가 모두 `recovered: true`다. 이 문서 작성자는 테스트를 재실행하지 않았고 부모 결과를 옮겼다.

## 관측 결과

### enqueue origin 분해 (`c184fcb`)

- 상세 계측 조건 small(1k×3) 25표본의 enqueue 25건은 disk-recheck 13건, external-enqueue 12건이다. 각 그룹의 saveToAck 범위는 64.98~83.84ms와 9.04~14.19ms다. 느린 꼬리가 실제 재확인 쪽에 몰린 근거다.
- 같은 조건의 runtime probe·tail 기록 p95는 83.28·80.35ms다. 이것은 상세 계측 조건 수치이고 [74](74-immutable-validation-reuse.md)의 일반 조건 small 108.61ms를 대체하는 성과 판정이 아니다.

### 10ms 단독 단계 (`08b1d7c`)

- 같은 하네스에 `disk-rechecks.ts`만 치환한 fresh Vite/browser ABBA(before·after·after·before)는 pooled p50 21.42→62.69ms, p95 83.81→86.23ms이고 두 변형 모두 100ms 이내 50/50이다.
- run별 p50이 before 21.42·64.74ms, after 66.55·62.69ms로 흔들리고 목표 달성은 같으므로 10ms 단독 단계는 개선 증거가 없어 채택하지 않는다.

### 30ms 보완 3단계 (`eb66af8`)

- 같은 ABBA 조건(before `c184fcb`, after `eb66af8`)의 small pooled는 p50 19.43→17.61ms, p95 82.05→49.57ms이고 after 두 run p95는 45.97·50.16ms, 두 변형 모두 100ms 이내 50/50이다.
- large(10k×20)는 before p95 85.60ms→after 80.25ms이고 after run p95가 80.25·76.30ms다. after 50표본 중 49개가 100ms 이내이고 최대 101.93ms다.
- 이번 조건에서 두 크기 모두 p95 목표를 통과했다. large는 run별 부하 변동이 섞여 있어 인과로 단정하지 않는다.

### 로케일 목록 단발 (`eb66af8` 제품)

- 목록은 small p95 77.46ms(최대 100.57ms)·large p95 177.83ms(최대 374.94ms)이고 25표본씩 단발이라 양쪽 p95가 250ms 목표 안이다. 선택 번역은 small p50/p95 18.60/28.98ms·large 158.90/227.98ms다.

## 해석과 한계

- 10ms 단독 구성은 이 조건에서 이득을 보이지 않았고 최종 구성은 10/30/60ms 세 단계다. 채택 근거는 small·large ABBA와 로케일 목록 단발이다.
- 10·30이 일치해도 60ms guard가 남으므로 확인 뒤 늦게 오는 저장은 여전히 꼬리 재확인이 잡는다. 세 번 stat이 도는 비용과 timer 분해능은 측정하지 않았다.
- large 비교는 run별 편차가 크고 로케일 목록은 단발이라 안정 달성을 주장하지 않는다. 메모리·RSS·릴리스는 다루지 않았다.

## 원본과 재현

- origin 분해 [origins](../benchmarks/results/validation-cache-small-origins-2026-10-11.json)·[samples](../benchmarks/results/validation-cache-small-origins-2026-10-11.1k-3-locales.samples.json)
- 10ms 단계 [small ABBA](../benchmarks/results/early-rechecks-small-comparison-2026-10-11.json)·[rapid recovery](../benchmarks/results/early-rechecks-rapid-recovery-2026-10-11.json)
- 3단계 [small ABBA](../benchmarks/results/midpoint-rechecks-small-comparison-2026-10-11.json)·[large ABBA](../benchmarks/results/midpoint-rechecks-large-comparison-2026-10-11.json)·[rapid recovery](../benchmarks/results/midpoint-rechecks-rapid-recovery-2026-10-11.json)·[locale add](../benchmarks/results/midpoint-rechecks-locale-add-2026-10-11.json)

```powershell
npm run build
node benchmarks/live-update/locale-compare.mjs --baseline c184fcb --current eb66af8 --experiment early-rechecks --mode edit --scenario 1k-3-locales --out benchmarks/results/midpoint-rechecks-small-comparison-current.json
node benchmarks/live-update/locale-compare.mjs --baseline c184fcb --current eb66af8 --experiment early-rechecks --mode edit --scenario 10k-20-locales --out benchmarks/results/midpoint-rechecks-large-comparison-current.json
```

## 상태

제품 source는 `08b1d7c`·`eb66af8`에 있고 공개 API·의존성·버전은 그대로다. comparison 코드·원시 자료는 `05b1fe6`, 로케일 원시 자료는 `a763e80`에 있고 제품 커밋 `eb66af8`은 미푸시다.
