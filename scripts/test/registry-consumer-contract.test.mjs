import assert from 'node:assert/strict';
import test from 'node:test';
import { registryConsumerContract } from '../registry-consumer-contract.mjs';

test('historical releases retain their consumer while new releases require the support contract', () => {
  for (const version of ['0.1.0-alpha.1', '0.1.0-alpha.2', '0.1.0-alpha.3', '0.1.0-alpha.4']) {
    assert.deepEqual(registryConsumerContract(version), { support: false, sveltekitFixture: 'sveltekit-registry' });
  }
  for (const version of ['0.1.0-alpha.5', '0.1.0-alpha.10', '0.1.0-beta.1', '0.1.0', '1.0.0']) {
    assert.deepEqual(registryConsumerContract(version), { support: true, sveltekitFixture: 'sveltekit-registry-alpha5' });
  }
  for (const version of [undefined, '../version', '0.1.0-alpha.4-extra', 'alpha'])
    assert.throws(() => registryConsumerContract(version), /Invalid registry consumer version/);
});
