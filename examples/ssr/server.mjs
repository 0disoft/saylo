import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { config } from './config.mjs';
import { createServerCloser } from './server-lifecycle.mjs';

let vite;
const server = createHttpServer((req, res) => vite.middlewares(req, res, async () => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/') { res.writeHead(404).end(); return; }
  try {
    const module = await vite.ssrLoadModule('/entry-server.mjs');
    const { html, boot } = await module.render(url.searchParams.get('locale') ?? 'ko');
    const page = await vite.transformIndexHtml(req.url, `<!doctype html><html><head><meta charset="utf-8"><title>Saylo SSR demo</title></head>
<body><div id="root">${html}</div><script id="saylo-boot" type="application/json">${boot}</script>
<script type="module" src="/client.mjs"></script></body></html>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
  } catch (error) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(error instanceof Error ? error.message : String(error)); }
}));
vite = await createServer({ ...config, server: { middlewareMode: true, hmr: { server } } });
const port = Number(process.env.PORT ?? 5190);
server.listen(port, '127.0.0.1', () => console.log(`Saylo SSR demo: http://127.0.0.1:${port}/?locale=en`));
const closeServers = createServerCloser(vite, server);
const close = () => { void closeServers().catch(error => { console.error(error); process.exitCode = 1; }); };
process.once('SIGINT', close);
process.once('SIGTERM', close);
