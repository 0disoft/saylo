# 24. 첫 언어 선택의 full 응답 브라우저 계측

로케일 추가 모드에 첫 언어 선택의 브라우저 구간 계측을 추가했다. 대규모 10회에서 수집한 동기 구간 중 동결이 매회 가장 컸다. 중앙값은 full 디코딩 7.60ms·동결 39.60ms·snapshot 생성 18.00ms였다. 전체 선택 시간의 잔여 중앙값은 141.60ms로 더 커서 다음 계측 대상이다. 제품 source·dist는 변경하지 않았다.

## 실행과 조건

```sh
node benchmarks/live-update/run.mjs --mode locale-add --browser-stages --scenario 10k-20-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/locale-add-browser-stages.json
node --test benchmarks/live-update/browser-profile.test.mjs
```

2026-10-07 KST, Node 24.18.0, Windows x64, Vite 8.3.2, React 19.3.0, HeadlessChrome 154, Ryzen 5 7430U에서 실행했다. warmup 2회·측정 10회·control 10회이며 CPU·서버 상세 계측은 끈다. 초기 10k 메시지×20개 로케일·20개 파일·JSON 7,755,280 B이고, namespace 하나와 387,783 B의 새 en-GB 파일 하나를 매회 사용한다. typegen은 켠다.

측정 기준 revision은 `d53b7a58b5507414ab928f1bc33b042fa9f442d3`이다. 그 위의 benchmark 변경은 workingTreeStatus·코드 hash로 식별한다. 직전의 빌드된 제품 dist를 사용했으며 제품 모듈 hash는 [23번 일반 설정 run](23-position-sharing-locale-add.md)과 같다. 원시는 [요약](../benchmarks/results/locale-add-browser-stages.json)과 [12회 표본](../benchmarks/results/locale-add-browser-stages.10k-20-locales.samples.json)에 있다.

이 옵션은 변환이 prebundle에 숨지 않도록 Saylo core·React adapter·Vite client의 prebundle을 끈다. React·ReactDOM은 계속 prebundle한다. 계측 없는 기존 50회 run과 직접 전후 비교하지 않고, 이후 최적화 비교에는 동일 옵션을 사용한다. clock/counter 비용도 포함한다.

## 수집 경계

Vite transform으로 브라우저가 가져오는 제품 모듈을 메모리에서만 감싼다. module transform 적용 여부와 모드별 필수 호출을 확인한다. edit 모드는 기존 patch 구간을 요구하고 locale-add는 decode 구간을 요구한다. full 선택에 patch 호출을 요구하지 않는다.

`beginBrowserSample('locale-add')`은 목록 DOM ack·선택 준비 제어 응답 뒤 setLocale 직전에 시작한다. 첫 번역 DOM commit의 useLayoutEffect에서 종료한다. 초기 boot·목록 추가·en 복귀·삭제는 해당 브라우저 sample에서 제외한다.

| 지표 | 실제 경계 |
| --- | --- |
| decodeMs | Vite decodeCatalogResult 호출. compact 형식 검사와 AST·위치 객체 복원을 포함한다. WS JSON.parse는 범위 밖이다 |
| freezeMs | Vite freezeCatalogs 호출. 수신 카탈로그의 깊은 동결이다. core의 별도 동결은 이 경계 밖이다 |
| snapshotMs | core createLoadedSnapshot 호출. translator·signature를 포함한다 |
| translatorMs | createBoundTranslator 호출. 기준/번역 계약 검증과 번역기 구성을 포함한다 |
| signatureMs | snapshot 안의 createLoadedSignature 계산 |
| snapshotOtherMs | 각 sample에서 snapshot−translator−signature로 계산한 잔여 |
| selectionOtherMs | 각 sample에서 브라우저 선택→commit−decode−freeze−snapshot으로 계산한 잔여 |

잔여를 먼저 계산한 뒤 요약한다. snapshot과 그 안의 translator/signature p95를 더하지 않는다. selectionOther는 서버 응답 준비·전달 대기, WS JSON 파싱, 미계측 client 검증/동결과 React commit 등을 포함하며 네트워크 시간으로 단정하지 않는다. Node·브라우저 clock은 서로 빼지 않고 control 왕복도 차감하지 않는다.

