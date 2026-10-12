void (async () => {
  const errors = [], warnings = [], checks = [];
  const originalError = console.error, originalWarn = console.warn;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args); };
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); originalWarn(...args); };
  window.addEventListener('error', event => errors.push(event.message));
  window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  const check = (value, message) => { if (!value) throw new Error(message); };
  const wait = async (read, message) => {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if (await read()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(message);
  };
  let mounted;
  try {
    const locale = new URL(location.href).searchParams.get('locale');
    const opposite = locale === 'ko' ? 'en' : 'ko';
    const node = selector => document.querySelector(selector);
    const name = node('#name'), note = node('#note'), heading = node('h1');
    const initialHeading = heading.textContent;
    check(document.documentElement.lang === locale && node('#locale').value === locale, 'Server locale mismatch');
    name.value = 'Before hydration'; note.value = 'Keep this note';
    name.focus(); name.setSelectionRange(2, 8);
    checks.push('server-form-edit');
    const action = async operation => {
      const response = await fetch('/__vue_ssr_action', { method: 'POST', body: JSON.stringify({ locale, operation }) });
      check(response.ok, 'Fixture edit failed');
    };
    // Let the server catalog move ahead while the client still has old server HTML.
    await action('gap');
    await wait(async () => (await (await fetch(`/?locale=${locale}`)).text()).includes(`SSR gap ${locale}`), 'Server did not observe gap edit');
    const { hydrate } = await import('/client.mjs');
    mounted = hydrate();
    check(mounted.initialLocale === locale && heading.textContent === initialHeading, 'Hydration did not use the server boot snapshot');
    check(node('#name') === name && node('#note') === note && node('h1') === heading, 'Hydration replaced server DOM');
    const preserved = () => {
      check(name.value === 'Before hydration' && note.value === 'Keep this note', 'Typed values reset');
      check(document.activeElement === name && name.selectionStart === 2 && name.selectionEnd === 8, 'Focus/selection reset');
    };
    preserved(); checks.push('frozen-boot-hydration');
    await wait(() => heading.textContent === `SSR gap ${locale}` && mounted.stats().connected, 'Post-hydration gap sync failed');
    check(node('#form-values').textContent === 'Before hydration / Keep this note', 'Vue did not adopt pre-hydration form state');
    preserved(); checks.push('gap-sync');
    const select = node('#locale');
    select.value = opposite; select.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.documentElement.lang === opposite && heading.textContent !== `SSR gap ${locale}`, 'Locale switch failed');
    preserved(); checks.push('locale-switch');
    select.value = locale; select.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => document.documentElement.lang === locale && heading.textContent === `SSR gap ${locale}`, 'Locale return failed');
    await action('live');
    await wait(() => heading.textContent === `SSR live ${locale}`, 'Live translation edit failed');
    preserved(); checks.push('live-edit');
    name.value = 'After hydration'; name.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(() => node('#form-values').textContent === 'After hydration / Keep this note', 'Hydrated input handler failed');
    node('#count').click();
    await wait(() => node('#count').textContent.includes('3'), 'Hydrated action failed');
    checks.push('interactive-form');
    check(mounted.stats().subscriptions === 1 && mounted.stats().disposalListeners === 1, 'Expected one component subscription');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    check(!mounted.stats().stopped && mounted.stats().connected, 'BFCache pagehide stopped the app');
    checks.push('bfcache-retention');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    mounted.stop();
    const resources = mounted.stats();
    check(resources.stopped && !resources.connected && resources.subscriptions === 0 && resources.disposalListeners === 0,
      'Client cleanup retained resources');
    checks.push('client-cleanup');
    check(errors.length === 0 && warnings.length === 0, 'Runtime errors or hydration warnings observed');
    await fetch('/__vue_ssr_result', { method: 'POST', body: JSON.stringify({ ok: true, locale, checks, resources,
      errors, warnings, browser: navigator.userAgent }) });
  } catch (error) {
    mounted?.stop();
    await fetch('/__vue_ssr_result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), checks, errors, warnings }) });
  }
})();
