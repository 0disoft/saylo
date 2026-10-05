import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBaseSchema, parseCatalog } from '@saylo/core';
import { CatalogRegistry } from '../../packages/vite/dist/catalog-registry.js';

const locales = ['ko', 'en', 'ja', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'sv', 'pl', 'tr', 'cs', 'uk', 'ar', 'hi', 'th', 'vi', 'id', 'zh'];
const results = [];
for (const [messagesPerLocale, localeCount] of [[1000, 3], [10000, 20]]) {
  const messages = { probe: 'ready' };
  for (let i = 1; i < messagesPerLocale; i++) messages[`message${i}`] = `ko Message ${i} {name}`;
  const base = parseCatalog(JSON.stringify(messages), { locale: 'ko', namespace: 'bench' });
  const schema = createBaseSchema(base);
  const canonical = Object.keys(schema.keys).sort().map(id => [id,
    Object.keys(schema.keys[id]).sort().map(name => [name, [...schema.keys[id][name].acceptedTypes].sort()])]);
  const legacy = `saylo-schema-v1:${JSON.stringify(['bench', canonical])}`;
  const records = locales.slice(0, localeCount).map(locale => locale === 'ko' ? base : { ...base, locale });
  const registry = new CatalogRegistry('00000000-0000-0000-0000-000000000000', 'ko', records);
  registry.replace(records.map(c => c.locale === 'en' ? { ...c, messages: {
    ...c.messages, probe: { ...c.messages.probe, source: 'updated' },
  } } : c));
  const manifest = registry.manifest();
  const frame = manifest => ({ type: 'custom', event: 'saylo:manifest', data: { kind: 'update', baseRevision: 0, manifest } });
  const oldManifest = { ...manifest, catalogs: manifest.catalogs.map(meta => ({ ...meta, namespaceSchemaFingerprint: legacy })) };
  results.push({ messagesPerLocale, localeCount,
    fingerprintCharacters: { before: legacy.length, after: schema.fingerprint.length },
    manifestEnvelopeBytes: { before: Buffer.byteLength(JSON.stringify(frame(oldManifest))),
      after: Buffer.byteLength(JSON.stringify(frame(manifest))) } });
}
const repository = fileURLToPath(new URL('../..', import.meta.url));
const output = { schema: 'saylo-manifest-size-comparison-v1',
  gitRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8', windowsHide: true }).trim(),
  method: 'Reconstructed v1 and v2 manifest update JSON envelopes, UTF-8 byte lengths; not captured network traffic.', results };
const target = new URL('../results/live-update-wire-sizes.json', import.meta.url);
await writeFile(target, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
