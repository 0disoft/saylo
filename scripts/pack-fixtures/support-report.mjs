import { createSupportReport, createSupportRecorder, connectDev } from '@0disoft/saylo-vite/client';
import { createStore } from '@0disoft/saylo-core';

const recorder = createSupportRecorder({ runtime: 'node', node: '24.18.0' });
recorder.onDiagnostic({ message: 'PRIVATE_FIXTURE', operation: 'handshake', diagnostics: [] });
recorder.onSyncState({ status: 'failed', attempt: 3, maxAttempts: 3 });
const report = recorder.getReport();
if (JSON.stringify(report).includes('PRIVATE_FIXTURE') || report.events.length !== 1 || report.syncState?.status !== 'failed')
  throw new Error('Packed support report leaked message text or lost observations.');
if (createSupportReport().schemaVersion !== 'saylo.support/v1') throw new Error('Missing support report contract.');
recorder.clear();
if (recorder.getReport().events.length !== 0) throw new Error('Support recorder clear failed.');
export function checkSupportTypes() {
  // @ts-expect-error report events are immutable in TS and checkJs
  report.events.push({});
  // @ts-expect-error arbitrary environment fields are not accepted
  createSupportReport({ environment: { token: 'PRIVATE_FIXTURE' } });
  const store = createStore({ baseLocale: 'ko', locale: 'ko', catalogs: [] });
  const stop = connectDev(store, { onSyncState: state => {
    recorder.onSyncState(state);
    // @ts-expect-error synchronization states are immutable
    state.status = 'failed';
  } });
  stop(); store.dispose();
}
console.log('[pack] Support report exports, sanitized observations and clear passed.');
