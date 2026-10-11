# 데모 접근성 검사

## 실행

```sh
npm run verify:demo:a11y
npm run verify:demo:a11y -- --framework npm
npm run verify:demo:a11y -- --zoom 2
npm run verify:demo:a11y -- --zoom 4
```

`--framework` 없이 돌리면 vanilla·react·svelte·npm·sveltekit 다섯을 순서대로 검사하고, `--framework <name>`으로 하나만 고를 수 있다. Chromium이나 Chrome이 필요하고 `CHROME_BIN`으로 다른 실행 파일을 지정할 수 있다. Node 24에서 돌리고 `examples/npm`·`examples/sveltekit`은 의존성 설치가 선행돼야 한다.

`scripts/verify-demo-accessibility.mjs`가 Vite dev 서버를 띄우고 `scripts/demo-accessibility-browser.mjs`가 페이지 안에서 스캔한다. 실제 렌더를 열어 ko·en × dialog 닫힘·열림 네 상태를 프레임워크마다 보므로 모두 20회다. axe-core 4를 페이지에 넣고 `wcag2a`·`wcag2aa`·`wcag21a`·`wcag21aa`·`wcag22aa`·`best-practice` 태그로 `runOnly` 스캔한다([axe-core API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)). 지원 자료 패널이 있는 예제는 패널을 열고 자료를 생성한 뒤 스캔한다.

사용자 로케일 파일은 고치지 않는다. SvelteKit은 앱 사본과 임시 브라우저 프로필로 돌리고 끝나면 지운다.

`--zoom 1|2|4`는 임시 Chromium 프로필의 기본 페이지 확대를 100%·200%·400%로 설정한다. 1280×1024 창과 기기 배율 1을 기준으로 DPR·CSS 화면 폭·visualViewport 배율을 함께 검사해 실제 페이지 확대 적용을 확인한다. 페이지와 모달의 가로 넘침, 언어 변경 뒤 입력 보존, 모달 입력의 초기 포커스, 세로 스크롤 뒤 닫기 버튼 접근, 닫은 뒤 포커스 복귀도 검사한다. 입력과 버튼 조작은 페이지 안 테스트 코드가 실행한다. 기존 사용자 브라우저 프로필은 변경하지 않는다. 설정 근거는 [Chromium 확대 설정](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc)과 [배율 변환](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/common/page/page_zoom.cc)에 있다.

## 결과와 한계

결과는 `.release/accessibility-report.json`에 frameworks별 violations·incomplete·passedRules와 브라우저 상태로 남는다. 규칙 위반이 하나라도 있으면 exit 1이다. `incomplete`는 통과가 아니므로 사람이 따로 확인한다.

확대 모드는 `.release/accessibility-zoom-<factor>-report.json`에 결과와 화면 치수를 남긴다. 확대 적용·가로 넘침·조작 검사가 실패해도 exit 1이며, 모든 대상 검사가 통과해야 `runComplete`가 true다.

확대 모달의 대비가 incomplete이면 `contrastReview`에 원래 스크롤 위치, 텍스트 줄 경계와 줄마다 아홉 지점의 hit-test, 단색 배경의 계산 대비를 남긴다. 모달 위로 스크롤한 별도 뷰에서 대비만 다시 검사하고 원래 위치로 복귀한다. 최초 incomplete는 그대로 보존한다. 단색 배경을 판별할 수 없는 경우 계산 대비는 null이며, 계산값이나 샘플 지점만으로 전체 화면의 가림 여부를 단정하지 않는다.

개발 렌더와 headless Chromium 기준이다. 스크린리더 발음, 물리 키보드만 쓰는 조작, OS 글자 확대, 다른 브라우저, production 빌드는 별도 검증 범위다. `npm run check`나 CI job에 자동 연결하지 않은 선택 명령이다.

## 현재 상태

기준선 `.release/accessibility-before.json`(5프레임워크 × 4상태)에서 실패는 examples/npm 모달 열림의 ko·en 두 건뿐이었고, `#close-dialog.secondary`가 color-contrast 4.46:1(`#2f7a63` on `#e8f1ec`, 13px)이었다. secondary foreground를 `#24614e`로 바꿨다. 나머지 예제는 위반 0·incomplete 0이었다.

2026-10-12 수정 후 최종 20상태는 위반 0·incomplete 0이었다. 브라우저에서 확인한 닫기 버튼 색의 대비는 6.30:1이다. npm 예제의 생산 빌드와 수명 회귀 3건도 통과했다. 실행 범위와 전후 결과는 [demo-accessibility-acceptance-2026-10-12.json](../review/demo-accessibility-acceptance-2026-10-12.json)을 본다.

2026-10-12 페이지 확대 후속은 100%·200%·400% × 다섯 예제 × 한국어/영어 × 모달 닫힘/열림 60상태에서 위반 0이었다. CSS 화면 폭은 1262→631→315px, DPR은 1→2→4, visualViewport 배율은 모두 1이었다. 가로 넘침과 입력·모달 조작 검사도 통과했다. 다만 100%·200% npm 한국어 모달과 400% 다섯 영어 모달에서 제목·라벨의 겹침 또는 일부 가림 때문에 대비 판정이 incomplete로 남았다. 이 7상태는 대비 검사를 통과한 것으로 보지 않고 가림·겹침을 별도 확인한다. [확대 검증 기록](../review/demo-page-zoom-acceptance-2026-10-12.json)에 결과를 남겼다.

같은 7상태를 후속 검사했다. 400% 영어 모달 5건은 이전 닫기 조작으로 남은 스크롤 때문에 제목·라벨이 뷰 밖에 있었고, 위로 스크롤한 뷰에서는 텍스트 샘플이 보이고 대비 재검사도 통과했다. npm 한국어 제목 2건은 샘플 지점에서 가림이 없었고 흰 모달 배경과 계산 대비가 13.69:1이었지만 axe incomplete는 계속 남았다. 이 결과로 생산 CSS나 모달 동작을 바꾸지는 않았다. 원래 결과와 별도 뷰의 결과는 [대비 후속 검증](../review/demo-contrast-review-acceptance-2026-10-12.json)에 구분했다. 픽셀 단위 가림·실제 보조 기술 확인은 별도 범위다.
