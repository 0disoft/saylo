import assert from 'node:assert/strict';

// alpha.1-alpha.4 predate the development-state/support contract. Later releases
// must satisfy it, rather than silently skipping it when an export is missing.
export function registryConsumerContract(version) {
  assert.match(version ?? '', /^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/, 'Invalid registry consumer version.');
  const support = !/^0\.1\.0-alpha\.[1-4]$/.test(version);
  return { support, sveltekitFixture: support ? 'sveltekit-registry-alpha5' : 'sveltekit-registry' };
}
