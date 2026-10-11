import type { DevSyncState } from '@0disoft/saylo-vite/client';

export function formatDevSyncState(state?: DevSyncState): string {
  if (!state || state.status === 'idle') return '개발 서버에 연결 중입니다.';
  switch (state.status) {
    case 'connecting': return `문구를 동기화하는 중입니다 (${state.attempt}/${state.maxAttempts}).`;
    case 'retrying': return `문구 동기화를 재시도합니다 (${state.attempt}/${state.maxAttempts}).`;
    case 'connected': return '개발 서버에 연결됐습니다. 파일을 저장하면 문구를 자동 갱신합니다.';
    case 'disconnected': return '개발 서버 연결이 끊겼습니다. 다시 연결될 때까지 마지막 화면을 유지합니다.';
    case 'failed': return `문구 동기화에 실패했습니다 (${state.attempt}/${state.maxAttempts}). 개발 서버와 연결 상태를 확인하세요. 마지막 화면을 유지합니다.`;
    case 'stopped': return '개발 동기화 연결을 종료했습니다.';
  }
}
