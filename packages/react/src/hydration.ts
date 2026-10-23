import type { Schema, StoreSnapshot } from '@0disoft/saylo-core';
import type { SayloInstance } from './index.js';

export interface SayloHydrationAdapter<S extends Schema> extends SayloInstance<S> {
  readonly getServerSnapshot: () => StoreSnapshot<S>;
  /** Caller ends the initial hydration barrier; buffered snapshots collapse into the latest one. */
  finishHydration(): void;
  /** Releases this adapter's subscriptions; the caller still owns the underlying instance. */
  dispose(): void;
}

/** Create once per hydration root, before connecting live updates. */
export function createHydrationAdapter<S extends Schema = Schema>(instance: SayloInstance<S>): SayloHydrationAdapter<S> {
  const boot = instance.getServerSnapshot?.() ?? instance.getSnapshot();
  let current = boot;
  let latest = instance.getSnapshot();
  let holding = true;
  let disposed = false;
  let notifying = false;
  const pending: StoreSnapshot<S>[] = [];
  const listeners = new Set<{ callback: (snapshot: StoreSnapshot<S>) => void }>();
  function publish() {
    if (holding || disposed) return;
    // Barrier release runs outside the store's notification loop; listeners can synchronously commit again.
    pending.push(latest);
    if (notifying) return;
    notifying = true;
    const errors: unknown[] = [];
    let cursor = 0;
    try {
      while (cursor < pending.length && !disposed) {
        const next = pending[cursor++]!;
        if (next === current) continue;
        current = next;
        for (const listener of [...listeners]) {
          if (!listeners.has(listener)) continue;
          try { listener.callback(current); } catch (error) { errors.push(error); }
        }
      }
    } finally { pending.length = 0; notifying = false; }
    if (errors.length) throw new AggregateError(errors, 'Subscriber failures after hydration snapshot commit.');
  }
  const off = instance.subscribe(snapshot => { latest = snapshot; publish(); });
  let offDispose: (() => void) | undefined;
  function dispose() {
    if (disposed) return;
    disposed = true;
    pending.length = 0;
    listeners.clear();
    const unregister = offDispose;
    offDispose = undefined;
    const errors: unknown[] = [];
    for (const release of [off, unregister]) try { release?.(); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Hydration adapter cleanup failed.', { cause: errors[0] });
  }
  try {
    offDispose = instance.onDispose?.(dispose);
    if (disposed) {
      const unregister = offDispose;
      offDispose = undefined;
      unregister?.();
    }
  } catch (error) {
    try { dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Hydration setup and cleanup failed.', { cause: error }); }
    throw error;
  }
  return Object.freeze({
    getSnapshot: () => current,
    // Keep this fixed even after the barrier, so a late hydrating subtree still reads the server's S1.
    getServerSnapshot: () => boot,
    subscribe(callback: (snapshot: StoreSnapshot<S>) => void) {
      if (disposed) throw new Error('Hydration adapter is disposed.');
      const listener = { callback }; listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setLocale: instance.setLocale,
    ...(instance.loadNamespace ? { loadNamespace: instance.loadNamespace } : {}),
    ...(instance.setNamespaces ? { setNamespaces: instance.setNamespaces } : {}),
    finishHydration() { if (!holding || disposed) return; holding = false; publish(); },
    dispose,
  });
}
