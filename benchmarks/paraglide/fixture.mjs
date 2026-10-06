import { mkdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixture } from '../live-update/fixture.mjs';

const require = createRequire(import.meta.url);
export async function createParaglideFixture(root, scenario, mode = 'edit') {
  const fixture = await createFixture(root, scenario);
  for (const file of ['app.jsx', 'main.jsx', 'control.js'])
    await copyFile(fileURLToPath(new URL(file, import.meta.url)), path.join(root, file));
  if (mode === 'locale-add') {
    await copyFile(fileURLToPath(new URL('locale-app.jsx', import.meta.url)), path.join(root, 'app.jsx'));
    await copyFile(fileURLToPath(new URL('locale-control.js', import.meta.url)), path.join(root, 'control.js'));
  }
  const localeNames = ['ko', 'en', 'ja', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'sv', 'pl', 'tr', 'cs', 'uk', 'ar', 'hi', 'th', 'vi', 'id', 'zh'].slice(0, scenario.localeCount);
  const project = path.join(root, 'project.inlang');
  await mkdir(project);
  // Copy the installed format plugin: no CDN fetching inside measured startup or edits.
  await copyFile(require.resolve('@inlang/plugin-message-format'), path.join(root, 'message-format.js'));
  const settings = { baseLocale: 'ko', locales: localeNames, modules: ['./message-format.js'],
    'plugin.inlang.messageFormat': { pathPattern: './locales/{locale}/bench.json' } };
  const settingsFile = path.join(project, 'settings.json');
  await writeFile(settingsFile, JSON.stringify(settings));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Paraglide benchmark</title></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
  return { ...fixture, project, settings, settingsFile, settingsBytes: (await stat(settingsFile)).size };
}
