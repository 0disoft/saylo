import type { Readable } from 'svelte/store';

export type ReadableResult<T> = { kind: 'value'; value: T } | { kind: 'error'; error: unknown };

/** Let Svelte finish installing cleanup before propagating an initial failure. */
export function unwrapReadableResult<T>(createSource: (hasSubscribers: () => boolean) => Readable<ReadableResult<T>>): Readable<T> {
  let subscribers = 0;
  const source = createSource(() => subscribers > 0);
  const store: Readable<T> = {
    subscribe(run, invalidate) {
      let starting = true;
      const first: { state?: ReadableResult<T> } = {};
      const unsubscribe = source.subscribe(state => {
        if (starting) first.state = state;
        else if (state.kind === 'value') run(state.value);
      }, () => { if (!starting) invalidate?.(); });
      starting = false;
      const state = first.state;
      if (!state || state.kind === 'error') {
        const error = state?.kind === 'error' ? state.error : new Error('Store did not produce an initial value.');
        try { unsubscribe(); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Initial store read and cleanup failed.', { cause: error }); }
        throw error;
      }
      subscribers++;
      let active = true;
      const stop = () => {
        if (!active) return;
        active = false;
        subscribers--;
        unsubscribe();
      };
      try { run(state.value); }
      catch (error) {
        try { stop(); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Initial subscriber and cleanup failed.', { cause: error }); }
        throw error;
      }
      return stop;
    },
  };
  return Object.freeze(store);
}
