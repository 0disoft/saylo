const mode = new URL(location.href).searchParams.get('mode');
const errors = [], checks = [];
for (const level of ['warn', 'error']) {
  const original = console[level];
  console[level] = (...args) => { errors.push(args.map(String).join(' ')); original(...args); };
}
addEventListener('error', event => errors.push(event.message));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const check = (value, message) => { if (!value) throw new Error(message); };
const node = selector => document.querySelector(selector);
const wait = async (read, message) => {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (read()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message);
};
void (async () => {
  try {
    await wait(() => node('#greeting')?.textContent === (mode === 'dev' ? 'Hello Saylo' : 'Updated Saylo'), 'First render failed');
    checks.push('first-render');
    await wait(() => node('#rich-preview strong')?.textContent === 'Saylo', 'Initial rich text missing');
    const strong = node('#rich-preview strong'), link = node('#rich-preview a'), selected = node('#selected-locale');
    check(link?.getAttribute('href') === '#order-form', 'Rich link is not app-owned');
    checks.push('rich-render');
    check(selected?.textContent === 'en', 'Selected locale component missing');
    checks.push('selector-locale');
    const name = node('#name'), note = node('#note');
    name.value = 'Ada'; name.dispatchEvent(new Event('input', { bubbles: true }));
    note.value = 'Keep note'; note.dispatchEvent(new Event('input', { bubbles: true }));
    node('#open-dialog').click();
    const field = node('#confirmation-note');
    field.value = 'Keep dialog'; field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus(); field.setSelectionRange(2, 6);
    const preserved = () => {
      check(node('#name') === name && node('#note') === note && name.value === 'Ada' && note.value === 'Keep note', 'Form DOM/value reset');
      check(node('#confirmation').open && field.value === 'Keep dialog', 'Modal state reset');
      check(document.activeElement === field && field.selectionStart === 2 && field.selectionEnd === 6, 'Focus/selection reset');
      check(node('#rich-preview strong') === strong && node('#rich-preview a') === link, 'Rich nodes replaced');
      check(node('#selected-locale') === selected && selected.textContent === document.documentElement.lang, 'Selected locale did not stay in sync');
    };
    const locale = async (value, text) => {
      node('#locale').value = value; node('#locale').dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() => document.documentElement.lang === value && node('#greeting').textContent === text, 'Locale transition failed');
      preserved();
    };
    await locale('ko', '안녕 Ada');
    await locale('en', mode === 'dev' ? 'Hello Ada' : 'Updated Ada');
    checks.push('locale-switch');
    const action = async operation => {
      const response = await fetch('/__vue_starter_action', { method: 'POST', body: operation });
      check(response.ok, 'Fixture edit failed');
    };
    if (mode === 'dev') {
      await action('edit');
      await wait(() => node('#greeting').textContent === 'Updated Ada', 'Live edit did not render');
      preserved(); checks.push('live-edit');
      check(node('#rich-preview').textContent.includes('RICH_EDIT') && strong.textContent === 'Ada', 'Rich live edit failed');
      preserved(); checks.push('rich-live-edit');
      await action('rich-invalid');
      await wait(() => node('#render-error').textContent.includes('Invalid rich text'), 'Broken rich marker has no hint');
      check(node('#rich-preview').textContent.includes('RICH_EDIT'), 'Broken rich marker lost last good output');
      preserved(); checks.push('rich-invalid');
      name.value = '<img src=x>'; name.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => strong.textContent === '<img src=x>', 'Fallback rich output ignored current input');
      check(!node('#rich-preview img'), 'Rich argument became HTML');
      name.value = 'Ada'; name.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => strong.textContent === 'Ada', 'Rich input restoration failed');
      preserved(); checks.push('rich-fallback-input');
      await action('restore');
      await wait(() => node('#render-error').textContent === '', 'Rich marker repair failed');
      preserved(); checks.push('rich-restoration');
      await action('invalid');
      await wait(() => node('#error').textContent.length > 0, 'Invalid JSON has no diagnostic');
      check(node('#greeting').textContent === 'Updated Ada', 'Invalid JSON discarded last good translation');
      preserved(); checks.push('invalid-last-good');
      await action('restore');
      await wait(() => node('#error').textContent === '', 'Repair did not clear diagnostic');
      preserved(); checks.push('repair');
      await action('add-locale');
      await wait(() => [...node('#locale').options].some(option => option.value === 'ja'), 'New locale missing');
      await locale('ja', 'こんにちは Ada');
      await locale('en', 'Updated Ada');
      checks.push('new-locale');
      await action('add-key');
      await wait(() => node('#render-error').textContent === '' && node('#error').textContent === '', 'Schema extension failed');
      preserved(); checks.push('schema-edit');
    }
    node('#close-dialog').click();
    await wait(() => !node('#confirmation').open, 'Dialog close failed');
    checks.push('form-dialog-preserved');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    check(node('#name') === name, 'Persisted pagehide cleared the app');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    check(node('#root').children.length === 0, 'Page teardown did not unmount');
    checks.push('teardown');
    check(errors.length === 0, 'Runtime errors/warnings observed');
    await fetch('/__vue_starter_result', { method: 'POST', body: JSON.stringify({ ok: true, mode, checks, errors, browser: navigator.userAgent }) });
  } catch (error) {
    await fetch('/__vue_starter_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), mode, checks, errors }) });
  }
})();
