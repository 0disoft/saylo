import { parentPort } from 'node:worker_threads';
import { renderTypes } from './render.js';
import type { TypeSchema } from './render.js';
import { serializeFailure } from './worker-errors.js';

parentPort!.on('message', (job: { generation: number; schemas: readonly TypeSchema[] }) => {
  try { parentPort!.postMessage({ generation: job.generation, source: renderTypes(job.schemas) }); }
  catch (error) {
    const failure = serializeFailure(error);
    parentPort!.postMessage({ generation: job.generation, error: failure.message, failure });
  }
});
