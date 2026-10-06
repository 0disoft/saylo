import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

export function createChannel({ scenario, target, samples, warmup, calibrations, timeoutMs, awaitCompilerIdle }) {
  const results = [], roundTrips = [];
  let current, browser, timer, settle, reject, finished = false, sequence = 0;
  const documents = new Set();
  const completion = new Promise((yes, no) => { settle = yes; reject = no; });
  completion.catch(() => {});
  const fail = error => { if (!finished) { finished = true; clearTimeout(timer); reject(error); } };
  const arm = label => { clearTimeout(timer); timer = setTimeout(() => fail(new Error(`${scenario.id}: timeout waiting for ${label}`)), timeoutMs); };
  const reply = (res, data = {}) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  async function handle(req, res) {
    const route = req.url.split('?')[0];
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('Oversized benchmark request.'); }
    const data = body ? JSON.parse(body) : {};
    if (finished) throw new Error('Benchmark is no longer active.');
    if (route === '/ready') {
      if (!data.documentId || documents.has(data.documentId)) throw new Error('Duplicate document readiness.');
      const initial = documents.size === 0;
      documents.add(data.documentId);
      if (initial) browser = { ...data, readyAt: performance.now() };
      else if (current?.kind === 'edit') current.reloads++;
      else throw new Error('Reload outside an edit.');
      reply(res, { initial }); arm('command');
    } else if (route === '/command') {
      if (!browser) throw new Error('Premature command.');
      if (!current) await awaitCompilerIdle();
      if (!current) {
        const token = `${scenario.id}:${++sequence}`;
        if (roundTrips.length < calibrations) current = { kind: 'calibrate', token, sentAt: performance.now() };
        else if (results.length < samples + warmup) current = { kind: 'edit', token, expected: `saylo:${token}`, reloads: 0 };
        else { reply(res, { kind: 'done' }); finished = true; clearTimeout(timer); settle({ browser, roundTrips, results, documentCount: documents.size }); return; }
      }
      reply(res, { ...current, saved: Number.isFinite(current.saveFinishedAt) }); arm('ack');
    } else if (route === '/armed') {
      if (current?.kind !== 'edit' || data.token !== current.token || current.saveFinishedAt !== undefined) throw new Error('Invalid arm.');
      target.messages.probe = current.expected;
      const source = JSON.stringify(target.messages);
      current.writeStartedAt = performance.now();
      await writeFile(target.file, source);
      current.saveFinishedAt = performance.now(); reply(res);
    } else if (route === '/ack') {
      const ackAt = performance.now();
      if (!current || data.token !== current.token) throw new Error('Incorrect acknowledgement.');
      if (current.kind === 'calibrate') roundTrips.push(ackAt - current.sentAt);
      else {
        if (data.text !== current.expected || !Number.isFinite(current.saveFinishedAt) ||
            !Number.isFinite(data.commitToAckDispatchMs) || data.commitToAckDispatchMs < 0 || !documents.has(data.documentId))
          throw new Error('Invalid DOM sample.');
        results.push({ token: current.token, warmup: results.length < warmup,
          saveToAckMs: ackAt - current.saveFinishedAt, fileWriteMs: current.saveFinishedAt - current.writeStartedAt,
          commitToAckDispatchMs: data.commitToAckDispatchMs, reloads: current.reloads,
          inputNodePreserved: data.inputNodePreserved, inputValuePreserved: data.inputValuePreserved,
          componentStatePreserved: data.componentStatePreserved });
        if (results.length % 10 === 0) console.log(`[paraglide] ${scenario.id}: ${results.length}/${samples + warmup} edits`);
      }
      current = undefined; reply(res); arm('next command');
    } else if (route === '/fail') throw new Error(`Browser failure: ${data.message}`);
    else throw new Error('Unknown benchmark route.');
  }
  return { completion, fail, start: () => arm('browser readiness'), dispose: () => clearTimeout(timer),
    plugin: { name: 'paraglide-benchmark-channel', configureServer(server) {
      server.middlewares.use('/__bench', (req, res) => { void handle(req, res).catch(error => {
        fail(error); if (!res.writableEnded) { res.statusCode = 500; res.end(error.message); }
      }); });
    } } };
}
