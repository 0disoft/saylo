import { createContext, createElement, useContext, useMemo, useSyncExternalStore } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { Schema, Store, StoreSnapshot } from '@saylo/core';

export interface SayloProviderProps<S extends Schema> {
  /** Caller owns the store and its disposal. Keep the instance stable across renders. */
  readonly instance: SayloInstance<S>;
  readonly children?: ReactNode;
}

export interface SayloInstance<S extends Schema> extends Pick<Store<S>, 'getSnapshot' | 'subscribe'> {
  readonly setLocale: (locale: string) => void | Promise<void>;
  readonly loadNamespace?: (namespace: string) => Promise<void>;
}

export type SayloReactSnapshot<S extends Schema> = StoreSnapshot<S> & Readonly<Pick<SayloInstance<S>, 'setLocale' | 'loadNamespace'>>;

export interface SayloReactBindings<S extends Schema> {
  readonly SayloProvider: ComponentType<SayloProviderProps<S>>;
  /** t belongs to this render's immutable snapshot, rather than the live store. */
  readonly useI18n: () => SayloReactSnapshot<S>;
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
    // Stable store functions avoid resubscriptions. SSR boot/hydration is a later stage.
    const snapshot = useSyncExternalStore(instance.subscribe, instance.getSnapshot);
    return useMemo(() => Object.freeze({ ...snapshot, setLocale: instance.setLocale,
      ...(instance.loadNamespace ? { loadNamespace: instance.loadNamespace } : {}) }), [snapshot, instance]);
  }

  return Object.freeze({ SayloProvider, useI18n });
}
