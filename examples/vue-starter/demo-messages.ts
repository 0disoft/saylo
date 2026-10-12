import type { StoreSnapshot } from '@0disoft/saylo-core';
import type { AppSchema } from './generated';

function read(snapshot: StoreSnapshot<AppSchema>, name: string) {
  const { t } = snapshot;
  return { heading: t('demo:heading'), greeting: t('demo:greeting', { name }),
    nameLabel: t('demo:nameLabel'), noteLabel: t('demo:noteLabel'), openDialog: t('demo:openDialog'),
    dialogTitle: t('demo:dialogTitle'), dialogNoteLabel: t('demo:dialogNoteLabel'), closeDialog: t('demo:closeDialog') };
}

export function projectMessages(snapshot: StoreSnapshot<AppSchema>, previous: StoreSnapshot<AppSchema> | undefined, name: string) {
  try { return { messages: read(snapshot, name), locale: snapshot.locale, accepted: snapshot, error: '' }; }
  catch (error) {
    let messages = { heading: '번역을 준비하세요.', greeting: name, nameLabel: '이름', noteLabel: '메모',
      openDialog: '확인 창 열기', dialogTitle: '입력 확인', dialogNoteLabel: '확인 메모', closeDialog: '닫기' };
    let locale = 'ko';
    if (previous) {
      try { messages = read(previous, name); locale = previous.locale; } catch { /* Keep the setup view. */ }
    }
    return { messages, locale, accepted: undefined,
      error: `${error instanceof Error ? error.message : String(error)}\n번역 파일의 키·인자를 확인하고 다시 저장하세요.` };
  }
}
