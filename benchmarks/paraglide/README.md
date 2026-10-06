# Paraglide 개발 반영 비교

저장소 루트의 React·ReactDOM·Vite 설치를 그대로 사용한다. Paraglide와 React Fast Refresh plugin은 이 디렉터리에 별도로 설치하며 제품 패키지의 의존성에는 넣지 않는다.

```sh
npm --prefix benchmarks/paraglide ci --workspaces=false --no-audit --no-fund
node benchmarks/paraglide/run.mjs --samples 10 --warmup 2 --calibrations 10 --timeout-ms 300000 --out benchmarks/results/paraglide-edit.json
node benchmarks/live-update/run.mjs --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/saylo-comparison-edit.json
```

두 명령은 동시에 실행하지 않는다. Saylo는 기존 workspace build가 필요하다. 시나리오와 기본 50회·warmup 5·control 25 옵션은 Saylo harness와 같다. `--scenario`, `--browser`, `--timeout-ms`, `--out`도 지원한다.

## 조건

- 동일한 fixture 생성기를 사용한다. 로케일당 1,000개×3 또는 10,000개×20 메시지, 로케일별 JSON 파일 1개, 영어 `probe` 값 1개 수정이다. `probe`와 변경하지 않은 `message1`만 화면에 표시한다.
- Paraglide 2의 Vite plugin, React Fast Refresh, 개발 기본 `locale-modules` 출력, 기본 cookie/globalVariable/baseLocale 전략을 쓴다. `emitTsDeclarations: false`인 기본 JS/JSDoc 타입 추론 경로를 측정한다. Saylo의 선언 파일 생성과 동일한 typegen 작업량이라는 뜻은 아니다.
- 설치된 message-format plugin을 fixture에 복사해 쓴다. CDN 요청을 반복 측정이나 startup에 섞지 않는다. 번역 값은 두 도구가 공통으로 처리하는 문자열과 단순 `{name}`이다. ICU 전체 지원을 비교하지 않는다.
- 초기 project 메타 파일 생성과 사전 compile은 `fixturePreparationMs`에 따로 기록한다. 이후 Vite boot·브라우저 boot도 분리한다. 사전 compile이 있으므로 cold startup 비교에는 사용할 수 없다.
- compiler의 공개 Vite hook 완료를 기다려 편집 회차를 겹치지 않게 한다. hook Promise가 끝난 후 100ms 안정 구간은 다음 편집 시작 전에만 두며 저장→ack 측정에서 제외한다. 제품 compiler 소스와 생성물을 계측 목적으로 수정하지 않는다.
- Node `writeFile` 완료→DOM commit 후 HTTP ack body 수신을 같은 monotonic clock으로 잰다. ack 전달 비용을 포함하고 control 왕복 값을 빼지 않는다. 브라우저의 commit→ack dispatch는 별도 clock이다. paint는 측정하지 않는다.
- document별 UUID로 재로딩을 센다. 첫 document에서만 input value와 React state를 변경해 기준을 만들고, 재로딩 후 다시 주입하지 않는다. 입력 노드·값·컴포넌트 상태 보존을 각 회차에 기록한다.
- 원시 sample은 warmup을 포함하며 요약에서 제외한다. p95는 nearest-rank다. 10회 p95는 최대값이므로 넓은 분포나 안정적인 목표 달성을 주장할 수 없다.
- 선택 파일 SHA-256, 두 lockfile, 실제 도구 버전과 Git 작업 상태를 기록한다. 종료 시 browser process tree·Vite를 닫고 소유한 임시 fixture와 browser profile만 지운다.

## 로케일 추가 모드

```sh
node benchmarks/paraglide/run.mjs --mode locale-add --scenario 1k-3-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/paraglide-locale-small.json
node benchmarks/live-update/run.mjs --mode locale-add --scenario 1k-3-locales --samples 10 --warmup 2 --calibrations 10 --out benchmarks/results/saylo-comparison-locale-small.json
```

새 en-GB 디렉터리에 bench.json을 쓴 뒤 settings.locales에도 en-GB를 추가한다. 저장→목록 측정은 **두 저장이 모두 끝난 시점**부터 select option을 DOM에서 확인한 HTTP ack까지다. 파일 저장과 settings 저장 사이도 raw sample에 남긴다. 디렉터리 생성과 내용 준비는 제외한다. Saylo는 settings 변경이 필요 없으므로 동일한 파일 개수의 저장 실험은 아니다.

목록 확인 뒤 `/selecting` 요청을 서버가 받은 시점부터 기본 `setLocale('en-GB')`의 첫 번역 commit ack까지 잰다. 기본 document navigation을 그대로 사용한다. 다른 document의 browser clock을 빼지 않으므로 브라우저 setter→commit은 보고하지 않는다. 초기 boot에서만 en을 `reload:false`로 설정하며 실제 측정·en 복귀는 기본 setter다.

en으로 복귀한 뒤 settings에서 en-GB를 빼고 파일·디렉터리를 삭제한다. option 제거와 compiler idle을 확인한 뒤 다음 회차를 시작한다. 생성된 locale 함수가 선택 전에 전송될 수 있으므로 Saylo의 cold full catalog 로드와 같은 작업이 아니다. catalog wire 바이트나 미로드 조건을 강제로 맞추지 않는다.

목록 표시·선택 단계의 reload 횟수와 처음 만든 입력 노드·값·React 상태의 보존 여부를 각각 남긴다. 초기 기준 상태는 warmup을 포함한 실행 첫 document에서만 만든다. 초기화·삭제 직후 지연된 reload도 document 총수에 포함하지만 두 측정 구간의 reload 수에는 넣지 않는다.

다른 compiler 옵션, production bundle·SSR, i18next/Wuchale 위 얇은 계층의 계약 충족 여부는 이 벤치마크의 범위가 아니다. 대규모 초기 compile 실패 기록은 [비교 문서](../../docs/13-paraglide-comparison.md)를 따른다.

공식 근거: [Vite 설정](https://paraglidejs.com/vite), [로케일 전략](https://paraglidejs.com/basics), [inlang 설정](https://inlang.com/docs/settings). 실제 설치 버전의 기본 출력과 compiler hook은 설치된 package 소스에서도 확인했다.
