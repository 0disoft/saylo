import { createContext, createElement, useContext, useMemo, useSyncExternalStore } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { Schema, Store, StoreSnapshot } from '@0disoft/saylo-core';
export { createHydrationAdapter } from './hydration.js';
export type { SayloHydrationAdapter } from './hydration.js';
export { renderRichText } from './rich-text.js';
export type { RichTextRenderers } from './rich-text.js';

export interface SayloProviderProps<S extends Schema> {
  /** Caller owns the store and its disposal. Keep the instance stable across renders. */
  readonly instance: SayloInstance<S>;
  readonly children?: ReactNode;
}

export interface SayloInstance<S extends Schema> extends Pick<Store<S>, 'getSnapshot' | 'subscribe'> {
  readonly getServerSnapshot?: () => StoreSnapshot<S>;
  readonly onDispose?: (listener: () => void) => () => void;
  readonly setLocale: (locale: string) => void | Promise<void>;
  readonly loadNamespace?: (namespace: string) => Promise<void>;
}

export type SayloReactSnapshot<S extends Schema> = StoreSnapshot<S> & Readonly<Pick<SayloInstance<S>, 'setLocale' | 'loadNamespace'>>;

export interface SayloReactBindings<S extends Schema> {
  readonly SayloProvider: ComponentType<SayloProviderProps<S>>;
  /** t belongs to this render's immutable snapshot, rather than the live store. */
  readonly useI18n: () => SayloReactSnapshot<S>;
  /** Pure selection; React compares the selected value with Object.is. */
  readonly useI18nSelector: <T>(selector: (snapshot: SayloReactSnapshot<S>) => T) => T;
}

function bindSnapshot<S extends Schema>(instance: SayloInstance<S>, snapshot: StoreSnapshot<S>): SayloReactSnapshot<S> {
  return Object.freeze({ ...snapshot, setLocale: instance.setLocale,
    ...(instance.loadNamespace ? { loadNamespace: instance.loadNamespace } : {}) });
}

/** Create once at module scope; the provider and hook share the same typed context. */
export function createSayloReact<S extends Schema = Schema>(): SayloReactBindings<S> {
  const Context = createContext<SayloInstance<S> | null>(null);
  Context.displayName = 'Saylo';

  function SayloProvider({ instance, children }: SayloProviderProps<S>) {
    return createElement(Context.Provider, { value: instance }, children);
  }

  function useI18n(): SayloReactSnapshot<S> {
    const instance = useContext(Context);
    if (!instance) throw new Error('useI18n must be used inside the SayloProvider from the same createSayloReact factory.');
    const snapshot = useSyncExternalStore(instance.subscribe, instance.getSnapshot, instance.getServerSnapshot);
    return useMemo(() => bindSnapshot(instance, snapshot), [snapshot, instance]);
  }

  function useI18nSelector<T>(selector: (snapshot: SayloReactSnapshot<S>) => T): T {
    const instance = useContext(Context);
    if (!instance) throw new Error('useI18nSelector must be used inside the SayloProvider from the same createSayloReact factory.');
    const activeInstance = instance;
    // Keep caches in this render's closure, so concurrent renders do not replace one another's selector.
    const readers = useMemo(() => {
      function select(readSnapshot: () => StoreSnapshot<S>) {
        let cached: { snapshot: StoreSnapshot<S>; value: T } | undefined;
        return () => {
          const snapshot = readSnapshot();
          if (!cached || cached.snapshot !== snapshot) {
            // Commit the cache only after selection succeeds; failed reads must keep throwing.
            const value = selector(bindSnapshot(activeInstance, snapshot));
            cached = { snapshot, value };
          }
          return cached.value;
        };
      }
      return { getSnapshot: select(instance.getSnapshot),
        getServerSnapshot: instance.getServerSnapshot ? select(instance.getServerSnapshot) : undefined };
    }, [instance, selector]);
    return useSyncExternalStore(instance.subscribe, readers.getSnapshot, readers.getServerSnapshot);
  }

  return Object.freeze({ SayloProvider, useI18n, useI18nSelector });
}
