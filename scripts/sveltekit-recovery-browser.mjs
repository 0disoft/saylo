const errors = globalThis.__sayloRecoveryErrors ?? [];
const checks = [];
const node = selector => document.querySelector(selector);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const checkLanguages = translatedLocale => {
  const language = selector => node(selector)?.closest('[lang]')?.getAttribute('lang');
  for (const selector of ['h1', '#name', '#dialog-title', '#home-link', '#about-link']) {
    check(language(selector) === translatedLocale, `${selector} has wrong translation language`);
  }
  for (const selector of ['header', '#locale', 'nav', '#leave-link', '#status', '#dialog-status', '#support-status']) {
    check(language(selector) === 'ko', `${selector} lost its Korean language`);
  }
  check(language('.brand span') === 'en', 'Demo subtitle lost its English language');
  for (const option of node('#locale').options) check(option.lang === option.value, 'Locale option has wrong language');
};
const wait = async (condition, message, timeout = 10000) => {
  const end = performance.now() + timeout;
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
    await wait(() => node('#saylo-layout')?.dataset.ready === 'true', 'Hydrated layout is not ready', 30000);
    checkLanguages('ko');
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
    let strong, link;
    const preserved = (focus = true) => {
      check(node('#name') === name && name.value === 'Recovery user', 'Name input replaced or reset');
      check(node('#note') === note && note.value === 'Keep this draft', 'Draft replaced or reset');
      check(node('#confirmation') === dialog && dialog.open, 'Modal replaced or closed');
      check(node('#confirmation-note') === field && field.value === 'Keep this confirmation', 'Confirmation reset');
      check(node('#support-report').value === report, 'Generated support report reset');
      if (focus) check(document.activeElement === field, 'Focused input lost');
      if (strong) check(node('#rich-preview strong') === strong && node('#rich-preview a') === link, 'Rich nodes replaced');
    };
    if (cold) {
      preserved(); checks.push('cold-interaction');
      await action('restore-all');
      await wait(() => !node('#render-error').textContent && node('h1').textContent === '번역을 바꿔도, 입력은 그대로', 'Cold startup did not recover');
      preserved(); checks.push('cold-restoration');
    } else {
      await wait(() => node('#rich-preview strong')?.textContent === 'Recovery user', 'Rich input did not render');
      strong = node('#rich-preview strong'); link = node('#rich-preview a');
      check(link?.getAttribute('href') === '#order-form', 'Rich link is not controlled by the app');
      await action('rich-edit');
      await wait(() => node('#rich-preview').textContent.includes('RICH_EDIT'), 'Rich catalog edit failed');
      preserved(); checks.push('rich-live-edit');
      await action('rich-invalid');
      await wait(() => node('#render-error').textContent.includes('Invalid rich text'), 'Invalid rich markers lack a correction hint');
      check(node('#rich-preview').textContent.includes('RICH_EDIT'), 'Invalid marker lost last good rich view');
      preserved(); checks.push('rich-invalid');
      fill('#name', '<img src=x>');
      await wait(() => strong.textContent === '<img src=x>', 'Rich fallback ignored current input');
      check(!node('#rich-preview img'), 'Rich argument became HTML');
      fill('#name', 'Recovery user');
      await wait(() => strong.textContent === 'Recovery user', 'Rich fallback input restoration failed');
      preserved(); checks.push('rich-fallback-input');
      await action('restore-base');
      await wait(() => !node('#render-error').textContent && !node('#rich-preview').textContent.includes('RICH_EDIT'), 'Rich repair failed');
      preserved(); checks.push('rich-restoration');
      await locale('en'); checkLanguages('en'); preserved();
      await action('remove-locale');
      await wait(() => document.documentElement.lang === 'ko' && ![...node('#locale').options].some(value => value.value === 'en'), 'Removed locale did not fall back');
      checkLanguages('ko');
      preserved(); checks.push('locale-removal');
      await action('restore-locale');
      await wait(() => [...node('#locale').options].some(value => value.value === 'en'), 'Restored locale missing');
      await locale('en'); checkLanguages('en'); preserved(); checks.push('locale-restoration');
      await action('empty-base');
      await wait(() => node('#render-error').textContent.includes('demo:home'), 'Empty base did not show correction hint');
      check(node('h1').textContent === 'New words. Same input.', 'Last good heading lost');
      check(node('#dialog-render-error').textContent.length > 0, 'Modal has no correction hint');
      await locale('ko');
      check(node('h1').textContent === 'New words. Same input.', 'Failed locale change lost the last good English view');
      checkLanguages('en');
      await locale('en');
      checkLanguages('en');
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
    await fetch('/__recovery_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), checks, errors,
      startup: { ready: node('#saylo-layout')?.dataset.ready, status: node('#status')?.textContent,
        renderError: node('#render-error')?.textContent, diagnostic: node('#error')?.textContent,
        resources: performance.getEntriesByType('resource').map(entry => ({ path: new URL(entry.name).pathname,
          duration: Math.round(entry.duration) })) } }) });
  }
})();
