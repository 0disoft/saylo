import { parseArgs } from 'node:util';
import { loadProjectConfig } from './config.js';
import { createCliCancellation } from './cli-cancellation.js';
import { startReviewServer } from './review-server.js';

export async function runReview(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: { config: { type: 'string' }, port: { type: 'string' },
    metadata: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log('Usage: saylo review [--config saylo.config.json] [--metadata notes.json] [--port 0]\nLocal translation editor on 127.0.0.1. Preview, save and approval are separate actions. Ctrl+C stops it.');
    return;
  }
  const port = Number(values.port ?? 0);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535 || (values.port !== undefined && !/^\d+$/.test(values.port)))
    throw new TypeError('Review port must be an integer from 0 to 65535.');
  const config = loadProjectConfig(values.config ?? 'saylo.config.json');
  const cancellation = createCliCancellation();
  let server: Awaited<ReturnType<typeof startReviewServer>> | undefined;
  try {
    server = await startReviewServer(config, { port, signal: cancellation.signal,
      ...(values.metadata === undefined ? {} : { metadataFile: values.metadata }) });
    console.log(`[saylo:review] Open ${server.url}; Ctrl+C to stop.`);
    await new Promise<void>(resolve => {
      if (cancellation.signal.aborted) { resolve(); return; }
      cancellation.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    cancellation.throwIfCancelled();
  } finally { await server?.close(); cancellation.dispose(); }
}
