# 76. 런타임 형태 결정

관측일 2026-10-11(KST). 이 문서는 제품 형태 결정을 짧게 남긴다. 실무 architecture 결정이며, 독립 런타임만 가능하다는 필요성 정리도 전체 API 동등성 증명도 아니다.

## 결정

- 현행 Saylo 독립 런타임을 유지한다.
- FormatJS parser와 `intl-messageformat`(IMF) 재사용을 그대로 이어간다.
- i18next 확장점 위 prototype은 제품으로 채택하지 않는다. 이 prototype은 비교용 private 실험이며 제품 package·공개 API·게시본에 넣지 않는다.
- 이 결정은 특정 도구의 전체 불가능 판정이 아니다. probe가 호출한 범위에서 관측한 계약·비용 차이다.

## 근거: 계약 차이

- native i18next는 fixed `t`가 새 resource를 관측하고, fallback ICU가 선택 locale을 쓴다(Saylo는 base locale). base 인자 생략도 거부하지 않는다([56](56-thin-layer-contract-probe.md), 36개 관측).
- Wuchale 0.26.7은 compiled positional은 동작하지만 probe가 호출한 named ICU 입력은 literal로 남는다. missing positional 인자를 거부하지 않고, 새 module 반영과 isolated module snapshot 보유·깊은 불변도 관찰값과 차이가 있다. Wuchale 전체가 불가능하다는 주장이 아니다.
- 얇은 계층은 시간대를 공개 `i18nFormat` 직접 구현으로 고정해야 했다([64](64-thin-layer-timezone-adapter.md)). parser-free 경로는 private AST rewrite glue가 필요했다([65](65-thin-layer-ast-production.md)).

## 근거: 자체 복잡도

- prototype은 lazy source cache·coordinator·hydration barrier·errors·schema·parser·typegen·transport를 자체로 요구한다([67](67-thin-layer-lazy-contracts.md)~[72](72-thin-layer-sync-construction.md)). vendor engine을 붙여도 이 대부분은 제거되지 않는다.
- 검증 범위는 각 문서 범위다. SSR hydration host case 12([66](66-thin-layer-ssr-production.md)), lazy 기초 14 시나리오 × core·async·sync 42 + sync 생성자 8 + scope·hydration·timezone 14 = 64([72](72-thin-layer-sync-construction.md)), production·dev·lazy·typegen·session 검증([65]·[66]·[68]·[70]·[71]·[73]). 오류 코드·전체 API 동일성은 확인하지 않았다.

## 근거: 최신 비용·production

- 격리 Node 런타임 비용([73](73-thin-layer-runtime-cost.md), 원시 `thin-layer-runtime-cost-validation-cache-2026-10-11.json`): 10k commit p50/p95는 core 14.55/23.49ms, layer 23.23/34.24ms다. 옛 snapshot 8개 보유 delta는 core 4.35~4.57MB, layer 7.70~7.72MB다. live steady heap delta는 10k에서 core 2.19MB, layer 1.49~1.52MB다. layer가 모든 메모리 지표에서 높다고 주장하지 않는다.
- 조건은 준비된 불변 catalog 2개(locale 2·namespace 1), ABBA 2 run/variant, 옛 snapshot 8개 검증이다. 각 commit은 refresh와 번역 단언 3개를 측정하고 hot read는 별도 1500회다. 100ms·250ms 종단 간 목표값이 아니다.
- 실제 production vector probe(`thin-layer-production-decision-2026-10-11.json`): build 4개에서 core gzip 17,054B·layer-ast gzip 37,873B(둘 다 parser marker false), unminified 70,930·154,930 bytes이고 format 12 케이스 × 4 = 48이 전부 통과다. 작은 fixture 범위의 bundle 비교다.
- 기본 계약 프로브 36개는 현재 native 팩 버전과 같다(`thin-layer-contracts-decision-2026-10-11.json`).
- 루트 `npm run check` 최근 exit 0이고 package JS/TS·React 예제 타입 검사가 통과했다. 전체 테스트 개수는 따로 집계하지 않았다.
- 실제 종단 간([75](75-early-disk-rechecks.md))은 편집 small 49.57ms·large 80.25ms로 p95 목표 안이고 로케일 목록은 77.46·177.83ms다.

## owned message map 동결 ([49](49-owned-message-map-freeze.md))

- parser 소유 깊은 불변 children만 신뢰하고 외부 shallow map은 일반 freeze한다.
- 49의 parser incremental 교차 비교 이득을 유지한다. cold 일관성 이득은 주장하지 않는다.
- 현행 full check의 관련 deep immutability 테스트 통과와 최신 E2E를 참고해 기존 최적화를 유지한다. 최신 E2E 결과를 49 단독 효과로 귀속하지 않는다.
- 추가 trial을 반복할 필요는 없다.

## 현재 상태

- package 버전은 alpha.3이다. selector 로컬 구현은 alpha.3 이후이고 게시하지 않았다. 기존 원격 관측(10/09 이력)과 구분한다.
- 이 결정은 새 원격 상태나 게시 완료를 뜻하지 않는다.

## 재검토 조건

- 같은 base argument·old immutable snapshot·source fallback·timezone·atomic lazy·SSR·typegen을 coordinator 중복 없이 제공하면서 현재와 같은 scale의 비용·가벼운 production 증거가 있을 때 다시 본다.

## 근거 문서

- [49](49-owned-message-map-freeze.md), [56](56-thin-layer-contract-probe.md), [64](64-thin-layer-timezone-adapter.md), [65](65-thin-layer-ast-production.md), [66](66-thin-layer-ssr-production.md), [67](67-thin-layer-lazy-contracts.md), [68](68-thin-layer-lazy-browser.md), [69](69-thin-layer-typegen.md), [70](70-thin-layer-lazy-production-browser.md), [71](71-thin-layer-lazy-session-browser.md), [72](72-thin-layer-sync-construction.md), [73](73-thin-layer-runtime-cost.md), [74](74-immutable-validation-reuse.md), [75](75-early-disk-rechecks.md)
- 원시: `benchmarks/results/thin-layer-runtime-cost-validation-cache-2026-10-11.json`, `benchmarks/results/thin-layer-production-decision-2026-10-11.json`, `benchmarks/results/thin-layer-contracts-decision-2026-10-11.json`
