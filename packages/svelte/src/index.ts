import { getContext, setContext } from 'svelte';
import { derived, readable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type { Schema, Store, StoreSnapshot } from '@0disoft/saylo-core';

export interface SayloInstance<S extends Schema> extends Pick<Store<S>, 'getSnapshot' | 'subscribe'> {
  readonly onDispose?: (listener: () => void) => () => void;
  readonly setLocale: (locale: string) => void | Promise<void>;
  readonly loadNamespace?: (namespace: string) => Promise<void>;
}

export type SayloSvelteSnapshot<S extends Schema> = StoreSnapshot<S> & Readonly<Pick<SayloInstance<S>, 'setLocale' | 'loadNamespace'>>;
export type SayloSvelteStore<S extends Schema> = Readable<SayloSvelteSnapshot<S>>;

/** Shares one upstream subscription while consumers are mounted. The caller owns disposal. */
export function createSvelteStore<S extends Schema>(instance: SayloInstance<S>): SayloSvelteStore<S> {
  let previous = instance.getSnapshot();
  const bind = (snapshot: StoreSnapshot<S>): SayloSvelteSnapshot<S> => Object.freeze({
    ...snapshot, setLocale: instance.setLocale,
    ...(instance.loadNamespace ? { loadNamespace: instance.loadNamespace } : {}),
  });
  let current = bind(previous);
  return Object.freeze(readable(current, set => {
    // Refresh after a period with no subscribers, including Svelte's SSR subscription.
    const publish = (snapshot: StoreSnapshot<S>) => {
      if (snapshot !== previous) { previous = snapshot; current = bind(snapshot); }
      set(current);
    };
    publish(instance.getSnapshot());
    const unsubscribe = instance.subscribe(snapshot => {
      if (snapshot !== previous) publish(snapshot);
    });
    let active = true;
    let offDispose: (() => void) | undefined;
    const stop = () => {
      if (!active) return;
      active = false;
      unsubscribe();
      offDispose?.();
    };
    offDispose = instance.onDispose?.(stop);
    return stop;
  }));
}

/** Pure selection; only Object.is changes invalidate or notify downstream subscribers. */
export function selectSvelteStore<S extends Schema, T>(source: SayloSvelteStore<S>,
  selector: (snapshot: SayloSvelteSnapshot<S>) => T): Readable<T> {
  let previous: { value: T } | undefined;
  const selected = derived<SayloSvelteStore<S>, { value: T }>(source, (snapshot, set) => {
    const value = selector(snapshot);
    if (!previous || !Object.is(previous.value, value)) {
      // A box preserves Object.is semantics even for signed zero and stable object references.
      previous = { value };
      set(previous);
    }
  });
  const store: Readable<T> = {
    subscribe(run, invalidate) {
      return selected.subscribe(box => run(box.value), () => invalidate?.());
    },
  };
  return Object.freeze(store);
}

export interface SayloSvelteBindings<S extends Schema> {
  /** Call during parent component initialization; keep the instance stable. */
  readonly setSayloContext: (instance: SayloInstance<S>) => SayloSvelteStore<S>;
  /** Call during child component initialization, then use $i18n in the template. */
  readonly getI18n: () => SayloSvelteStore<S>;
  /** Call during child initialization; the selection shares the context's upstream store. */
  readonly getI18nSelector: <T>(selector: (snapshot: SayloSvelteSnapshot<S>) => T) => Readable<T>;
}

/** Create once at module scope. Each mounted provider owns its context, including SSR requests. */
export function createSayloSvelte<S extends Schema = Schema>(): SayloSvelteBindings<S> {
  const key = Symbol('Saylo');
  function getI18n(): SayloSvelteStore<S> {
    const store = getContext<SayloSvelteStore<S> | undefined>(key);
    if (!store) throw new Error('getI18n requires setSayloContext from the same createSayloSvelte factory in a parent component.');
    return store;
  }
  return Object.freeze({
    setSayloContext(instance: SayloInstance<S>) {
      return setContext(key, createSvelteStore(instance));
    },
    getI18n,
    getI18nSelector<T>(selector: (snapshot: SayloSvelteSnapshot<S>) => T) {
      return selectSvelteStore(getI18n(), selector);
    },
  });
}
