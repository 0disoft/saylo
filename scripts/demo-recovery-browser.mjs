const errors = [];
const checks = [];
addEventListener('error', event => errors.push(event.message || 'Resource load failed'));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
for (const level of ['error', 'warn']) {
  const original = console[level];
  console[level] = (...args) => { errors.push(args.map(String).join(' ')); original.apply(console, args); };
}
const check = (condition, message) => { if (!condition) throw new Error(message); };
const wait = async (condition, message) => {
  const end = performance.now() + 7000;
  while (!condition()) {
    if (performance.now() > end) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};
const node = selector => document.querySelector(selector);
const checkLanguages = translatedLocale => {
  const language = selector => node(selector)?.closest('[lang]')?.getAttribute('lang');
  for (const selector of ['h1', '#name', '#dialog-title']) check(language(selector) === translatedLocale, `${selector} has wrong translation language`);
  for (const selector of ['header', '#locale', '.preview > .hint', '#status', '#dialog-status', '#support-status']) {
    check(language(selector) === 'ko', `${selector} lost its Korean language`);
  }
  check(language('.brand span') === 'en', 'Demo subtitle lost its English language');
  for (const option of node('#locale').options) check(option.lang === option.value, 'Locale option has wrong language');
  const english = node('[aria-label="English catalog"]');
  if (english) check(english.lang === 'en', 'English catalog lost its language');
};
const fill = (selector, value) => {
  const element = node(selector);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};
const action = async body => { check((await fetch('/__demo_recovery_action', { method: 'POST', body })).ok, 'Mutation failed'); };
const locale = async value => {
  node('#locale').value = value; node('#locale').dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => document.documentElement.lang === value, 'Locale change did not finish');
};
void (async () => {
  try {
    await wait(() => node('#name'), 'Demo did not mount');
    checkLanguages('ko');
    if (new URL(location.href).searchParams.has('cold')) {
      await wait(() => node('#render-error')?.textContent.includes('demo:heading'), 'Cold empty catalog has no correction hint');
      check(node('h1').textContent === '번역을 준비하세요.', 'Cold empty catalog pretends to have a translation');
      checks.push('cold-empty-view');
      fill('#name', 'Cold user'); fill('#note', 'Cold draft');
      node('#order-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await wait(() => node('#confirmation').open, 'Cold correction view is not interactive');
      fill('#confirmation-note', 'Cold confirmation'); node('#confirmation-note').focus();
      const field = node('#confirmation-note'); const name = node('#name'); const dialog = node('#confirmation');
      checks.push('cold-interaction');
      await action('restore-all');
      await wait(() => node('#render-error')?.textContent === '' && node('h1')?.textContent === '번역을 바꿔도, 입력은 그대로', 'Cold empty catalog did not recover');
      check(node('#name') === name && name.value === 'Cold user', 'Cold repair reset the input');
      check(node('#note').value === 'Cold draft', 'Cold repair reset the note');
      check(node('#confirmation') === dialog && dialog.open, 'Cold repair reset the dialog');
      check(node('#confirmation-note') === field && field.value === 'Cold confirmation' && document.activeElement === field, 'Cold repair reset confirmation/focus');
      checks.push('cold-restoration');
      await fetch('/__demo_recovery_result', { method: 'POST', body: JSON.stringify({ ok: true, checks, errors, browser: navigator.userAgent }) });
      return;
    }
    fill('#name', 'Recovery user'); fill('#note', 'Keep this draft');
    node('#order-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(() => node('#confirmation').open, 'Dialog did not open');
    fill('#confirmation-note', 'Keep this confirmation');
    node('#confirmation-note').focus();
    node('#support-export').click();
    await wait(() => node('#support-report').value.length > 0, 'Support report missing');
    const reportText = node('#support-report').value;
    const name = node('#name'); const dialog = node('#confirmation'); const field = node('#confirmation-note');
    const preserved = () => {
      check(node('#name') === name && name.value === 'Recovery user', 'Input was unmounted or reset');
      check(node('#note').value === 'Keep this draft', 'Draft reset');
      check(node('#confirmation') === dialog && dialog.open, 'Dialog reset');
      check(node('#confirmation-note') === field && field.value === 'Keep this confirmation', 'Confirmation reset');
      check(document.activeElement === field, 'Focus reset');
      check(node('#support-report').value === reportText, 'Generated report reset');
    };
    if (new URL(location.href).searchParams.has('live')) {
      field.setSelectionRange(3, 8);
      await action('edit-base');
      await wait(() => node('h1').textContent === 'Vue live catalog edit' && node('#dialog-title').textContent === 'Vue live confirmation', 'Live edit did not render');
      preserved();
      check(field.selectionStart === 3 && field.selectionEnd === 8, 'Live edit reset cursor/selection');
      checks.push('live-edit');
      await action('invalid-base');
      await wait(() => node('#error').textContent.length > 0, 'Invalid JSON has no diagnostic');
      check(node('h1').textContent === 'Vue live catalog edit', 'Invalid JSON lost the last good view');
      preserved(); checks.push('invalid-json');
      await action('restore-base');
      await wait(() => node('#error').textContent === '' && node('h1').textContent === '번역을 바꿔도, 입력은 그대로', 'Live edit repair did not recover');
      preserved(); checks.push('live-restoration');
      await action('add-locale');
      await wait(() => [...node('#locale').options].some(option => option.value === 'fr'), 'Added locale missing');
      await locale('fr');
      checkLanguages('fr');
      check(node('h1').textContent === 'Bonjour Vue', 'Added locale did not lazy load');
      preserved(); checks.push('locale-addition');
      await action('remove-added-locale');
      await wait(() => document.documentElement.lang === 'ko' && ![...node('#locale').options].some(option => option.value === 'fr'), 'Deleted new locale did not fall back');
      preserved(); checks.push('added-locale-removal');
    }
    if (node('#rich-preview')) {
      await wait(() => node('#rich-preview strong')?.textContent === 'Recovery user', 'Rich text input did not render');
      const link = node('#rich-preview a');
      const strong = node('#rich-preview strong');
      check(link?.getAttribute('href') === '#order-form', 'Rich link is not controlled by the app');
      await action('rich-edit');
      await wait(() => node('#rich-preview').textContent.includes('RICH_EDIT'), 'Rich catalog edit did not render');
      check(node('#rich-preview a') === link && node('#rich-preview strong') === strong, 'Literal insertion remounted rich elements');
      preserved(); checks.push('rich-live-edit');
      await action('rich-invalid');
      await wait(() => node('#render-error').textContent.includes('Invalid rich text'), 'Broken marker has no diagnostic');
      check(node('#rich-preview').textContent.includes('RICH_EDIT'), 'Broken marker lost last good rich output');
      check(node('#rich-preview a') === link, 'Broken marker replaced rich link');
      preserved(); checks.push('rich-invalid');
      fill('#name', 'Recovery changed');
      await wait(() => node('#rich-preview strong')?.textContent === 'Recovery changed', 'Last good rich formatter ignored new input');
      fill('#name', 'Recovery user');
      await wait(() => node('#rich-preview strong')?.textContent === 'Recovery user', 'Rich fallback input did not reset');
      preserved(); checks.push('rich-fallback-input');
      await action('restore-base');
      await wait(() => node('#render-error').textContent === '' && !node('#rich-preview').textContent.includes('RICH_EDIT'), 'Rich repair did not recover');
      check(node('#rich-preview a') === link, 'Rich repair remounted link');
      preserved(); checks.push('rich-restoration');
    }
    await locale('en');
    checkLanguages('en');
    await action('remove-locale');
    await wait(() => document.documentElement.lang === 'ko' && ![...node('#locale').options].some(option => option.value === 'en'), 'Removed locale did not fall back');
    checkLanguages('ko');
    preserved(); checks.push('locale-removal');
    await action('restore-locale');
    await wait(() => [...node('#locale').options].some(option => option.value === 'en'), 'Restored locale missing');
    await locale('en'); checkLanguages('en'); preserved(); checks.push('locale-restoration');
    await action('empty-base');
    await wait(() => node('#render-error')?.textContent.includes('demo:heading'), 'Empty base did not show recoverable render diagnostics');
    check(node('h1').textContent === 'New words. Same input.', 'Last good heading was lost');
    check(node('#dialog-render-error').textContent.length > 0, 'Open dialog has no correction hint');
    await locale('ko');
    check(node('h1').textContent === 'New words. Same input.', 'Failed locale change lost the last good English view');
    checkLanguages('en');
    await locale('en');
    checkLanguages('en');
    preserved(); checks.push('empty-base');
    fill('#count', '4');
    await wait(() => node('#summary')?.textContent.includes('4'), 'Fallback formatter does not follow current input');
    preserved(); checks.push('interactive-fallback');
    await action('restore-base');
    await wait(() => node('#render-error')?.textContent === '' && node('#error')?.textContent === '', 'Repaired base did not clear diagnostics');
    preserved(); checks.push('base-restoration');
    await action('remove-namespace');
    await wait(() => node('#render-error')?.textContent.length > 0 || node('#error')?.textContent.length > 0, 'Missing namespace has no diagnostic');
    preserved(); checks.push('namespace-removal');
    await action('restore-base');
    await wait(() => node('#render-error')?.textContent === '' && node('#error')?.textContent === '', 'Restored namespace did not recover');
    preserved(); checks.push('namespace-restoration');
    await fetch('/__demo_recovery_result', { method: 'POST', body: JSON.stringify({ ok: true, checks, errors, browser: navigator.userAgent }) });
  } catch (error) {
    await fetch('/__demo_recovery_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), checks, errors }) });
  }
})();
