const parameters = new URL(location.href).searchParams;
if (parameters.has('starter-check')) {
  const framework = parameters.get('starter-check');
  const development = parameters.get('mode') === 'dev';
  const title = framework === 'react' ? 'React' : 'Svelte';
  const errors = [];
  const checks = [];
  addEventListener('error', event => errors.push(event.message || 'Resource load failed'));
  addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (condition, message) => {
    const deadline = performance.now() + 8000;
    while (!condition()) {
      if (performance.now() > deadline) throw new Error(message);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const element = selector => {
    const node = document.querySelector(selector);
    check(node, `Missing ${selector}`);
    return node;
  };
  const fill = (selector, value) => {
    // React tracks a controlled field's own setter; use the native setter as a user input would.
    const node = element(selector);
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const select = async (locale, heading) => {
    element('#locale').value = locale;
    element('#locale').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.documentElement.lang === locale && element('#heading').textContent === heading,
      `Locale ${locale} did not render`);
  };
  const action = async value => {
    const response = await fetch('/__saylo_starter_action', { method: 'POST', body: value });
    check(response.ok, `Mutation ${value} failed`);
  };
  void (async () => {
    try {
      check(!sessionStorage.getItem('saylo-starter-started'), 'Translation edit reloaded the document');
      sessionStorage.setItem('saylo-starter-started', 'yes');
      await wait(() => document.querySelector('#heading')?.textContent === `Saylo ${title} starter`, 'Initial English render failed');
      checks.push('first-render');
      fill('#name', 'First user');
      await wait(() => element('#greeting').textContent.includes('First user'), 'Controlled name did not interpolate');
      fill('#note', 'Keep this draft');
      await select('ko', `Saylo ${title} 시작`);
      await select('en', `Saylo ${title} starter`);
      checks.push('locale-switch');
      element('#open-dialog').click();
      await wait(() => element('#confirmation').open, 'Dialog did not open');
      fill('#dialog-note', 'Keep this dialog draft');
      element('#dialog-note').focus();
      const name = element('#name');
      const note = element('#note');
      const dialog = element('#confirmation');
      const field = element('#dialog-note');
      await wait(() => note.value === 'Keep this dialog draft', 'Shared note state did not update');
      const preserved = () => {
        check(element('#name') === name && name.value === 'First user', 'Name element/state was reset');
        check(element('#note') === note && note.value === 'Keep this dialog draft', 'Note element/state was reset');
        check(element('#confirmation') === dialog && dialog.open, 'Dialog was reset');
        check(element('#dialog-note') === field && field.value === 'Keep this dialog draft', 'Dialog input was reset');
        check(document.activeElement === field, 'Focus moved during translation update');
      };
      if (development) {
        await action('edit');
        await wait(() => element('#greeting').textContent === 'Updated First user', 'Live English edit did not render');
        preserved(); checks.push('live-edit');
        await action('add-locale');
        await wait(() => [...element('#locale').options].some(option => option.value === 'ja'), 'New locale did not appear');
        await select('ja', `Saylo ${title} 日本語`);
        check(element('#greeting').textContent === 'こんにちは First user', 'New locale did not translate');
        // Selection is programmatic, so the dialog input must retain its focus.
        preserved(); checks.push('new-locale');
        await select('en', `Saylo ${title} starter`);
        await action('invalid');
        await wait(() => element('#error').textContent.length > 0, 'Invalid ICU did not report');
        check(element('#greeting').textContent === 'Updated First user', 'Invalid ICU replaced the last good translation');
        preserved(); checks.push('invalid-last-good');
        await action('restore');
        await wait(() => element('#error').textContent.length === 0, 'Repaired file did not clear diagnostics');
        check(element('#greeting').textContent === 'Updated First user', 'Repair lost the translation');
        preserved(); checks.push('repair');
      }
      preserved(); checks.push('input-dialog-focus-preserved');
      await fetch('/__saylo_starter_result', { method: 'POST', body: JSON.stringify({ ok: true, checks, errors, browser: navigator.userAgent }) });
    } catch (error) {
      await fetch('/__saylo_starter_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), checks, errors }) });
    }
  })();
}
