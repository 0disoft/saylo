const states = [];
const zoomChecks = new URL(location.href).searchParams.has('saylo-zoom');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const wait = async condition => {
  const until = performance.now() + 20000;
  while (!condition()) {
    if (performance.now() > until) throw new Error('Accessibility probe waited for demo initialization or locale transition');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
const node = selector => document.querySelector(selector);
const summarize = rule => ({ id: rule.id, impact: rule.impact, help: rule.help, helpUrl: rule.helpUrl,
  nodes: rule.nodes.map(item => ({ target: item.target, html: item.html, summary: item.failureSummary })) });
async function scan(locale, dialog) {
  const result = await axe.run(document, { runOnly: { type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  const secondary = node('#close-dialog.secondary');
  states.push({ locale, dialog, violations: result.violations.map(summarize),
    ...(zoomChecks ? { metrics: { innerWidth, innerHeight, devicePixelRatio, visualScale: visualViewport.scale,
      rootClientWidth: document.documentElement.clientWidth, rootScrollWidth: document.documentElement.scrollWidth,
      dialogClientWidth: node('#confirmation').clientWidth, dialogScrollWidth: node('#confirmation').scrollWidth } } : {}),
    incomplete: result.incomplete.map(summarize), passedRules: result.passes.map(rule => rule.id),
    secondaryColors: secondary ? { foreground: getComputedStyle(secondary).color,
      background: getComputedStyle(secondary).backgroundColor } : null });
}
try {
  await wait(() => globalThis.axe && node('#locale')?.options.length >= 2 && node('h1')?.textContent.trim()
    && (!node('#saylo-layout') || node('#saylo-layout').dataset.ready === 'true'));
  // The optional support panel must be visible to be included in the analysis.
  if (node('#support-panel')) {
    node('#support-panel').open = true;
    node('#support-export').click();
    await wait(() => node('#support-report').value.length > 0);
  }
  const fill = (element, value) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  if (zoomChecks) {
    fill(node('#name'), 'Zoom preview');
    fill(node('#note'), 'Preserved at 200/400 percent');
  }
  const sameInputs = () => {
    check(node('#name').value === 'Zoom preview', 'Zoom/locale transition reset name');
    check(node('#note').value === 'Preserved at 200/400 percent', 'Zoom/locale transition reset note');
  };
  for (const locale of ['ko', 'en']) {
    node('#locale').value = locale;
    node('#locale').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.documentElement.lang === locale);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (zoomChecks) sameInputs();
    await scan(locale, false);
    const opener = node('#open-dialog') ?? node('#order-form button[type="submit"]');
    if (zoomChecks) opener.focus();
    opener.click();
    await wait(() => node('#confirmation').open);
    const confirmation = node('#confirmation-note') ?? node('#dialog-note');
    if (zoomChecks) {
      check(document.activeElement === confirmation, 'Zoomed dialog did not focus its input');
      fill(confirmation, 'Zoom confirmation');
    }
    await scan(locale, true);
    const close = node('#close-dialog') ?? node('#confirmation button');
    if (zoomChecks) {
      close.scrollIntoView({ block: 'center', inline: 'nearest' });
      const bounds = close.getBoundingClientRect();
      check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
        `Zoomed dialog close control is clipped: ${JSON.stringify(bounds)}`);
    }
    close.click();
    await wait(() => !node('#confirmation').open);
    if (zoomChecks) {
      check(document.activeElement === opener, 'Zoomed dialog did not restore opener focus');
      check(confirmation.value === 'Zoom confirmation', 'Closing zoomed dialog reset confirmation');
      sameInputs();
    }
  }
  await fetch('/__saylo_a11y_result', { method: 'POST', body: JSON.stringify({
    ok: true, axeVersion: axe.version, viewport: { width: innerWidth, height: innerHeight }, states,
  }) });
} catch (error) {
  await fetch('/__saylo_a11y_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), states }) });
}
