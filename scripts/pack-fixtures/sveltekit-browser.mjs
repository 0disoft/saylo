// This module is injected only into the temporary packed consumer, never the example.
if (new URL(location.href).searchParams.has('pack-check')) {
  const errors = [];
  addEventListener('error', event => errors.push(event.message || 'Resource load failed'));
  addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  for (const level of ['warn', 'error']) {
    const original = console[level];
    console[level] = (...args) => { errors.push(args.map(String).join(' ')); original.apply(console, args); };
  }
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (condition, message) => {
    const deadline = performance.now() + 8000;
    while (!condition()) {
      if (performance.now() > deadline) throw new Error(message);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const element = selector => {
    const value = document.querySelector(selector);
    check(value, `Missing ${selector}`);
    return value;
  };
  const fill = (selector, value) => {
    element(selector).value = value;
    element(selector).dispatchEvent(new Event('input', { bubbles: true }));
  };
  const checks = [];
  void (async () => {
    try {
      check(!sessionStorage.getItem('saylo-pack-started'), 'Language/navigation reloaded the document');
      sessionStorage.setItem('saylo-pack-started', 'yes');
      await wait(() => document.querySelector('#saylo-layout')?.dataset.ready === 'true', 'Hydration did not connect');
      const layout = element('#saylo-layout');
      check(document.documentElement.lang === 'ko', 'Initial locale differs from SSR');
      check(element('h1').textContent === '번역을 바꿔도, 입력은 그대로', 'Initial translation differs');
      checks.push('hydration');
      fill('#name', 'Packed Saylo');
      fill('#note', 'Keep this note');
      const sameInputs = () => {
        check(element('#name').value === 'Packed Saylo', 'Name was reset');
        check(element('#note').value === 'Keep this note', 'Note was reset');
        check(element('#saylo-layout') === layout, 'Shared layout was replaced');
      };
      for (const [locale, heading] of [['en', 'New words. Same input.'], ['ko', '번역을 바꿔도, 입력은 그대로']]) {
        element('#locale').value = locale;
        element('#locale').dispatchEvent(new Event('change', { bubbles: true }));
        await wait(() => document.documentElement.lang === locale && document.querySelector('h1')?.textContent === heading,
          `Locale ${locale} did not render`);
        check(new URL(location.href).searchParams.get('locale') === locale, 'Locale URL was not updated');
        sameInputs();
      }
      checks.push('ko-en-ko');
      if (new URL(location.href).searchParams.has('support-check')) {
        element('#support-panel').open = true;
        element('#support-export').click();
        await wait(() => element('#support-report').value.length > 0, 'Support report did not generate');
        const text = element('#support-report').value;
        const report = JSON.parse(text);
        check(report.schemaVersion === 'saylo.support/v1', 'Support schema differs');
        check(report.environment.runtime === 'browser' && typeof report.environment.sayloSvelte === 'string', 'Support environment missing');
        check(element('#support-report').readOnly, 'Support output is editable');
        check(!text.includes('Packed Saylo') && !text.includes('Keep this note') && !text.includes('demo.json'), 'Support report included form content or file names');
        element('#support-clear').click();
        await wait(() => element('#support-report').value === '', 'Support report did not clear');
        element('#support-export').click();
        await wait(() => element('#support-report').value.length > 0, 'Support report did not regenerate');
        check(JSON.parse(element('#support-report').value).events.length === 0, 'Cleared support history retained events');
        sameInputs();
        checks.push('support-report');
      }
      element('#open-dialog').click();
      await wait(() => document.querySelector('#confirmation')?.open, 'Dialog did not open');
      fill('#confirmation-note', 'Keep this confirmation');
      const dialog = element('#confirmation');
      const focusCheck = new URL(location.href).searchParams.has('focus-check');
      if (focusCheck) element('#dialog-about').focus();
      element('#dialog-about').click();
      await wait(() => location.pathname === '/about' && document.querySelector('h1')?.textContent === '페이지를 이동해도, 입력은 그대로',
        'About page did not render');
      sameInputs();
      check(element('#confirmation') === dialog && dialog.open, 'Navigation reset the open dialog');
      check(element('#confirmation-note').value === 'Keep this confirmation', 'Confirmation was reset');
      if (focusCheck) {
        check(document.activeElement === element('#dialog-about'), 'Navigation moved focus out of the open dialog');
        checks.push('modal-navigation-focus');
      }
      checks.push('shared-layout');
      element('#close-dialog').click();
      await wait(() => !dialog.open, 'Dialog did not close');
      element('#leave-link').click();
      await wait(() => document.querySelector('#plain-page') && !document.querySelector('#saylo-layout'), 'Layout did not exit');
      element('#return-link').click();
      await wait(() => document.querySelector('#saylo-layout')?.dataset.ready === 'true', 'Layout did not reconnect');
      check(element('#saylo-layout') !== layout, 'Re-entry retained the old layout');
      check(element('#name').value === '' && element('#note').value === '', 'Re-entry did not reset the form');
      check(document.documentElement.lang === 'ko', 'Re-entry locale differs');
      checks.push('exit-reentry');
      await fetch('/__saylo_pack_result', { method: 'POST', body: JSON.stringify({ ok: true, checks, errors, browser: navigator.userAgent }) });
    } catch (error) {
      await fetch('/__saylo_pack_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), checks, errors }) });
    }
  })();
}
