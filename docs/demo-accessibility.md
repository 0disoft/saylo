# 데모 접근성 검사

## 실행

```sh
npm run verify:demo:a11y
npm run verify:demo:a11y -- --framework npm
```

`--framework` 없이 돌리면 vanilla·react·svelte·npm·sveltekit 다섯을 순서대로 검사하고, `--framework <name>`으로 하나만 고를 수 있다. Chromium이나 Chrome이 필요하고 `CHROME_BIN`으로 다른 실행 파일을 지정할 수 있다. Node 24에서 돌리고 `examples/npm`·`examples/sveltekit`은 의존성 설치가 선행돼야 한다.

`scripts/verify-demo-accessibility.mjs`가 Vite dev 서버를 띄우고 `scripts/demo-accessibility-browser.mjs`가 페이지 안에서 스캔한다. 실제 렌더를 열어 ko·en × dialog 닫힘·열림 네 상태를 프레임워크마다 보므로 모두 20회다. axe-core 4를 페이지에 넣고 `wcag2a`·`wcag2aa`·`wcag21a`·`wcag21aa`·`wcag22aa`·`best-practice` 태그로 `runOnly` 스캔한다([axe-core API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)). 지원 자료 패널이 있는 예제는 패널을 열고 자료를 생성한 뒤 스캔한다.

사용자 로케일 파일은 고치지 않는다. SvelteKit은 앱 사본과 임시 브라우저 프로필로 돌리고 끝나면 지운다.

## 결과와 한계

결과는 `.release/accessibility-report.json`에 frameworks별 violations·incomplete·passedRules와 브라우저 상태로 남는다. 규칙 위반이 하나라도 있으면 exit 1이다. `incomplete`는 통과가 아니므로 사람이 따로 확인한다.

개발 렌더 기준이다. 스크린리더 발음, 키보드만 쓰는 조작, 확대, production 빌드 검증이 아니다. `npm run check`나 CI job에 자동 연결하지 않은 선택 명령이다.

## 현재 상태

기준선 `.release/accessibility-before.json`(5프레임워크 × 4상태)에서 실패는 examples/npm 모달 열림의 ko·en 두 건뿐이었고, `#close-dialog.secondary`가 color-contrast 4.46:1(`#2f7a63` on `#e8f1ec`, 13px)이었다. secondary foreground를 `#24614e`로 바꿨다. 나머지 예제는 위반 0·incomplete 0이었다.

2026-10-12 수정 후 최종 20상태는 위반 0·incomplete 0이었다. 브라우저에서 확인한 닫기 버튼 색의 대비는 6.30:1이다. npm 예제의 생산 빌드와 수명 회귀 3건도 통과했다. 실행 범위와 전후 결과는 [demo-accessibility-acceptance-2026-10-12.json](../review/demo-accessibility-acceptance-2026-10-12.json)을 본다.