## 결과

| 항목 | p50(ms) | p95(ms) |
| --- | --- | --- |
| 선택→첫 번역 commit(브라우저) | 217.60 | 277.90 |
| full 디코딩·compact 검사 | 7.60 | 9.00 |
| Vite 카탈로그 동결 | 39.60 | 47.60 |
| snapshot 생성(아래 2개 포함) | 18.00 | 31.70 |
| translator 생성·검증 | 13.30 | 26.80 |
| signature 계산 | 4.70 | 6.80 |
| snapshot 잔여 | 0.00 | 0.00 |
| 선택 잔여 | 141.60 | 219.70 |
| 저장→목록 DOM ack | 181.26 | 402.60 |
| 선택 준비→첫 번역 ack(Node) | 220.88 | 280.98 |
| control 왕복 | 3.01 | 5.13 |

nearest-rank 통계이며 10회 p95는 최대값이다. snapshot 잔여 0은 수집 clock의 정밀도 아래 잔여가 구분되지 않았다는 뜻이며 실제 다른 CPU 작업이 없다는 주장이 아니다.

각 sample에서 선택 잔여/선택→commit 비중은 최소 64.15%·중앙 66.79%·최대 79.06%였다. 수집한 decode·freeze·snapshot 구간 중 freeze는 10회 모두 가장 컸지만 이 값들만으로 전체 선택 병목을 확정하지 않는다. 목록 250ms 이내는 8/10회였고 p95는 402.60ms로 목표를 넘었다. 옵션·표본 수·부하가 다른 이전 run의 878.98ms와 비교해 성능 개선을 주장하지 않는다.

## 검증과 다음 작업

대규모 모든 회차에서 decode·freeze·snapshot·translator·signature는 각각 정확히 1회였다. 선택 전 target 응답은 0개, 선택 뒤 compact full 응답은 1개였고 응답 JSON p95는 1,241,401 B였다. 입력 노드·값·React 상태와 생성 `.d.ts`의 mtime·size를 유지했고 document reload 없이 en 복귀·삭제까지 완료했다.

작은 full 계측 2회는 [locale-add-browser-stages-smoke.json](../benchmarks/results/locale-add-browser-stages-smoke.json), 기존 patch 편집 계측 2회는 [live-update-browser-stages-regression-smoke.json](../benchmarks/results/live-update-browser-stages-regression-smoke.json), 계측을 끈 기본 모드 1회는 [locale-add-browser-disabled-smoke.json](../benchmarks/results/locale-add-browser-disabled-smoke.json)에 보존한다. 기본 모드는 browserStages 필드를 내보내지 않는다. 계측 전용 테스트 3개로 full/patch 모드 구분·reset 제외·누락 호출·잘못된 timing/잔여 거부를 확인했다.

네 run의 raw 수·요약·호출 수·잔여·전송 조건·현재 코드 hash를 대조했고 임시 fixture/profile과 benchmark browser process가 남지 않았음을 확인했다. `npm run test --workspaces`와 `npm run typecheck:consumers --workspaces`를 통과했다. 제품 코드 변경이 없어 build·release check·pack은 반복하지 않았다. 문서의 로컬 링크·코드 블록·40KB 이하 크기와 `git diff --check`도 확인했다.

다음은 선택 잔여를 더 나누는 작업이다. 우선 snapshot 전에 수행하는 core acceptOutcome의 계약 확인·동결을 기존 브라우저 계측에 추가한다. 서버 full 응답 생성과 WS JSON 파싱·수신 이후 구간도 필요하면 별도로 기록한다. 각 프로세스의 clock을 유지하고, 이번 잔여만으로 특정 항목을 원인으로 확정하지 않는다. 단일 장비·단일 namespace·정상 번역·probe 한 메시지의 DOM commit이며 paint·전체 메시지 렌더·cold startup은 범위 밖이다.
