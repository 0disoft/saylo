# 데모 운영 번들 측정

저장소의 실제 vanilla·React 예제를 `astRuntime:false`와 `true`로 각각 Vite production build한다. 두 예제 config의 `createDemoConfig`를 재사용하며 `write:false`로 기존 `dist`를 건드리지 않는다. React config의 typegen은 그대로 실행하고 생성 파일을 포함한 측정 입력의 hash가 바뀌지 않았는지 확인한다.

```sh
npm run build
node benchmarks/bundle-size/run.mjs
```

선택적으로 첫 인자에 결과 JSON 경로를 지정한다. 기본은 [../results/demo-bundle-size.json](../results/demo-bundle-size.json)이다. 조건·결과 해석은 [../../docs/10-performance-measurements.md](../../docs/10-performance-measurements.md)를 따른다.

- Vite 기본 minification을 적용한 client JS의 UTF-8 바이트와 청크별 gzip(level 9) 바이트 합을 기록한다. HTML·CSS·source map·HTTP 헤더·Brotli·SSR·로드 시간은 측정하지 않는다.
- `initial`은 HTML 진입 JS와 그 청크가 정적으로 import하는 JS의 재귀 합이다. `deferred`는 그 밖의 emitted JS 청크 합이다. 공유 청크는 한 번만 센다. 모든 deferred 청크를 사용자가 실제로 내려받는다는 뜻은 아니다.
- vanilla는 `virtual:saylo` eager, React는 `virtual:saylo/lazy`와 `initialNamespaces:['demo']`다. 두 앱 모두 `ko`로 시작하며 같은 `examples/vanilla/locales`(ko·en, namespace demo)를 쓴다. React에서 en 번역은 동적 import다.
- 각 앱 안에서 `astRuntime:false→true`의 차이를 본다. React 전체 크기에는 React·ReactDOM과 데모 UI 코드가 포함된다. vanilla와 React의 합계를 Saylo 런타임 크기로 비교하지 않는다.
- 네 빌드 모두 실제 청크 graph에서 초기·지연 JS를 나누고, parser 오류 표식 `EXPECT_ARGUMENT_CLOSING_BRACE`가 false에서 존재하고 true에서 사라지는지 확인한다. vanilla에 지연 청크가 없고 React에 있는지도 확인한다.
- 결과에는 환경·기준 revision·작업 트리 상태·측정 입력 hash·청크 hash·imports/dynamicImports·개별 청크 크기를 남긴다. config·harness 수정이 있는 작업 트리에서 측정했으면 `gitRevision`만으로 측정 코드를 식별하지 않는다.
- 빌드별 session UUID가 무작위이므로 재실행 시 output hash와 gzip 크기는 조금 달라질 수 있다. 이 기록은 저장소 예제의 한 번 측정이며 일반 앱·다른 bundler·다른 데이터 규모에 대한 보장이 아니다. parser 제거는 로컬 구현이며 게시된 `0.1.0-alpha.1`에 없다.
