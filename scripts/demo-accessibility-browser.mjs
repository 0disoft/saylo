import { reviewContrast } from '/__saylo_contrast.mjs';
import { createKeyboardJourney } from '/__saylo_journey.mjs';
const states = [];
const keyboard = [];
const keyboardChecks = new URL(location.href).searchParams.has('saylo-keyboard');
const zoomChecks = new URL(location.href).searchParams.has('saylo-zoom');
const journeyChecks = new URL(location.href).searchParams.has('saylo-journey');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const wait = async condition => {
  const until = performance.now() + 20000;
  while (!condition()) {
    if (performance.now() > until) throw new Error('Accessibility probe waited for demo initialization or locale transition');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};
const node = selector => document.querySelector(selector);
const press = async key => {
  const response = await fetch('/__saylo_a11y_key', { method: 'POST', body: key });
  check(response.ok, `Keyboard injection failed: ${key}`);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
const journey = journeyChecks ? createKeyboardJourney({ press, wait, check }) : null;
async function traverseModal(locale, confirmation) {
  const dialog = node('#confirmation');
  check(document.activeElement === confirmation, 'Keyboard-opened dialog did not focus its input');
  const controls = [...dialog.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')]
    .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length > 0);
  check(controls.length >= 2, 'Modal must expose its input and close control');
  const label = element => element.id || `${element.tagName.toLowerCase()}[${controls.indexOf(element)}]`;
  const paths = {};
  for (const direction of ['Tab', 'ShiftTab']) {
    const seen = new Set(); const trail = [];
    for (let step = 0; step < controls.length * 2 + 2; step++) {
      await press(direction);
      const focused = document.activeElement;
      // Native dialogs may pass through browser chrome at the cycle boundary.
      // They must never give focus to the inert form behind the dialog.
      check(focused === document.body || dialog.contains(focused), `${direction} escaped the modal to ${focused.id || focused.tagName}`);
      trail.push(focused === document.body ? `body-boundary(pageFocus=${document.hasFocus()})` : label(focused));
      if (controls.includes(focused)) seen.add(focused);
    }
    check(controls.every(element => seen.has(element)), `${direction} did not reach every modal control`);
    paths[direction] = trail;
  }
  keyboard.push({ locale, controls: controls.map(label), paths });
}
const summarize = rule => ({ id: rule.id, impact: rule.impact, help: rule.help, helpUrl: rule.helpUrl,
  nodes: rule.nodes.map(item => ({ target: item.target, html: item.html, summary: item.failureSummary })) });
async function scan(locale, dialog) {
  const result = await axe.run(document, { runOnly: { type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
  const secondary = node('#close-dialog.secondary');
  const contrastReview = zoomChecks && dialog ? await reviewContrast(result, summarize) : null;
  states.push({ locale, dialog, violations: result.violations.map(summarize),
    ...(contrastReview ? { contrastReview } : {}),
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
  if (node('#support-panel') && !journeyChecks) {
    node('#support-panel').open = true;
    node('#support-export').click();
    await wait(() => node('#support-report').value.length > 0);
  }
  const fill = (element, value) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  if ((zoomChecks || keyboardChecks) && !journeyChecks) {
    fill(node('#name'), 'Zoom preview');
    fill(node('#note'), 'Preserved at 200/400 percent');
  }
  const sameInputs = () => {
    check(node('#name').value === 'Zoom preview', 'Zoom/locale transition reset name');
    check(node('#note').value === 'Preserved at 200/400 percent', 'Zoom/locale transition reset note');
  };
  for (const locale of ['ko', 'en']) {
    if (journeyChecks) await journey.prepare(locale, locale === 'ko');
    else {
      node('#locale').value = locale;
      node('#locale').dispatchEvent(new Event('change', { bubbles: true }));
    }
    await wait(() => document.documentElement.lang === locale);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (zoomChecks || keyboardChecks) sameInputs();
    await scan(locale, false);
    const opener = node('#open-dialog') ?? node('#order-form button[type="submit"]');
    if (journeyChecks) await journey.reach(opener);
    else if (zoomChecks || keyboardChecks) opener.focus();
    if (keyboardChecks) await press('Enter'); else opener.click();
    await wait(() => node('#confirmation').open);
    const confirmation = node('#confirmation-note') ?? node('#dialog-note');
    if (zoomChecks || keyboardChecks) {
      check(document.activeElement === confirmation, 'Zoomed dialog did not focus its input');
      if (journeyChecks) await journey.replace(confirmation, 'Zoom confirmation');
      else fill(confirmation, 'Zoom confirmation');
    }
    await scan(locale, true);
    const close = node('#close-dialog') ?? node('#confirmation button');
    if (zoomChecks && !journeyChecks) {
      close.scrollIntoView({ block: 'center', inline: 'nearest' });
      const bounds = close.getBoundingClientRect();
      check(bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
        `Zoomed dialog close control is clipped: ${JSON.stringify(bounds)}`);
    }
    if (keyboardChecks) {
      await traverseModal(locale, confirmation);
      await press('Escape');
      await wait(() => !node('#confirmation').open);
      check(document.activeElement === opener, 'Escape did not restore opener focus');
      check(confirmation.value === 'Zoom confirmation', 'Escape reset confirmation input');
      keyboard.at(-1).escapeRestored = true;
      await press('Enter');
      await wait(() => node('#confirmation').open);
      for (let step = 0; document.activeElement !== close && step < 20; step++) await press('Tab');
      check(document.activeElement === close, 'Keyboard could not reach the close button');
      if (journeyChecks && zoomChecks) {
        const bounds = close.getBoundingClientRect();
        check(bounds.width > 0 && bounds.height > 0 && bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
          'Keyboard-focused close control is clipped at the requested zoom');
      }
      await press('Enter');
      await wait(() => !node('#confirmation').open);
      check(document.activeElement === opener, 'Keyboard close did not restore opener focus');
      keyboard.at(-1).enterClosed = true;
    }
    if (!keyboardChecks) close.click();
    await wait(() => !node('#confirmation').open);
    if (zoomChecks || keyboardChecks) {
      check(document.activeElement === opener, 'Zoomed dialog did not restore opener focus');
      check(confirmation.value === 'Zoom confirmation', 'Closing zoomed dialog reset confirmation');
      sameInputs();
      if (keyboardChecks) keyboard.at(-1).inputsPreserved = true;
    }
  }
  await fetch('/__saylo_a11y_result', { method: 'POST', body: JSON.stringify({
    ok: true, axeVersion: axe.version, viewport: { width: innerWidth, height: innerHeight }, states, keyboard,
    journeys: journey?.reports,
  }) });
} catch (error) {
  await fetch('/__saylo_a11y_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), states, keyboard, journeys: journey?.reports }) });
}
