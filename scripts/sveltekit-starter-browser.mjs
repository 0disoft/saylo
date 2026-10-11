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
      if (mode === 'cold') {
        check(element('h1').textContent === '번역을 준비하세요.', 'Cold empty catalog has no setup view');
        check(element('#render-error').textContent.includes('demo:home'), 'Cold setup has no correction hint');
        checks.push('cold-empty-hydration');
        fill('#name', 'Cold user'); fill('#note', 'Cold draft');
        element('#open-dialog').click();
        await wait(() => element('#confirmation').open, 'Cold setup modal is not interactive');
        fill('#confirmation-note', 'Cold confirmation'); element('#confirmation-note').focus();
        const name = element('#name'), note = element('#note'), dialog = element('#confirmation'), field = element('#confirmation-note');
        checks.push('cold-interaction');
        await action('restore-all');
        await wait(() => !element('#render-error').textContent && element('h1').textContent === '번역을 바꿔도, 입력은 그대로', 'Cold repair did not recover');
        check(element('#name') === name && name.value === 'Cold user', 'Cold repair replaced name input');
        check(element('#note') === note && note.value === 'Cold draft', 'Cold repair replaced draft');
        check(element('#confirmation') === dialog && dialog.open, 'Cold repair reset modal');
        check(element('#confirmation-note') === field && field.value === 'Cold confirmation' && document.activeElement === field, 'Cold repair reset confirmation/focus');
        checks.push('cold-restoration');
        await fetch('/__saylo_starter_result', { method: 'POST', body: JSON.stringify({ ok: true, checks, errors, browser: navigator.userAgent }) });
        return;
      }
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
        await action('remove-locale');
        await wait(() => document.documentElement.lang === 'ko' && ![...element('#locale').options].some(option => option.value === 'en'), 'Removed locale did not fall back');
        focused(); checks.push('locale-removal');
        await action('restore-locale');
        await wait(() => [...element('#locale').options].some(option => option.value === 'en'), 'Restored locale is missing');
        await select('en', 'New words. Same input.');
        focused(); checks.push('locale-restoration');
        await action('remove-key');
        await wait(() => element('#render-error').textContent.includes('demo:heading'), 'Deleted key has no correction hint');
        check(element('#dialog-render-error').textContent.length > 0, 'Open modal has no correction hint');
        focused(); checks.push('key-removal');
        await action('empty-base');
        await wait(() => element('#render-error').textContent.includes('demo:home'), 'Empty base has no correction hint');
        check(element('h1').textContent === 'New words. Same input.', 'Empty base discarded last good heading');
        focused(); checks.push('empty-base');
        element('#dialog-about').click();
        await wait(() => location.pathname === '/about' && document.querySelector('h1')?.textContent === 'New page. Same input.', 'Catalog error blocked shared-layout navigation');
        sameInputs(); check(dialog.open && field.value === 'Keep this confirmation', 'Error navigation reset modal');
        field.focus(); focused(); checks.push('navigation-during-error');
        await action('restore-base');
        await wait(() => !element('#render-error').textContent && !element('#error').textContent, 'Base repair did not clear diagnostics');
        focused(); checks.push('base-recovery');
        await select('en', 'New page. Same input.');
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
