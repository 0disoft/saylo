// This probe observes DOM state but performs user actions only through Chromium
// key/text input. No click(), focus(), value setter or synthetic DOM event.
export function createKeyboardJourney({ press, wait, check }) {
  const node = selector => document.querySelector(selector);
  const reports = [];
  let current;
  const label = element => element.id || element.tagName.toLowerCase();
  const reach = async element => {
    check(element, 'Journey target is missing');
    for (let step = 0; document.activeElement !== element && step < 60; step++) {
      await press('Tab');
      current.tabPath.push(label(document.activeElement));
    }
    check(document.activeElement === element, `Tab could not reach ${label(element)}`);
    const bounds = element.getBoundingClientRect();
    check(bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.left < innerWidth && bounds.bottom > 0 && bounds.top < innerHeight,
      `Keyboard focus is offscreen at ${label(element)}`);
  };
  const replace = async (element, text) => {
    await reach(element);
    await press('SelectAll');
    const response = await fetch('/__saylo_a11y_text', { method: 'POST', body: text });
    check(response.ok, 'Native text insertion failed');
    await wait(() => element.value === text);
  };
  return {
    reports, reach, replace,
    async prepare(locale, first) {
      current = { locale, tabPath: [] }; reports.push(current);
      const select = node('#locale');
      await reach(select);
      const index = [...select.options].findIndex(option => option.value === locale);
      check(index >= 0, 'Journey locale is missing');
      await press('Home');
      for (let step = 0; step < index; step++) await press('ArrowDown');
      await press('Enter');
      await wait(() => select.value === locale && document.documentElement.lang === locale);
      current.localeSelected = true;
      if (first) {
        await replace(node('#name'), 'Zoom preview');
        await replace(node('#note'), 'Preserved at 200/400 percent');
      }
      check(node('#name').value === 'Zoom preview' && node('#note').value === 'Preserved at 200/400 percent',
        'Native locale selection or text input lost the form');
      current.formPreserved = true;
      current.heading = node('h1').textContent.trim();
      if (node('#support-panel')) {
        const panel = node('#support-panel');
        await reach(panel.querySelector('summary'));
        if (!panel.open) await press('Enter');
        await wait(() => panel.open);
        await reach(node('#support-export')); await press('Enter');
        await wait(() => node('#support-report').value.length > 0);
        const text = node('#support-report').value;
        const report = JSON.parse(text);
        check(Array.isArray(report.events), 'Generated support report has no event list');
        check(!text.includes('Zoom preview') && !text.includes('Preserved at 200/400 percent'),
          'Support report included the form content');
        current.reportGenerated = true;
        await reach(node('#support-clear')); await press('Enter');
        await wait(() => node('#support-report').value === '');
        current.reportCleared = true;
      } else current.support = 'not provided by this example';
    },
  };
}
