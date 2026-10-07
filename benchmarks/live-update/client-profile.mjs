import { fileURLToPath } from 'node:url';
import { browserStagePlugin, localeBrowserMetrics } from './browser-profile.mjs';

export const clientMetrics = [...localeBrowserMetrics, 'acceptOtherMs', 'snapshotOtherMs',
  'receiveToPublishMs', 'clientOtherMs', 'publishToCommitMs'];
const virtual = 'virtual:saylo-benchmark/client-profile';
const probePath = fileURLToPath(new URL('./client-probe.mjs', import.meta.url)).replaceAll('\\', '/');

export function clientStagePlugins(active) {
  const transform = browserStagePlugin(active, 'locale-add', { probeSpecifier: probePath, trust: true });
  const optimizerTransformed = new Set();
  const optimizer = { name: 'saylo-benchmark-prebundle-client', transform(code, id) {
    const result = transform.transform(code, id);
    if (result) optimizerTransformed.add(id.replaceAll('\\', '/'));
    return result;
  } };
  const plugin = { name: 'saylo-benchmark-client-stages', enforce: 'pre',
    resolveId(id) { if (id === virtual) return active ? probePath : `\0${virtual}`; },
    load(id) {
      if (id === `\0${virtual}`) return 'export const clientStagesEnabled = false; export const beginClientSample = () => {}; export const finishClientSample = () => undefined; export const captureClientPublication = () => {};';
      if (active && id === probePath) return; // Normal file loading, also available to the optimizer.
    },
    transform(code, id) {
      return transform.transform(code, id);
    },
  };
  return { plugin, optimizer, assertTransformed() {
    transform.assertTransformed();
    if (active && ![...optimizerTransformed].some(id => id.endsWith('/packages/core/dist/loading-registry.js')))
      throw new Error('Core acceptance was not instrumented inside normal prebundling.');
  }, optimizerTransformed };
}

export function validateClientStages(sample, receiveToCommitMs) {
  const t = sample?.timings;
  if (!Number.isFinite(receiveToCommitMs) || receiveToCommitMs < 0 ||
      clientMetrics.some(m => !Number.isFinite(t?.[m]) || t[m] < 0) ||
      localeBrowserMetrics.some(m => sample?.calls?.[m] !== 1) ||
      sample?.trust?.locale !== 'en-GB' || sample.trust.namespace !== 'bench' ||
      typeof sample.trust.sameCatalog !== 'boolean' || typeof sample.trust.trusted !== 'boolean')
    throw new Error('Invalid normal-prebundle client observations.');
  const residuals = [t.acceptMs - t.acceptCheckMs - t.acceptFreezeMs - t.acceptOtherMs,
    t.snapshotMs - t.translatorMs - t.signatureMs - t.snapshotOtherMs,
    t.receiveToPublishMs - t.decodeMs - t.freezeMs - t.acceptMs - t.snapshotMs - t.clientOtherMs,
    receiveToCommitMs - t.receiveToPublishMs - t.publishToCommitMs];
  if (residuals.some(n => Math.abs(n) > 0.00001)) throw new Error('Invalid client stage windows.');
}
