const errors = globalThis.__sayloRecoveryErrors ?? [];
const checks = [];
const node = selector => document.querySelector(selector);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const wait = async (condition, message) => {
  const end = performance.now() + 10000;
  while (!condition()) {
    if (performance.now() > end) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
const fill = (selector, value) => {
  const element = node(selector);
  element.value = value; element.dispatchEvent(new Event('input', { bubbles: true }));
};
const action = async body => { check((await fetch('/__recovery_action', { method: 'POST', body })).ok, 'Catalog action failed'); };
const locale = async value => {
  node('#locale').value = value; node('#locale').dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => document.documentElement.lang === value && !node('#transition-error').textContent, 'Locale navigation did not finish');
};
void (async () => {
  try {
    await wait(() => node('#saylo-layout')?.dataset.ready === 'true', 'Hydrated layout is not ready');
    const cold = new URL(location.href).searchParams.has('cold');
    if (cold) {
      check(node('h1').textContent === '번역을 준비하세요.', 'Empty startup has no setup view');
      check(node('#render-error').textContent.includes('demo:home'), 'Empty startup has no key correction hint');
      checks.push('cold-empty-hydration');
    }
    fill('#name', 'Recovery user'); fill('#note', 'Keep this draft');
    node('#open-dialog').click();
    await wait(() => node('#confirmation').open, 'Dialog did not open');
    fill('#confirmation-note', 'Keep this confirmation'); node('#confirmation-note').focus();
    node('#support-export').click();
    await wait(() => node('#support-report').value.length > 0, 'Support report missing');
    const name = node('#name'), note = node('#note'), dialog = node('#confirmation'), field = node('#confirmation-note');
    const report = node('#support-report').value;
    const preserved = (focus = true) => {
      check(node('#name') === name && name.value === 'Recovery user', 'Name input replaced or reset');
      check(node('#note') === note && note.value === 'Keep this draft', 'Draft replaced or reset');
      check(node('#confirmation') === dialog && dialog.open, 'Modal replaced or closed');
      check(node('#confirmation-note') === field && field.value === 'Keep this confirmation', 'Confirmation reset');
      check(node('#support-report').value === report, 'Generated support report reset');
      if (focus) check(document.activeElement === field, 'Focused input lost');
    };
    if (cold) {
      preserved(); checks.push('cold-interaction');
      await action('restore-all');
      await wait(() => !node('#render-error').textContent && node('h1').textContent === '번역을 바꿔도, 입력은 그대로', 'Cold startup did not recover');
      preserved(); checks.push('cold-restoration');
    } else {
      await locale('en'); preserved();
      await action('remove-locale');
      await wait(() => document.documentElement.lang === 'ko' && ![...node('#locale').options].some(value => value.value === 'en'), 'Removed locale did not fall back');
      preserved(); checks.push('locale-removal');
      await action('restore-locale');
      await wait(() => [...node('#locale').options].some(value => value.value === 'en'), 'Restored locale missing');
      await locale('en'); preserved(); checks.push('locale-restoration');
      await action('empty-base');
      await wait(() => node('#render-error').textContent.includes('demo:home'), 'Empty base did not show correction hint');
      check(node('h1').textContent === 'New words. Same input.', 'Last good heading lost');
      check(node('#dialog-render-error').textContent.length > 0, 'Modal has no correction hint');
      preserved(); checks.push('empty-base');
      node('#dialog-about').click();
      await wait(() => location.pathname === '/about' && node('h1')?.textContent === 'New page. Same input.', 'Broken catalog blocked shared-layout navigation');
      preserved(false); field.focus(); preserved(); checks.push('navigation-during-error');
      await action('restore-base');
      await wait(() => !node('#render-error').textContent && !node('#error').textContent, 'Restored base did not clear diagnostics');
      preserved(); checks.push('base-restoration');
      await action('remove-namespace');
      await wait(() => node('#render-error').textContent.length > 0 || node('#error').textContent.length > 0, 'Missing namespace has no diagnostic');
      preserved(); checks.push('namespace-removal');
      await action('restore-base');
      await wait(() => !node('#render-error').textContent && !node('#error').textContent, 'Restored namespace did not recover');
      preserved(); checks.push('namespace-restoration');
    }
    await fetch('/__recovery_result', { method: 'POST', body: JSON.stringify({ ok: true, checks, errors, browser: navigator.userAgent }) });
  } catch (error) {
    await fetch('/__recovery_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), checks, errors }) });
  }
})();
