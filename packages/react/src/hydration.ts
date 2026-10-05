import type { Schema, StoreSnapshot } from '@saylo/core';
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
  const listeners = new Set<{ callback: (snapshot: StoreSnapshot<S>) => void }>();
  function publish() {
    if (holding || disposed || current === latest) return;
    current = latest;
    const errors: unknown[] = [];
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try { listener.callback(current); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Subscriber failures after hydration snapshot commit.');
  }
  const off = instance.subscribe(snapshot => { latest = snapshot; publish(); });
  let offDispose: (() => void) | undefined;
  function dispose() {
    if (disposed) return;
    disposed = true;
    off(); offDispose?.(); listeners.clear();
  }
  try { offDispose = instance.onDispose?.(dispose); }
  catch (error) { dispose(); throw error; }
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
    finishHydration() { if (!holding || disposed) return; holding = false; publish(); },
    dispose,
  });
}
