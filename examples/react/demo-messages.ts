import type { StoreSnapshot } from '@0disoft/saylo-core';
import type { AppSchema } from './i18n';

function read(snapshot: StoreSnapshot<AppSchema>, count: number) {
  const { t } = snapshot;
  // Compute the complete view before React sees any translated label.
  return {
    heading: t('demo:heading'), description: t('demo:description'), formTitle: t('demo:formTitle'),
    name: t('demo:name'), namePlaceholder: t('demo:namePlaceholder'), note: t('demo:note'),
    notePlaceholder: t('demo:notePlaceholder'), count: t('demo:count'), summary: t('demo:summary', { count }),
    openDialog: t('demo:openDialog'), dialogTitle: t('demo:dialogTitle'), dialogNote: t('demo:dialogNote'),
    closeDialog: t('demo:closeDialog'),
  };
}

export function projectDemoMessages(snapshot: StoreSnapshot<AppSchema>, previous: StoreSnapshot<AppSchema> | undefined, count: number) {
  try { return { messages: read(snapshot, count), accepted: snapshot, error: '' }; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let messages = {
      heading: '번역을 준비하세요.', description: '기준 로케일의 demo.json에 필요한 키와 인자를 채우고 저장하세요.',
      formTitle: '입력 미리보기', name: '이름', namePlaceholder: '', note: '메모', notePlaceholder: '',
      count: '수량', summary: Number.isFinite(count) ? `수량 ${count}` : '수량을 입력하세요.',
      openDialog: '확인 창 열기', dialogTitle: '입력 확인', dialogNote: '확인 메모', closeDialog: '닫기',
    };
    if (previous) {
      // Its translator is immutable and remains bound to the last rendered schema.
      // Reformat with today's input rather than retaining yesterday's summary value.
      try { messages = read(previous, count); } catch { /* Keep the explicit setup view. */ }
    }
    return { messages, accepted: undefined,
      error: `${message}\n로케일 파일의 키·인자를 확인하고 다시 저장하세요. 입력은 유지됩니다.` };
  }
}
