const mode = new URL(location.href).searchParams.get('mode');
if (new URL(location.href).searchParams.get('starter-check') === 'sveltekit') {
  const errors = [];
  const checks = [];
  addEventListener('error', event => errors.push(event.message || 'Resource failed'));
  addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  for (const level of ['warn', 'error']) {
    const original = console[level];
    console[level] = (...args) => { errors.push(args.map(String).join(' ')); original.apply(console, args); };
  }
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (condition, message) => {
    const deadline = performance.now() + 10000;
    while (!condition()) {
      if (performance.now() > deadline) throw new Error(message);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const element = selector => { const node = document.querySelector(selector); check(node, `Missing ${selector}`); return node; };
  const fill = (selector, value) => { element(selector).value = value; element(selector).dispatchEvent(new Event('input', { bubbles: true })); };
  const select = async (locale, heading) => {
    element('#locale').value = locale;
    element('#locale').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.documentElement.lang === locale && document.querySelector('h1')?.textContent === heading,
      `Locale ${locale} did not render`);
    check(new URL(location.href).searchParams.get('locale') === locale, 'Locale URL differs from the committed state');
  };
  const action = async body => { check((await fetch('/__saylo_starter_action', { method: 'POST', body })).ok, 'Mutation failed'); };
  void (async () => {
    try {
      check(!sessionStorage.getItem('saylo-kit-starter'), 'Document reloaded during navigation or locale editing');
      sessionStorage.setItem('saylo-kit-starter', 'yes');
      await wait(() => document.querySelector('#saylo-layout')?.dataset.ready === 'true', 'Hydration did not connect');
      check(document.documentElement.lang === 'ko', 'Hydrated locale differs from SSR');
      check(element('h1').textContent === '번역을 바꿔도, 입력은 그대로', 'Hydrated translation differs from SSR');
      checks.push('hydration');
      const layout = element('#saylo-layout');
      fill('#name', 'Starter user'); fill('#note', 'Keep this draft');
      await select('en', 'New words. Same input.');
      await select('ko', '번역을 바꿔도, 입력은 그대로');
      await select('en', 'New words. Same input.');
      checks.push('locale-url');
      const sameInputs = () => {
        check(element('#saylo-layout') === layout, 'Shared layout was replaced');
        check(element('#name').value === 'Starter user' && element('#note').value === 'Keep this draft', 'Form state reset');
      };
      element('#open-dialog').click();
      await wait(() => element('#confirmation').open, 'Dialog did not open');
      fill('#confirmation-note', 'Keep this confirmation');
      element('#confirmation-note').focus();
      const dialog = element('#confirmation');
      const field = element('#confirmation-note');
      const focused = () => {
        sameInputs();
        check(element('#confirmation') === dialog && dialog.open, 'Dialog reset');
        check(element('#confirmation-note') === field && field.value === 'Keep this confirmation', 'Confirmation reset');
        check(document.activeElement === field, 'Focus moved during translation edit');
      };
      if (mode === 'dev') {
        await action('edit');
        await wait(() => element('h1').textContent === 'Updated words. Same input.', 'Live edit did not render');
        focused(); checks.push('live-edit');
        await action('add-locale');
        await wait(() => [...element('#locale').options].some(option => option.value === 'ja'), 'New locale absent');
        await select('ja', 'Saylo 日本語');
        // SvelteKit navigation may manage focus; set it before the file-only recovery checks.
        sameInputs(); check(dialog.open && field.value === 'Keep this confirmation', 'New locale reset the dialog');
        checks.push('new-locale');
        await select('en', 'Updated words. Same input.');
        field.focus();
        await action('invalid');
        await wait(() => element('#error').textContent.length > 0, 'Invalid ICU did not report');
        check(element('h1').textContent === 'Updated words. Same input.', 'Invalid ICU changed last good translation');
        focused(); checks.push('invalid-last-good');
        await action('restore');
        await wait(() => element('#error').textContent.length === 0 && element('h1').textContent === 'New words. Same input.', 'Repair did not recover');
        focused(); checks.push('repair', 'focus-preserved');
      }
      element('#dialog-about').click();
      await wait(() => location.pathname === '/about' && document.querySelector('h1')?.textContent === 'New page. Same input.', 'About did not render');
      sameInputs(); check(dialog.open && field.value === 'Keep this confirmation', 'Route change reset the dialog');
      checks.push('shared-layout');
      element('#close-dialog').click();
      await wait(() => !dialog.open, 'Dialog did not close');
      element('#leave-link').click();
      await wait(() => document.querySelector('#plain-page') && !document.querySelector('#saylo-layout'), 'Layout did not exit');
      element('#return-link').click();
      await wait(() => document.querySelector('#saylo-layout')?.dataset.ready === 'true', 'Layout did not reconnect');
      check(element('#saylo-layout') !== layout, 'Re-entry reused a disposed layout');
      check(element('#name').value === '' && element('#note').value === '', 'Re-entry did not reset state');
      checks.push('exit-reentry');
      await fetch('/__saylo_starter_result', { method: 'POST', body: JSON.stringify({ ok: true, checks, errors, browser: navigator.userAgent }) });
    } catch (error) {
      await fetch('/__saylo_starter_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), checks, errors }) });
    }
  })();
}
