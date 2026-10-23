import { mkdir, writeFile, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const locales = ['ko', 'en', 'ja', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'sv', 'pl', 'tr', 'cs', 'uk', 'ar', 'hi', 'th', 'vi', 'id', 'zh'];
export const scenarios = [
  { id: '1k-3-locales', messagesPerLocale: 1000, localeCount: 3 },
  { id: '10k-20-locales', messagesPerLocale: 10000, localeCount: 20 },
];

export async function createFixture(root, scenario, app = 'app.jsx') {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await copyFile(fileURLToPath(new URL(app, import.meta.url)), path.join(root, 'app.jsx'));
  await copyFile(fileURLToPath(new URL('catalog-receipt.mjs', import.meta.url)), path.join(root, 'catalog-receipt.mjs'));
  await copyFile(fileURLToPath(new URL('index.html', import.meta.url)), path.join(root, 'index.html'));
  let catalogBytes = 0;
  let target;
  for (const locale of locales.slice(0, scenario.localeCount)) {
    const messages = { probe: 'ready' };
    for (let i = 1; i < scenario.messagesPerLocale; i++) messages[`message${i}`] = `${locale} Message ${i} {name}`;
    const directory = path.join(root, 'locales', locale);
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'bench.json');
    await writeFile(file, JSON.stringify(messages));
    catalogBytes += (await stat(file)).size;
    if (locale === 'en') target = { file, messages };
  }
  return { target, catalogBytes, catalogFiles: scenario.localeCount, namespaces: 1 };
}
