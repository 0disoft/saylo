import { getContext, setContext } from 'svelte';
import type { StoreSnapshot } from '@0disoft/saylo-core';
import type { AppSchema } from './generated';

function read(snapshot: StoreSnapshot<AppSchema>, name: string) {
  const { t } = snapshot;
  // Project the complete shared view before any component renders a label.
  return {
    home: t('demo:home'), about: t('demo:about'), heading: t('demo:heading'), description: t('demo:description'),
    aboutHeading: t('demo:aboutHeading'), aboutBody: t('demo:aboutBody'), formTitle: t('demo:formTitle'),
    name: t('demo:name'), note: t('demo:note'), openDialog: t('demo:openDialog'),
    dialogTitle: t('demo:dialogTitle'), dialogNote: t('demo:dialogNote'), closeDialog: t('demo:closeDialog'),
    rich: snapshot.tParts('demo:rich', { name }),
  };
}

export type DemoMessages = ReturnType<typeof read>;

export function projectDemoMessages(snapshot: StoreSnapshot<AppSchema>, previous: StoreSnapshot<AppSchema> | undefined, name: string) {
  try { return { messages: read(snapshot, name), locale: snapshot.locale, accepted: snapshot, error: '' }; }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let messages: DemoMessages = {
      home: '미리보기', about: '연결 설명', heading: '번역을 준비하세요.',
      description: '기준 로케일의 demo.json에 필요한 키와 인자를 채우고 저장하세요.',
      aboutHeading: '번역을 준비하세요.', aboutBody: '번역 파일을 수정하고 저장하면 이 화면도 복구됩니다.',
      formTitle: '입력 미리보기', name: '이름', note: '메모', openDialog: '확인 창 열기',
      dialogTitle: '입력 확인', dialogNote: '확인 메모', closeDialog: '닫기',
      rich: [],
    };
    let locale = 'ko';
    if (previous) { try { messages = read(previous, name); locale = previous.locale; } catch { /* Keep the explicit setup view. */ } }
    return { messages, locale, accepted: undefined,
      error: `${message}\n로케일 파일의 키·인자를 확인하고 다시 저장하세요. 입력은 유지됩니다.` };
  }
}

// The key is shared; the getter and last-good snapshot belong to one layout/request.
const key = Symbol('Saylo demo presentation');
type DemoView = { readonly current: ReturnType<typeof projectDemoMessages> };
export const setDemoView = (view: DemoView) => setContext(key, view);
export const getDemoView = () => getContext<DemoView>(key);
