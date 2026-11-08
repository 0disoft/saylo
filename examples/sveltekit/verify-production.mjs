import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { handler } from './build/handler.js';

const server = createServer(handler);
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const result = await promisify(execFile)(process.execPath, ['verify-ssr.mjs', origin], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    windowsHide: true, timeout: 60000,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  console.log('[sveltekit] Production adapter HTTP verification passed.');
} finally {
  if (server.listening) await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}
