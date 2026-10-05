import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

export function createChannel({ scenario, target, samples, warmup, calibrations, timeoutMs }) {
  const results = [];
  const roundTrips = [];
  let current;
  let sequence = 0;
  let ready = false;
  let browser;
  let finished = false;
  let timer;
  let settle, reject;
  const completion = new Promise((yes, no) => { settle = yes; reject = no; });
  // Attach early so a startup failure is never an unhandled rejection while Vite is initializing.
  completion.catch(() => {});
  function fail(error) { if (finished) return; finished = true; clearTimeout(timer); reject(error); }
  function armTimeout(label) {
    clearTimeout(timer);
    timer = setTimeout(() => fail(new Error(`${scenario.id}: timeout waiting for ${label}`)), timeoutMs);
  }
  function reply(res, value) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); }
  function command() {
    const token = `${scenario.id}:${++sequence}`;
    if (roundTrips.length < calibrations) return { kind: 'calibrate', token, sentAt: performance.now() };
    if (results.length < warmup + samples) return { kind: 'edit', token, expected: `saylo:${token}` };
    return { kind: 'done' };
  }
  async function handle(req, res) {
    const route = req.url.split('?')[0];
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('Oversized benchmark request.'); }
    const data = body ? JSON.parse(body) : {};
    if (finished && route !== '/command') throw new Error('Benchmark is no longer active.');
    if (route === '/ready') {
      if (ready) throw new Error('Unexpected page reload invalidated the benchmark.');
      ready = true; browser = { ...data, readyAt: performance.now() }; armTimeout('command'); reply(res, {});
    } else if (route === '/command') {
      if (!ready || current) throw new Error('Overlapping or premature command.');
      current = command();
      reply(res, current);
      if (current.kind === 'done') {
        finished = true; clearTimeout(timer); settle({ browser, roundTrips, results });
      } else armTimeout('ack');
    } else if (route === '/armed') {
      if (current?.kind !== 'edit' || data.token !== current.token || current.saveFinishedAt !== undefined) throw new Error('Invalid edit arm.');
      target.messages.probe = current.expected;
      const text = JSON.stringify(target.messages); // Content preparation excluded from save/commit measurement.
      current.writeStartedAt = performance.now();
      await writeFile(target.file, text);
      current.saveFinishedAt = performance.now();
      reply(res, {});
    } else if (route === '/ack') {
      const acknowledgedAt = performance.now();
      if (!current || data.token !== current.token) throw new Error('Late or incorrect DOM acknowledgement.');
      if (current.kind === 'calibrate') roundTrips.push(acknowledgedAt - current.sentAt);
      else {
        if (data.text !== current.expected || !Number.isFinite(current.saveFinishedAt) ||
            !Number.isFinite(current.broadcastAt) || !Number.isFinite(data.receiveToCommitMs) || data.receiveToCommitMs < 0 ||
            !Number.isFinite(data.commitToAckDispatchMs) || data.commitToAckDispatchMs < 0) throw new Error('Invalid sample timing or DOM text.');
        results.push({ token: current.token, warmup: results.length < warmup,
          saveToAckMs: acknowledgedAt - current.saveFinishedAt,
          saveToManifestBroadcastMs: current.broadcastAt - current.saveFinishedAt,
          fileWriteMs: current.saveFinishedAt - current.writeStartedAt,
          receiveToCommitMs: data.receiveToCommitMs, commitToAckDispatchMs: data.commitToAckDispatchMs });
        if (results.length % 10 === 0) console.log(`[bench] ${scenario.id}: ${results.length}/${warmup + samples} edits acknowledged`);
      }
      current = undefined; armTimeout('next command'); reply(res, {});
    } else if (route === '/fail') throw new Error(`Browser failure: ${data.message}`);
    else throw new Error('Unknown benchmark route.');
  }
  return { completion, fail, start: () => armTimeout('browser readiness'),
    plugin: { name: 'saylo-benchmark-channel', configureServer(server) {
      const original = server.ws.send;
      const instrumented = function (...args) {
        const event = args[0];
        if (current?.kind === 'edit' && event?.event === 'saylo:manifest' && event.data.kind === 'update') current.broadcastAt = performance.now();
        return original.apply(this, args);
      };
      server.ws.send = instrumented;
      server.httpServer.once('close', () => { if (server.ws.send === instrumented) server.ws.send = original; });
      server.middlewares.use('/__bench', (req, res) => { void handle(req, res).catch(error => {
        fail(error); if (!res.writableEnded) { res.statusCode = 500; res.end(error.message); }
      }); });
    } },
    dispose() { clearTimeout(timer); },
  };
}
