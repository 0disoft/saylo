import { mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { validateLocaleBrowserStages } from './browser-profile.mjs';
import { beginReplySample, measureReplySync, finishReplySample } from './reply-profile.mjs';
import { validateReplyStages } from './reply-receipt.mjs';

export const localeMetrics = ['saveToListAckMs', 'selectToTranslationAckMs', 'saveToTranslationAckMs',
  'selectToCommitMs', 'saveToBroadcastMs', 'fileWriteMs'];
export const addedLocale = 'en-GB';

export function createLocaleChannel({ scenario, target, samples, warmup, calibrations, timeoutMs, stageProbe, browserStages, replyStages }) {
  const directory = path.join(path.dirname(path.dirname(target.file)), addedLocale);
  const file = path.join(directory, 'bench.json');
  const results = [], roundTrips = [], clients = new Map();
  let current, browser, server, timer, settle, reject;
  let ready = false, finished = false, sequence = 0;
  const completion = new Promise((yes, no) => { settle = yes; reject = no; });
  completion.catch(() => {});
  const fail = error => { if (!finished) { finished = true; clearTimeout(timer); reject(error); } };
  const arm = label => { clearTimeout(timer); timer = setTimeout(() => fail(new Error(`${scenario.id}: timeout waiting for ${label}`)), timeoutMs); };
  const reply = (res, data = {}) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  function expect(data, phase) {
    if (current?.kind !== 'add' || data.token !== current.token || current.phase !== phase)
      throw new Error(`Unexpected locale phase: ${phase}`);
  }
  async function handle(req, res) {
    const route = req.url.split('?')[0];
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 8192) throw new Error('Oversized benchmark request.'); }
    const data = body ? JSON.parse(body) : {};
    if (finished) throw new Error('Benchmark is no longer active.');
    if (route === '/ready') {
      if (ready) throw new Error('Unexpected page reload.');
      ready = true; browser = { ...data, readyAt: performance.now() };
      for (const client of server.ws.clients) {
        const original = client.send;
        const instrumented = function (...args) {
          const frame = args[0];
          const targetReply = current?.kind === 'add' && frame?.event === 'saylo:catalog' && frame.data?.result?.key?.locale === addedLocale;
          if (targetReply) {
            current.replies++;
            current.catalogReply = frame;
          }
          return replyStages && targetReply ? measureReplySync('sendMs', () => original.apply(this, args)) : original.apply(this, args);
        };
        clients.set(client, { original, instrumented }); client.send = instrumented;
      }
      arm('command'); reply(res);
    } else if (route === '/command') {
      if (!ready || current) throw new Error('Overlapping or premature command.');
      const token = `${scenario.id}:${++sequence}`;
      if (roundTrips.length < calibrations) current = { kind: 'calibrate', token, sentAt: performance.now() };
      else if (results.length < samples + warmup) current = { kind: 'add', token, locale: addedLocale,
        expected: `locale:${token}`, phase: 'adding', replies: 0 };
      else { finished = true; clearTimeout(timer); reply(res, { kind: 'done' }); settle({ browser, roundTrips, results }); return; }
      arm('ack'); reply(res, current);
    } else if (route === '/armed') {
      expect(data, 'adding');
      if (current.saveFinishedAt !== undefined) throw new Error('Duplicate locale write.');
      const messages = { ...target.messages, probe: current.expected };
      const source = JSON.stringify(messages);
      await mkdir(directory); // A fresh directory every round; creation time is outside file-save latency.
      current.catalogBytes = Buffer.byteLength(source);
      stageProbe?.begin();
      current.writeStartedAt = performance.now();
      await writeFile(file, source);
      current.saveFinishedAt = performance.now(); reply(res);
    } else if (route === '/listed') {
      const ackAt = performance.now();
      expect(data, 'adding');
      if (current.replies || !Number.isFinite(current.saveFinishedAt) || !Number.isFinite(current.broadcastAt))
        throw new Error('Unexpected pre-selection catalog transfer or missing list timing.');
      // Stop before selection: its full response and the following removal must not
      // be attributed to the server work that made this locale selectable.
      current.serverStages = stageProbe?.finish();
      current.listAckAt = ackAt; current.phase = 'listed'; reply(res);
    } else if (route === '/selecting') {
      expect(data, 'listed'); current.selectingAt = performance.now(); current.phase = 'selecting'; reply(res);
      if (replyStages) beginReplySample(current.selectingAt);
    } else if (route === '/ack') {
      const ackAt = performance.now();
      if (current?.kind === 'calibrate' && data.token === current.token) {
        roundTrips.push(ackAt - current.sentAt); current = undefined; reply(res); return;
      }
      expect(data, 'selecting');
      const frame = current.catalogReply;
      if (data.text !== current.expected || !Number.isFinite(data.selectToCommitMs) || data.selectToCommitMs < 0 ||
          current.replies !== 1 || !['present', 'compact'].includes(frame?.data.result.status) || frame.data.result.key.namespace !== 'bench' || frame.data.request.known)
        throw new Error('Missing fresh full catalog or incorrect first translation.');
      if (browserStages) validateLocaleBrowserStages(data.browserStages, data.selectToCommitMs);
      let replyStageSample;
      if (replyStages) {
        const server = finishReplySample();
        validateReplyStages(server, data.replyReceipt, data.selectToCommitMs, ackAt - current.selectingAt);
        if (server.requestId !== frame.data.request.requestId || server.generation !== frame.data.request.generation)
          throw new Error('Full reply profiling identity mismatch.');
        replyStageSample = { server, browser: data.replyReceipt };
      }
      results.push({ token: current.token, warmup: results.length < warmup,
        saveToListAckMs: current.listAckAt - current.saveFinishedAt,
        selectToTranslationAckMs: ackAt - current.selectingAt,
        saveToTranslationAckMs: ackAt - current.saveFinishedAt,
        selectToCommitMs: data.selectToCommitMs,
        saveToBroadcastMs: current.broadcastAt - current.saveFinishedAt,
        fileWriteMs: current.saveFinishedAt - current.writeStartedAt,
        ...(current.serverStages ? { serverStages: current.serverStages } : {}),
        ...(browserStages ? { browserStages: data.browserStages } : {}),
        ...(replyStageSample ? { replyStages: replyStageSample } : {}),
        addedCatalogBytes: current.catalogBytes, preSelectionCatalogReplies: 0, fullReplies: current.replies,
        catalogReplyEncoding: frame.data.result.encoding ?? 'parsed-catalog',
        catalogReplyBytes: Buffer.byteLength(JSON.stringify(frame)) });
      current.phase = 'translated';
      if (results.length % 10 === 0) console.log(`[bench] ${scenario.id}: ${results.length}/${samples + warmup} locale additions acknowledged`);
      reply(res);
    } else if (route === '/remove') {
      expect(data, 'translated'); current.phase = 'removing'; await unlink(file); reply(res);
    } else if (route === '/removed') {
      expect(data, 'removing'); await rmdir(directory); current = undefined; arm('command'); reply(res);
    } else if (route === '/fail') throw new Error(`Browser failure: ${data.message}`);
    else throw new Error('Unknown locale benchmark route.');
  }
  return { completion, fail, start: () => arm('browser readiness'),
    plugin: { name: 'saylo-locale-add-channel', configureServer(devServer) {
      server = devServer;
      const original = server.ws.send;
      const instrumented = function (...args) {
        const frame = args[0];
        if (current?.kind === 'add' && current.phase === 'adding' && frame?.event === 'saylo:manifest' &&
            frame.data.kind === 'update' && frame.data.manifest.availableLocales.includes(addedLocale)) current.broadcastAt = performance.now();
        return original.apply(this, args);
      };
      server.ws.send = instrumented;
      server.httpServer.once('close', () => { if (server.ws.send === instrumented) server.ws.send = original; });
      server.middlewares.use('/__bench', (req, res) => { void handle(req, res).catch(error => {
        fail(error); if (!res.writableEnded) { res.statusCode = 500; res.end(error.message); }
      }); });
    } },
    dispose() {
      clearTimeout(timer);
      for (const [client, hooks] of clients) if (client.send === hooks.instrumented) client.send = hooks.original;
      clients.clear();
    },
  };
}
