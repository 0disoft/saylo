import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run npm run audit:dependencies.');
// npm run exports allow-scripts from .npmrc as an env override, but newer npm
// rejects this flag in project-scoped commands. Audit does not install or run scripts.
const env = Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.toLowerCase() !== 'npm_config_allow_scripts'));
const result = spawnSync(process.execPath, [npmCli, 'audit', '--audit-level=low', ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), env, windowsHide: true, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
