import { memo, useEffect, useRef, useState } from 'react';
import type { StoreSnapshot } from '@0disoft/saylo-core';
import { renderRichText } from '@0disoft/saylo-react';
import type { RichTextRenderers } from '@0disoft/saylo-react';
import { connectDev } from '@0disoft/saylo-vite/client';
import { catalogSource } from 'virtual:saylo/lazy';
import type { AppSchema } from './generated';
import { store, useI18n, useI18nSelector } from './i18n';
import { projectMessages } from './demo-messages';

const renderers: RichTextRenderers = {
  strong: children => <strong>{children}</strong>,
  link: children => <a href="#order-form">{children}</a>,
};
const SelectedLocale = memo(function SelectedLocale() {
  const locale = useI18nSelector(snapshot => snapshot.locale);
  return <span id="selected-locale">{locale}</span>;
});

export default function App() {
  const i18n = useI18n();
  const [name, setName] = useState('Saylo'), [note, setNote] = useState(''), [confirmation, setConfirmation] = useState('');
  const [diagnostic, setDiagnostic] = useState(''), [transitionError, setTransitionError] = useState('');
  const [pendingLocale, setPendingLocale] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null), lastGood = useRef<StoreSnapshot<AppSchema>>(undefined);
  const lifecycle = useRef({ active: true, generation: 0 });
  const view = projectMessages(i18n, lastGood.current, name || 'Saylo');
  useEffect(() => { if (view.accepted) lastGood.current = view.accepted; }, [view.accepted]);
  useEffect(() => { document.documentElement.lang = i18n.locale; }, [i18n.locale]);
  useEffect(() => {
    const owned = lifecycle.current;
    owned.active = true;
    const disconnect = connectDev(store, { catalogSource, onDiagnostic: value => setDiagnostic(value.message) });
    return () => { owned.active = false; owned.generation++; disconnect(); };
  }, []);
  async function selectLocale(locale: string) {
    const owned = lifecycle.current, generation = ++owned.generation;
    setPendingLocale(locale); setTransitionError('');
    try { await i18n.setLocale(locale); }
    catch (error) { if (owned.active && generation === owned.generation) setTransitionError(String(error)); }
    finally { if (owned.active && generation === owned.generation) setPendingLocale(undefined); }
  }
  const text = view.messages;
  return <>
    <main>
      <label lang="en">Locale <select id="locale" value={pendingLocale ?? i18n.locale} onChange={event => { void selectLocale(event.target.value); }}>
        {i18n.availableLocales.map(locale => <option key={locale} value={locale}>{locale}</option>)}
      </select></label>
      <p lang="en">Selected locale: <SelectedLocale /></p>
      <section id="order-form" lang={view.locale}>
        <h1 id="heading">{text.heading}</h1><p id="greeting">{text.greeting}</p>
        <p id="rich-preview">{renderRichText(text.rich, renderers)}</p>
        <label>{text.nameLabel}<input id="name" value={name} autoComplete="off" onChange={event => setName(event.target.value)} /></label>
        <label>{text.noteLabel}<textarea id="note" rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>
        <button id="open-dialog" onClick={() => dialog.current?.showModal()}>{text.openDialog}</button>
      </section>
      <p id="transition-error" role="alert" lang="ko">{transitionError}</p>
      <p id="error" role="alert" lang="ko">{diagnostic}</p>
      <p id="render-error" role="alert" lang="ko">{view.error}</p>
    </main>
    <dialog id="confirmation" ref={dialog} lang={view.locale} aria-labelledby="dialog-title">
      <form method="dialog">
        <h2 id="dialog-title">{text.dialogTitle}</h2>
        <label>{text.dialogNoteLabel}<input id="confirmation-note" value={confirmation} autoFocus autoComplete="off" onChange={event => setConfirmation(event.target.value)} /></label>
        <button id="close-dialog">{text.closeDialog}</button>
        <p role="alert" lang="ko">{diagnostic || view.error}</p>
      </form>
    </dialog>
  </>;
}
