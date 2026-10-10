import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseCatalog } from '@0disoft/saylo-core';

const probe = new URL('./parser-probe.mjs', import.meta.url).href;
const catalog = new URL('../../packages/core/dist/catalog.js', import.meta.url).href;
const options = { locale: 'en', namespace: 'bench', sourceName: 'en/bench.json' };
const fixtures = [
  '{"plain":"literal","arg":"Hello {name}"}',
  '{\r\n "unicode":"😀 한글\\n{name}", "icu":"{n, plural, one {one} other {#}}", "skeleton":"{n, number, ::currency/USD}"\r\n}',
  '{"x":"{broken"}',
  '{"x":"first","x":"duplicate"}',
];
function outcome(parse, source) {
  try { return { catalog: parse(source, options) }; }
  catch (error) { return { name: error.name, diagnostics: error.diagnostics }; }
}

test('parser probes preserve results, diagnostics, freeze and incremental identity without changing dist', async () => {
  const files = ['catalog.js', 'catalog-json.js', 'json.js', 'schema.js', 'diagnostics.js', 'simple-message.js'];
  const hashes = async () => Promise.all(files.map(async file => createHash('sha256').update(await readFile(new URL(`../../packages/core/dist/${file}`, import.meta.url))).digest('hex')));
  const before = await hashes();
  const expected = JSON.parse(JSON.stringify(fixtures.map(source => outcome(parseCatalog, source))));
  for (const detailed of [false, true]) {
    // Isolate the module cache so schema and catalog load through the real hooks.
    const code = `
      import assert from 'node:assert/strict';
      import { registerParserProbe, beginParserSample, finishParserSample, parserMetrics, parserDetailMetrics, messageFreezeMetrics } from ${JSON.stringify(probe)};
      const hooks = registerParserProbe({ detailed: ${detailed} });
      try {
        const { parseCatalog } = await import(${JSON.stringify(catalog)});
        const options = ${JSON.stringify(options)};
        const fixtures = ${JSON.stringify(fixtures)};
        const results = [];
        function verifyFrozen(value) {
          if (value === null || typeof value !== 'object') return;
          assert.ok(Object.isFrozen(value));
          for (const child of Object.values(value)) verifyFrozen(child);
        }
        for (const source of fixtures) {
          beginParserSample(${detailed});
          let result;
          try { result = { catalog: parseCatalog(source, options) }; verifyFrozen(result.catalog); }
          catch (error) { if (!error.diagnostics) throw error; result = { name: error.name, diagnostics: error.diagnostics }; }
          const sample = finishParserSample();
          const metrics = ${detailed} ? [...parserMetrics, ...parserDetailMetrics] : parserMetrics;
          for (const metric of metrics) assert.ok(Number.isFinite(sample[metric]) && sample[metric] >= 0, metric);
          if (result.catalog && ${detailed}) {
            const count = Object.keys(result.catalog.messages).length;
            for (const metric of ['messageFreezeMs', ...messageFreezeMetrics]) assert.equal(sample.calls[metric], count);
            assert.ok(messageFreezeMetrics.reduce((sum, metric) => sum + sample[metric], 0) <= sample.messageFreezeMs + .00001);
          }
          if (!${detailed}) assert.ok(!('messagePositionMs' in sample));
          results.push(result);
        }
        const source = fixtures[0];
        const previous = parseCatalog(source, options);
        beginParserSample(${detailed});
        const unchanged = parseCatalog(source, options, previous);
        const reused = finishParserSample();
        assert.equal(unchanged.messages.arg, previous.messages.arg);
        if (${detailed}) for (const metric of ['messageFreezeMs', ...messageFreezeMetrics]) assert.equal(reused.calls[metric], 0);
        beginParserSample(${detailed});
        const shifted = parseCatalog('\\n' + source, options, previous);
        const shiftedSample = finishParserSample();
        assert.equal(shifted.messages.arg.ast, previous.messages.arg.ast);
        assert.equal(shifted.messages.arg.position.line, 2);
        if (${detailed}) assert.equal(shiftedSample.calls.reusedMessageFreezeMs, 2);
        hooks.assertTransformed();
        console.log(JSON.stringify(results));
      } finally { hooks.dispose(); }
    `;
    const results = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(results), expected);
  }
  assert.deepEqual(await hashes(), before);
});
