# Vanilla 데모

Saylo Vite 플러그인을 최소 구성으로 쓰는 예제다. 명령은 저장소 루트에서 실행한다.

## 개발 서버

```sh
npm run dev
```

전체 스키마와 전체 카탈로그를 쓰고, `locales/`의 파일을 저장하면 화면에 바로 반영한다.

## 운영 빌드

기본 빌드는 메시지를 모두 담아 `examples/vanilla/dist/`에 쓴다.

```sh
npm run build:demo
```

선택 빌드는 `selected-keys.mjs`의 `demoKeys`에 있는 키만 담아 `examples/vanilla/dist-selected/`에 쓴다.

```sh
npm run build:demo:selected
npm run preview:demo:selected
```

`preview:demo:selected`는 `examples/vanilla/dist-selected/`를 127.0.0.1에서 띄운다.

이 화면은 `demoKeys`의 키를 모두 쓰므로 원본 예제만 빌드하면 기본 빌드와 선택 빌드의 크기가 같다. 차이는 사용하지 않는 키가 있을 때만 난다.

## 선택 키 관리

`demoKeys`는 이 화면이 실제로 쓰는 키를 손으로 적어 둔 목록이다. `data-message`·`data-placeholder` 값과 코드에서 직접 부르는 `t()` 키(`demo:summary` 등)를 모두 넣는다. 빠뜨린 키를 운영에서 부르면 `UnknownMessageError`가 난다. 화면에 키를 더하거나 빼면 이 목록도 같이 고치고 다시 빌드한다. `includeKeys`는 게시본 `0.1.0-alpha.4`에는 없고, 이 기능이 추가되기 전 커밋 `2037f9a` 기준으로 동결한 `0.1.0-alpha.5` 후보 tarball에도 없다. 아직 게시되지 않은 기능이다.

## 선택 빌드 검증

```sh
npm run verify:demo:selected
```

Chrome이나 Chromium이 필요하고, 기본 경로에 없으면 `SAYLO_CHROME` 환경변수로 실행 파일 경로를 지정한다. vanilla fixture를 임시 복사본으로 만들고, 사용하지 않는 키를 언어별로 100개 더한다. 같은 fixture에서 기본 빌드와 선택 빌드의 minified 결과를 비교하고, 실제 Chromium으로 ko/en 전환, 복수형, 폼, dialog 상태 유지도 확인한 뒤 `.release/selective-build-report.json`에 기록한다. 여기 크기 차이는 합성 fixture 값이라 일반적인 개선율로 보면 안 된다.
