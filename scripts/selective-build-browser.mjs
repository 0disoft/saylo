const errors = [];
window.addEventListener('error', event => errors.push(event.message));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const checks = [];
const element = id => document.getElementById(id);
function check(condition, label) {
  if (!condition) throw new Error(label);
  checks.push(label);
}
async function ready() {
  const until = Date.now() + 15000;
  while (element('locale')?.options.length !== 2 || !element('summary')?.textContent) {
    if (Date.now() > until) throw new Error('Production page did not become ready');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const parameters = new URLSearchParams(location.search);
const variant = parameters.get('variant');
let report;
try {
  await ready();
  const name = element('name'), note = element('note'), dialog = element('confirmation');
  check(document.documentElement.lang === 'ko' && document.querySelector('h1').textContent === '번역을 바꿔도, 입력은 그대로', 'initial-ko');
  name.value = 'Retained Ada'; note.value = 'Retained delivery note';
  element('count').value = '1'; element('count').dispatchEvent(new Event('input', { bubbles: true }));
  element('order-form').requestSubmit();
  check(dialog.open, 'dialog-open');
  element('confirmation-note').value = 'Retained dialog note';
  const locale = element('locale');
  locale.value = 'en'; locale.dispatchEvent(new Event('change', { bubbles: true }));
  check(document.documentElement.lang === 'en' && document.querySelector('h1').textContent === 'New words. Same input.', 'switch-en');
  check(element('summary').textContent === '1 item' && name.placeholder === "Recipient's name", 'en-singular-and-placeholder');
  element('count').value = '2'; element('count').dispatchEvent(new Event('input', { bubbles: true }));
  check(element('summary').textContent === '2 items', 'en-plural');
  locale.value = 'ko'; locale.dispatchEvent(new Event('change', { bubbles: true }));
  check(document.documentElement.lang === 'ko' && element('summary').textContent === '상품 2개', 'switch-back-ko');
  check(element('name') === name && element('note') === note && element('confirmation') === dialog
    && name.value === 'Retained Ada' && note.value === 'Retained delivery note'
    && dialog.open && element('confirmation-note').value === 'Retained dialog note', 'retained-form-and-dialog');
  const catalogs = ['ko', 'en'].map(locale => JSON.parse(element(`${locale}-editor`).value));
  check(catalogs.every(catalog => Object.keys(catalog).length === (variant === 'selected' ? 13 : 113)), 'catalog-key-count');
  check(catalogs.every(catalog => Object.hasOwn(catalog, 'unused0') === (variant === 'full')), 'unused-keys-policy');
  check(element('error').textContent === '', 'no-render-error');
  check(errors.length === 0, 'no-browser-error');
  report = { ok: true, variant, checks, errors, userAgent: navigator.userAgent };
} catch (error) {
  report = { ok: false, variant, checks, errors, error: String(error) };
}
await fetch('/__selective_result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) });
