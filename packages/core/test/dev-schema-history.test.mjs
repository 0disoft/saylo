import assert from 'node:assert/strict';
import test from 'node:test';
import { InvalidArgumentError, UnknownMessageError } from '@0disoft/saylo-core';
import { createDevSchemaRecovery } from '../dist/dev-schema-recovery.js';

const args = names => Object.fromEntries(names.map(name => [name, { required: true, acceptedTypes: ['string'] }]));
const plan = text => ({ arguments: args(['name']), message: { source: text }, sourceLocale: 'en' });
function bind(history, locale = 'en') {
  const scope = history.scope(locale, 'en', 'UTC'), render = {};
  history.track(render, scope); history.activate(render);
  return scope;
}

test('history recovers only a removed key or a newly required missing argument and defers diagnostics', async () => {
  const events = [], history = createDevSchemaRecovery({ onDiagnostic: event => events.push(event) });
  const old = bind(history);
  history.remember(old, 'demo:title', 'text', plan('Hello'));
  const current = bind(history), contract = args(['name', 'extra']);
  const error = new InvalidArgumentError('demo:title', 'extra', 'missing');
  const recover = (failure, values = { name: 'Ada' }, surface = 'text', schema = contract) =>
    history.recover(current, failure, 'demo:title', values, surface, schema, entry => entry.message.source);
  assert.equal(recover(error), 'Hello'); assert.deepEqual(events, []);
  assert.equal(recover(error), 'Hello');
  await Promise.resolve(); assert.equal(events.length, 1); assert.equal(events[0].status, 'retained');
  assert.equal(recover(error, { name: 'Ada', extra: false }), undefined);
  assert.equal(recover(new InvalidArgumentError('demo:title', 'name', 'wrong type')), undefined);
  assert.equal(recover(error, { name: 'Ada' }, 'parts'), undefined);
  assert.equal(history.recover(current, new UnknownMessageError('demo:title'), 'demo:title', { name: 'Ada' },
    'text', undefined, entry => entry.message.source), 'Hello');
  assert.equal(history.recover(current, error, 'demo:title', {}, 'text', contract, () => { throw new Error('old args invalid'); }), undefined);
});

test('bounded history never retains output values and does not leak between locales', () => {
  const history = createDevSchemaRecovery({ maxEntries: 1 }), first = bind(history);
  history.remember(first, 'demo:old', 'text', plan('Old'));
  history.remember(first, 'demo:new', 'text', plan('New'));
  const current = bind(history);
  const recover = (scope, key) => history.recover(scope, new UnknownMessageError(key), key, undefined, 'text', undefined, entry => entry.message.source);
  assert.equal(recover(current, 'demo:old'), undefined);
  assert.equal(recover(current, 'demo:new'), 'New');
  assert.equal(recover(bind(history, 'fr'), 'demo:new'), undefined);
  history.clear();
});

test('snapshot history remains fixed and stale reads cannot replace active history', () => {
  const history = createDevSchemaRecovery({}), first = bind(history);
  history.remember(first, 'demo:title', 'text', plan('First'));
  const second = bind(history);
  history.remember(second, 'demo:title', 'text', plan('Second'));
  history.remember(first, 'demo:title', 'text', plan('Stale'));
  const third = bind(history);
  const recover = scope => history.recover(scope, new UnknownMessageError('demo:title'), 'demo:title', undefined,
    'text', undefined, entry => entry.message.source);
  assert.equal(recover(second), 'First'); assert.equal(recover(third), 'Second');
  history.clear();
});

test('successful reads resolve diagnostics and disposal cancels pending notifications', async () => {
  const events = [], history = createDevSchemaRecovery({ onDiagnostic: event => events.push(event.status) });
  const first = bind(history); history.remember(first, 'demo:title', 'text', plan('First'));
  const second = bind(history), error = new UnknownMessageError('demo:title');
  history.recover(second, error, error.key, undefined, 'text', undefined, () => 'First');
  await Promise.resolve(); assert.deepEqual(events, ['retained']);
  history.remember(second, error.key, 'text', plan('Fixed'));
  await Promise.resolve(); assert.deepEqual(events, ['retained', 'resolved']);
  history.recover(bind(history), error, error.key, undefined, 'text', undefined, () => 'Fixed');
  history.clear(); await Promise.resolve(); assert.deepEqual(events, ['retained', 'resolved']);
});

test('invalid options fail early and disabled recovery allocates no history', () => {
  assert.equal(createDevSchemaRecovery(undefined), undefined); assert.equal(createDevSchemaRecovery(false), undefined);
  for (const maxEntries of [0, -1, 1.5, Infinity]) assert.throws(() => createDevSchemaRecovery({ maxEntries }), RangeError);
  assert.throws(() => createDevSchemaRecovery(true), TypeError);
  assert.throws(() => createDevSchemaRecovery({ onDiagnostic: 'wrong' }), TypeError);
});
