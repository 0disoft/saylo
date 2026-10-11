import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run with npm run setup:sveltekit.');

// npm 12 exports allow-scripts into lifecycle environments, but rejects that
// inherited CLI option for a project-scoped install, even with ignore-scripts.
// Keep the user configuration intact and omit only this inherited option.
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts'));
const child = spawn(process.execPath, [npmCli, 'ci', '--workspaces=false',
  '--ignore-scripts', '--no-audit', '--no-fund'], {
  cwd: fileURLToPath(new URL('../examples/sveltekit/', import.meta.url)),
  env, stdio: 'inherit', windowsHide: true,
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  if (signal) console.error(`SvelteKit setup stopped: ${signal}`);
  process.exitCode = code ?? 1;
});
