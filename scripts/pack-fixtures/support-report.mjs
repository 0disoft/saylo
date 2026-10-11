import { createSupportReport, createSupportRecorder } from '@0disoft/saylo-vite/client';

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
}
console.log('[pack] Support report exports, sanitized observations and clear passed.');
