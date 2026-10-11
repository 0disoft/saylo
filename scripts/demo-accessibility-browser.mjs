const states = [];
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
  for (const locale of ['ko', 'en']) {
    node('#locale').value = locale;
    node('#locale').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.documentElement.lang === locale);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await scan(locale, false);
    (node('#open-dialog') ?? node('#order-form button[type="submit"]')).click();
    await wait(() => node('#confirmation').open);
    await scan(locale, true);
    (node('#close-dialog') ?? node('#confirmation button')).click();
    await wait(() => !node('#confirmation').open);
  }
  await fetch('/__saylo_a11y_result', { method: 'POST', body: JSON.stringify({
    ok: true, axeVersion: axe.version, viewport: { width: innerWidth, height: innerHeight }, states,
  }) });
} catch (error) {
  await fetch('/__saylo_a11y_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), states }) });
}
