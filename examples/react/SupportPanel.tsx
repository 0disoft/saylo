import { useState } from 'react';
import type { DevSyncState, SupportRecorder } from '@0disoft/saylo-vite/client';

export function SupportPanel({ recorder, syncState }: { recorder: SupportRecorder; syncState: DevSyncState | undefined }) {
  const [report, setReport] = useState('');
  const [status, setStatus] = useState('');
  function generate() {
    setReport(JSON.stringify(recorder.getReport(), null, 2));
    setStatus('진단 자료를 만들었습니다. 내용을 확인한 뒤 필요한 곳에 직접 복사하세요.');
  }
  function clear() {
    recorder.clear();
    if (syncState) recorder.onSyncState(syncState);
    setReport('');
    setStatus('이전 오류 기록과 생성한 자료를 지웠습니다. 현재 연결 상태는 유지합니다.');
  }
  return <details id="support-panel" lang="ko">
    <summary>문의용 진단 자료</summary>
    <p className="hint">번역 원문·파일 경로·입력값을 제외한 최근 오류 코드와 연결 상태를 모읍니다. 자동 전송하지 않습니다. Node 버전은 개발·빌드 환경 기준입니다.</p>
    <button id="support-export" type="button" onClick={generate}>진단 자료 만들기</button>
    <button id="support-clear" type="button" onClick={clear}>오류 기록 지우기</button>
    <label>검토하고 복사할 JSON<textarea id="support-report" className="code" rows={8} readOnly spellCheck={false} value={report} /></label>
    <p id="support-status" role="status">{status}</p>
  </details>;
}
