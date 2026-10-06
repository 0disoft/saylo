import { mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

export const metrics = ['saveToListAckMs', 'selectToTranslationAckMs', 'saveToTranslationAckMs', 'fileWriteMs'];
export function createLocaleChannel({ scenario, fixture, samples, warmup, calibrations, timeoutMs, awaitCompilerIdle }) {
  const results = [], roundTrips = [], documents = new Set();
  const directory = path.join(path.dirname(path.dirname(fixture.target.file)), 'en-GB');
  const file = path.join(directory, 'bench.json');
  let current, browser, timer, settle, reject, finished = false, sequence = 0;
  const completion = new Promise((yes, no) => { settle = yes; reject = no; }); completion.catch(() => {});
  const fail = error => { if (!finished) { finished = true; clearTimeout(timer); reject(error); } };
  const arm = label => { clearTimeout(timer); timer = setTimeout(() => fail(new Error(`${scenario.id}: timeout waiting for ${label}`)), timeoutMs); };
  const reply = (res, data = {}) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  function expect(data, phase) { if (current?.kind !== 'add' || current.phase !== phase || current.token !== data.token) throw new Error(`Unexpected phase ${phase}.`); }
  const preservation = data => ({ inputNodePreserved: data.inputNodePreserved === true,
    inputValuePreserved: data.inputValuePreserved === true, componentStatePreserved: data.componentStatePreserved === true });
  async function handle(req, res) {
    const route = req.url.split('?')[0]; let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('Oversized benchmark request.'); }
    const data = body ? JSON.parse(body) : {};
    if (finished) throw new Error('Benchmark is no longer active.');
    if (route === '/ready') {
      if (!data.documentId || documents.has(data.documentId)) throw new Error('Duplicate document readiness.');
      const initial = documents.size === 0; documents.add(data.documentId);
      if (initial) browser = { ...data, readyAt: performance.now() };
      else if (current?.kind === 'add') current.reloads[current.phase] = (current.reloads[current.phase] ?? 0) + 1;
      // A generated-output reload can arrive just after removal was acknowledged.
      // Count the document globally; it belongs to reset, outside list/selection timings.
      else if (current) throw new Error('Reload during calibration.');
      reply(res, { initial }); arm('command');
    } else if (route === '/command') {
      if (!browser) throw new Error('Premature command.');
      if (!current) await awaitCompilerIdle();
      if (!current) {
        const token = `${scenario.id}:${++sequence}`;
        if (roundTrips.length < calibrations) current = { kind: 'calibrate', token, sentAt: performance.now() };
        else if (results.length < samples + warmup) current = { kind: 'add', token, locale: 'en-GB', expected: `locale:${token}`, phase: 'adding', reloads: {} };
        else { reply(res, { kind: 'done' }); finished = true; clearTimeout(timer); settle({ browser, roundTrips, results, documentCount: documents.size }); return; }
      }
      reply(res, { ...current, saved: Number.isFinite(current.saveFinishedAt) }); arm('ack');
    } else if (route === '/armed') {
      expect(data, 'adding'); if (current.saveFinishedAt !== undefined) throw new Error('Duplicate arm.');
      const source = JSON.stringify({ ...fixture.target.messages, probe: current.expected });
      const settings = JSON.stringify({ ...fixture.settings, locales: [...fixture.settings.locales, current.locale] });
      await mkdir(directory);
      current.addedCatalogBytes = Buffer.byteLength(source);
      current.writeStartedAt = performance.now();
      await writeFile(file, source);
      current.catalogSavedAt = performance.now();
      await writeFile(fixture.settingsFile, settings);
      current.saveFinishedAt = performance.now(); reply(res);
    } else if (route === '/listed') {
      const ackAt = performance.now(); expect(data, 'adding');
      if (!Number.isFinite(current.saveFinishedAt)) throw new Error('Missing save timing.');
      current.listAckAt = ackAt; current.listPreservation = preservation(data); current.phase = 'listed'; reply(res);
    } else if (route === '/selecting') {
      expect(data, 'listed'); current.selectingAt = performance.now(); current.phase = 'selecting'; reply(res);
    } else if (route === '/ack') {
      const ackAt = performance.now();
      if (current?.kind === 'calibrate' && current.token === data.token) { roundTrips.push(ackAt - current.sentAt); current = undefined; reply(res); return; }
      expect(data, 'selecting');
      if (data.text !== current.expected || !documents.has(data.documentId)) throw new Error('Incorrect first translation.');
      results.push({ token: current.token, warmup: results.length < warmup,
        saveToListAckMs: current.listAckAt - current.saveFinishedAt,
        selectToTranslationAckMs: ackAt - current.selectingAt, saveToTranslationAckMs: ackAt - current.saveFinishedAt,
        fileWriteMs: current.saveFinishedAt - current.writeStartedAt, catalogToSettingsSaveMs: current.saveFinishedAt - current.catalogSavedAt,
        addedCatalogBytes: current.addedCatalogBytes, listPreservation: current.listPreservation,
        translationPreservation: preservation(data), listReloads: current.reloads.adding ?? 0, selectionReloads: current.reloads.selecting ?? 0 });
      current.phase = 'resetting'; reply(res);
      if (results.length % 5 === 0) console.log(`[paraglide] ${scenario.id}: ${results.length}/${samples + warmup} additions`);
    } else if (route === '/remove') {
      expect(data, 'resetting'); current.phase = 'removing';
      await writeFile(fixture.settingsFile, JSON.stringify(fixture.settings)); await unlink(file); reply(res);
    } else if (route === '/removed') {
      expect(data, 'removing'); await rmdir(directory); current = undefined; arm('command'); reply(res);
    } else if (route === '/fail') throw new Error(`Browser failure: ${data.message}`);
    else throw new Error('Unknown benchmark route.');
  }
  return { completion, fail, start: () => arm('browser readiness'), dispose: () => clearTimeout(timer),
    plugin: { name: 'paraglide-locale-channel', configureServer(server) {
      server.middlewares.use('/__bench', (req, res) => { void handle(req, res).catch(error => {
        fail(error); if (!res.writableEnded) { res.statusCode = 500; res.end(error.message); }
      }); });
    } } };
}
