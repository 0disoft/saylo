import { createServer as createHttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { config } from './config.mjs';
import { createServerCloser } from '../ssr/server-lifecycle.mjs';

export async function startServer({ port = 5193, viteConfig = config } = {}) {
  let vite;
  const server = createHttpServer((req, res) => vite.middlewares(req, res, async () => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/') { res.writeHead(404).end(); return; }
    try {
      const module = await vite.ssrLoadModule('/entry-server.mjs');
      const { html, boot, locale } = await module.render(url.searchParams.get('locale') ?? 'ko');
      const page = await vite.transformIndexHtml(req.url,
        `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Saylo Vue SSR</title></head>
<body><div id="root">${html}</div><script id="saylo-boot" type="application/json">${boot}</script>
<script type="module" src="/entry-client.mjs"></script></body></html>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
    } catch (error) {
      vite.ssrFixStacktrace(error);
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(error instanceof Error ? error.message : String(error));
    }
  }));
  try {
    vite = await createServer({ ...viteConfig, server: { middlewareMode: true, hmr: { server } } });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch (error) {
    try { await createServerCloser(vite, server)(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'SSR startup and cleanup failed.', { cause: error }); }
    throw error;
  }
  const close = createServerCloser(vite, server);
  return { vite, url: `http://127.0.0.1:${server.address().port}/`, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = await startServer({ port: Number(process.env.PORT ?? 5193) });
  console.log(`Saylo Vue SSR: ${demo.url}?locale=en`);
  const close = () => { void demo.close().catch(error => { console.error(error); process.exitCode = 1; }); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
