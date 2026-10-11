import { readFileSync } from 'node:fs';
import { version } from 'vite';

/** Build/development metadata only; never env variables or browser fingerprints. */
export function supportEnvironment(adapter) {
  const packageVersion = id => JSON.parse(readFileSync(new URL(`../../packages/${id}/package.json`, import.meta.url), 'utf8')).version;
  return { runtime: 'browser', node: process.versions.node, vite: version,
    sayloCore: packageVersion('core'), sayloVite: packageVersion('vite'),
    ...(adapter === 'react' ? { sayloReact: packageVersion('react') } : {}),
    ...(adapter === 'svelte' ? { sayloSvelte: packageVersion('svelte') } : {}),
  };
}
