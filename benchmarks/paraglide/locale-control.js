const documentId = crypto.randomUUID();
let latest, initialInput, wake, starting = false, initialPage = false;
async function request(route, data) {
  const response = await fetch(`/__bench/${route}`, data === undefined ? {} : { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
const fail = error => { void request('fail', { message: String(error) }).catch(() => {}); };
async function waitForCommit(predicate) {
  while (!latest || !predicate(latest)) await new Promise(resolve => { wake = resolve; });
}
const preserved = () => ({ documentId,
  inputNodePreserved: initialPage && latest.input === initialInput,
  inputValuePreserved: latest.input.value === 'preserved input', componentStatePreserved: latest.state === 'preserved state' });
function hasOption(locale) { return [...document.getElementById('locale').options].some(option => option.value === locale); }
async function control() {
  const boot = await request('ready', { documentId, userAgent: navigator.userAgent });
  initialPage = boot.initial;
  if (initialPage) {
    await waitForCommit(() => true); initialInput = latest.input; latest.seed();
    await waitForCommit(value => value.state === 'preserved state');
  }
  while (true) {
    const command = await request('command');
    if (command.kind === 'done') return;
    if (command.kind === 'calibrate') { await request('ack', { token: command.token }); continue; }
    let phase = command.phase;
    if (phase === 'adding') {
      if (!command.saved) await request('armed', { token: command.token });
      await waitForCommit(value => value.locales.includes(command.locale) && value.locale === 'en' && value.text === 'ready');
      if (!hasOption(command.locale)) throw new Error('Locale list did not reach DOM.');
      await request('listed', { token: command.token, ...preserved() }); phase = 'listed';
    }
    if (phase === 'listed') {
      await request('selecting', { token: command.token });
      await latest.switchLocale(command.locale); phase = 'selecting';
    }
    if (phase === 'selecting') {
      await waitForCommit(value => value.locale === command.locale && value.text === command.expected);
      if (document.getElementById('probe').textContent !== command.expected || document.getElementById('locale').value !== command.locale)
        throw new Error('First translation did not reach DOM.');
      await request('ack', { token: command.token, text: latest.text, ...preserved() }); phase = 'resetting';
    }
    if (phase === 'resetting') {
      if (latest.locale !== 'en') await latest.switchLocale('en');
      await waitForCommit(value => value.locale === 'en' && value.text === 'ready');
      await request('remove', { token: command.token }); phase = 'removing';
    }
    if (phase === 'removing') {
      await waitForCommit(value => !value.locales.includes(command.locale) && value.locale === 'en' && value.text === 'ready');
      if (hasOption(command.locale)) throw new Error('Removed locale remains in DOM.');
      await request('removed', { token: command.token });
    }
  }
}
export const controller = { commit(value) {
  latest = value; wake?.(); wake = undefined;
  if (!starting) { starting = true; void control().catch(fail); }
} };
