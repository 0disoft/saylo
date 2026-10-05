import { parentPort } from 'node:worker_threads';
import { renderTypes } from './render.js';
import type { TypeSchema } from './render.js';

parentPort!.on('message', (job: { generation: number; schemas: readonly TypeSchema[] }) => {
  try { parentPort!.postMessage({ generation: job.generation, source: renderTypes(job.schemas) }); }
  catch (error) { parentPort!.postMessage({ generation: job.generation, error: error instanceof Error ? error.message : String(error) }); }
});
