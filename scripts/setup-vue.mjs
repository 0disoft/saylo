import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run with npm run setup:vue.');

// npm 12 rejects inherited allow-scripts on project-scoped installs, even
// with ignore-scripts. Omit that option without changing user configuration.
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts'));
const child = spawn(process.execPath, [npmCli, 'ci', '--workspaces=false',
  '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: fileURLToPath(new URL('../tools/vue/', import.meta.url)),
  env, stdio: 'inherit', windowsHide: true,
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  if (signal) console.error(`Vue setup stopped: ${signal}`);
  process.exitCode = code ?? 1;
});
