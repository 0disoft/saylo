# 개발 동기화 상태 (`onSyncState`)

## 범위

[`@0disoft/saylo-vite/client`](../packages/vite/README.md)의 `connectDev`가 개발 서버와의 handshake 상태를 `onSyncState(state)`로 알린다. eager 경로(`ConnectDevOptions`)와 lazy 경로(`ConnectLazyDevOptions`)가 같은 `DevSyncState`를 쓴다.

이 문서는 로컬 작업트리의 미게시 변경을 설명한다. 현재 게시본은 `0.1.0-alpha.4`이고 이 API는 그 게시본에 포함되지 않는다.

## 타입

```ts
interface DevSyncState {
  readonly status: 'idle' | 'connecting' | 'retrying' | 'connected' | 'disconnected' | 'failed' | 'stopped';
  readonly attempt: number;   // 현재 handshake 시도, 또는 마지막 실패 시도
  readonly maxAttempts: 3;
}
```

각 state는 `Object.freeze`된 새 객체다. `attempt`는 `connecting`에서 1, `retrying`에서 2·3, `failed`에서 마지막 시도값이고 `idle`·`connected`·`disconnected`·`stopped`에서는 0이다.

## 예제

```ts
import { connectDev } from '@0disoft/saylo-vite/client';
import type { DevSyncState } from '@0disoft/saylo-vite/client';

const disconnect = connectDev(store, {
  hot: import.meta.hot,
  onSyncState: (state: DevSyncState) => {
    if (state.status === 'failed') {
      console.warn(`동기화 ${state.attempt}/${state.maxAttempts}회 실패, 마지막 정상 상태 유지`);
    }
  },
});
```

## 상태

| status | 언제 | attempt |
| --- | --- | --- |
| `idle` | 아직 첫 요청 전 | 0 |
| `connecting` | 첫 시도 진행 중 | 1 |
| `retrying` | 재시도 진행 중 | 2·3 |
| `connected` | 클라이언트가 서버 snapshot(manifest) 수락 | 0 |
| `disconnected` | 개발 서버 소켓 끊김 | 0 |
| `failed` | 시도 소진 또는 첫 전송 실패 | 마지막 시도 |
| `stopped` | stop·dispose 뒤 | 0 |

## 의미와 책임 한계

`DevSyncState`는 handshake 상태이지 앱 렌더 상태가 아니다. `connected`는 클라이언트가 서버의 eager snapshot 또는 lazy manifest를 수락했다는 뜻이고, 개별 lazy catalog `loadCatalog` 성공이나 화면에 번역이 그려졌다는 뜻이 아니다. 로케일 파일 진단은 `onDiagnostic`이 계속 맡고 `onSyncState`와 별개다.

eager 경로는 production에 hot context가 없으면 `connectDev`가 noop을 돌려주고 상태 콜백을 부르지 않는다. lazy 경로에서 `createDevCatalogSource`가 만든 source는 `getSyncState()`·`subscribeSyncState()`를 제공한다. `DevCatalogSource` 인터페이스에서는 이 둘이 선택 메서드라서 이 API 이전에 작성한 외부 source와 타입 호환이 유지된다. bridge는 `source.getSyncState?.()`·`source.subscribeSyncState?.()`로 접근하므로 두 메서드가 없는 source에서도 동작한다.

`subscribeSyncState`는 구독 시점에 현재 상태를 재생하지 않는다. `connectDev`의 lazy bridge는 구독을 건 뒤 `getSyncState()`로 현재 상태를 한 번 전달하고 그 뒤 변경만 전달한다. `stop()`·`dispose()` 뒤에는 bridge가 콜백을 더 부르지 않는다. source의 `subscribeSyncState`를 직접 건 소비자는 `stopped`를 받을 수 있다.

상태 observer가 던진 예외는 `onDiagnostic`으로 보고하고 handshake·타이머 정리·다른 observer는 계속 진행한다. 첫 전송에서 던지면 상태는 `failed`(attempt 1)가 되고 기존과 같이 `connectDev`가 예외를 다시 던지며 binding을 해제한다.

`LiveDiagnostic`에는 `operation?: 'handshake' | 'observer'`가 있다. `handshake`는 동기화 처리 오류, `observer`는 상태 관측 콜백·eager 갱신 구독자·eager/lazy `onUpdate` 콜백의 오류다. lazy bridge는 `source.getCatalogs()`를 콜백 보호 밖에서 읽고 `onUpdate`만 감싸므로, 최초 `onUpdate`가 던져도 binding이 유지되고 완료된 로케일 전환을 reject하지 않는다. 그 오류를 보고하는 `onDiagnostic`이 던져도 갱신은 이어진다. lazy instance의 다른 직접 구독자(`I18n.subscribe`) 오류는 기존 코어 경로로 전달된다. eager store 갱신에서 발생한 구독자 `AggregateError`는 bridge가 `observer`로 분류한다. 서버가 보내는 카탈로그 진단에는 이 필드가 없다. 예제 UI는 `handshake` 문구만 `connected`에서 해제하고 카탈로그 진단은 따로 유지한다.

재시도 정책은 바뀌지 않았다. 요청당 기본 타임아웃 5000ms(`requestTimeoutMs`), 최대 3회 시도, 새 소켓 연결이나 응답 갭에서 재시도한다. 수동 재시도 API는 없다.
