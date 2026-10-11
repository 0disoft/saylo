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
const fill = (selector, value) => {
  const element = node(selector);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};
const action = async body => { check((await fetch('/__react_recovery_action', { method: 'POST', body })).ok, 'Mutation failed'); };
const locale = async value => {
  node('#locale').value = value; node('#locale').dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => document.documentElement.lang === value, 'Locale change did not finish');
};
void (async () => {
  try {
    await wait(() => node('#name'), 'React did not mount');
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
      await fetch('/__react_recovery_result', { method: 'POST', body: JSON.stringify({ ok: true, checks, errors, browser: navigator.userAgent }) });
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
      check(node('#name') === name && name.value === 'Recovery user', 'React input was unmounted or reset');
      check(node('#note').value === 'Keep this draft', 'Draft reset');
      check(node('#confirmation') === dialog && dialog.open, 'Dialog reset');
      check(node('#confirmation-note') === field && field.value === 'Keep this confirmation', 'Confirmation reset');
      check(document.activeElement === field, 'Focus reset');
      check(node('#support-report').value === reportText, 'Generated report reset');
    };
    await locale('en');
    await action('remove-locale');
    await wait(() => document.documentElement.lang === 'ko' && ![...node('#locale').options].some(option => option.value === 'en'), 'Removed locale did not fall back');
    preserved(); checks.push('locale-removal');
    await action('restore-locale');
    await wait(() => [...node('#locale').options].some(option => option.value === 'en'), 'Restored locale missing');
    await locale('en'); preserved(); checks.push('locale-restoration');
    await action('empty-base');
    await wait(() => node('#render-error')?.textContent.includes('demo:heading'), 'Empty base did not show recoverable render diagnostics');
    check(node('h1').textContent === 'New words. Same input.', 'Last good heading was lost');
    check(node('#dialog-render-error').textContent.length > 0, 'Open dialog has no correction hint');
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
    await fetch('/__react_recovery_result', { method: 'POST', body: JSON.stringify({ ok: true, checks, errors, browser: navigator.userAgent }) });
  } catch (error) {
    await fetch('/__react_recovery_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), checks, errors }) });
  }
})();
