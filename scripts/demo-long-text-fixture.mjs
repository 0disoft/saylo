import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Exercise actual catalog parsing/rendering without modifying example files.
export async function longTextConfig(vite, example, configFile, framework) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'saylo-long-text-'));
  const dispose = async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('saylo-long-text-'));
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    const source = framework === 'react' ? path.join(example, '../vanilla/locales') : path.join(example, 'locales');
    await cp(source, directory, { recursive: true });
    for (const locale of ['ko', 'en']) {
      const file = path.join(directory, locale, 'demo.json');
      const messages = JSON.parse(await readFile(file, 'utf8'));
      for (const key of ['heading', 'formTitle', 'name', 'nameLabel', 'openDialog', 'dialogTitle']) {
        if (Object.hasOwn(messages, key)) messages[key] = (locale === 'ko' ? '번역문구' : 'Translation').repeat(32);
      }
      await writeFile(file, JSON.stringify(messages, null, 2) + '\n');
    }
    const loaded = await vite.loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile);
    assert.ok(loaded, 'Demo config must load');
    const plugins = loaded.config.plugins.flat(Infinity).filter(Boolean);
    assert.equal(plugins.filter(plugin => plugin.name === 'saylo').length, 1);
    let entry;
    for (const modules of createRequire(path.join(example, 'package.json')).resolve.paths('@0disoft/saylo-vite')) {
      const directory = path.join(modules, '@0disoft/saylo-vite');
      try {
        const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
        entry = path.join(directory, manifest.exports['.'].import); break;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    assert.ok(entry, 'Installed Saylo plugin must expose an ESM entry');
    const saylo = (await import(pathToFileURL(entry).href)).default;
    const config = { ...loaded.config, configFile: false, plugins: [
      ...plugins.filter(plugin => plugin.name !== 'saylo'),
      saylo({ localesDir: directory, baseLocale: 'ko', initialLocale: framework === 'npm' ? 'en' : 'ko', timeZone: 'UTC',
        astRuntime: framework === 'vanilla' || framework === 'react',
        ...(framework === 'vanilla' || framework === 'npm' ? {} : { initialNamespaces: ['demo'] }) }),
    ] };
    return { config, dispose };
  } catch (error) { await dispose(); throw error; }
}
