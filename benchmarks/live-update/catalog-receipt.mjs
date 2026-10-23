// Shared by the Node channel and browser probe; no product code is instrumented.
export function catalogReceipt(event, data, locale = 'en', namespace = 'bench') {
  const outcomes = event === 'saylo:catalog-push' && data?.kind === 'patch' ? data.outcomes
    : event === 'saylo:catalog' ? [data?.result] : [];
  if (!Array.isArray(outcomes)) return;
  const result = outcomes.find(outcome => outcome?.key?.locale === locale && outcome.key.namespace === namespace &&
    ['present', 'compact', 'patch'].includes(outcome.status));
  if (!result) return;
  const source = result.status === 'compact' ? result.catalog.messages.find(([id]) => id === 'probe')?.[1]
    : (result.status === 'patch' ? result.upsert.find(([id]) => id === 'probe')?.[1] : result.catalog.messages.probe)?.source;
  if (source === undefined) return;
  return { result, source, transport: event === 'saylo:catalog-push' ? 'push' : 'request' };
}
