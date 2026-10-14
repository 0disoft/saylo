import { getContext, setContext } from 'svelte';
import { derived, readable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type { Schema, Store, StoreSnapshot } from '@0disoft/saylo-core';
export type { RichTextProps, RichTextRenderers } from './rich-text.js';

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

export interface SayloSelectorOptions {
  /** Live selection failures retain the last value; defaults to console.error. Initial failures throw. */
  readonly onError?: (error: unknown) => void;
}

type Selection<T> = { kind: 'value'; value: T } | { kind: 'error'; error: unknown };

/** Pure selection; only Object.is changes invalidate or notify downstream subscribers. */
export function selectSvelteStore<S extends Schema, T>(source: SayloSvelteStore<S>,
  selector: (snapshot: SayloSvelteSnapshot<S>) => T, options: SayloSelectorOptions = {}): Readable<T> {
  let previous: Selection<T> | undefined;
  let subscribers = 0;
  const selected = derived<SayloSvelteStore<S>, Selection<T>>(source, (snapshot, set) => {
    let value: T;
    try { value = selector(snapshot); }
    catch (error) {
      if (!subscribers) {
        // Return normally so derived can install its upstream cleanup before subscribe throws.
        previous = { kind: 'error', error };
        set(previous);
      } else {
        try {
          if (options.onError) options.onError(error);
          else console.error('[saylo:svelte] selector failed', error);
        } catch (reportingError) { console.error('[saylo:svelte] selector error reporter failed', reportingError); }
      }
      return;
    }
    if (!previous || previous.kind === 'error' || !Object.is(previous.value, value)) {
      // A box preserves Object.is semantics even for signed zero and stable object references.
      previous = { kind: 'value', value };
      set(previous);
    }
  });
  const store: Readable<T> = {
    subscribe(run, invalidate) {
      let starting = true;
      const first: { state?: Selection<T> } = {};
      const unsubscribe = selected.subscribe(state => {
        if (starting) first.state = state;
        else if (state.kind === 'value') run(state.value);
      }, () => { if (!starting) invalidate?.(); });
      starting = false;
      const state = first.state;
      if (!state) {
        unsubscribe();
        throw new Error('Selector did not produce an initial value.');
      }
      if (state.kind === 'error') {
        unsubscribe();
        throw state.error;
      }
      subscribers++;
      let active = true;
      const stop = () => {
        if (!active) return;
        active = false;
        subscribers--;
        unsubscribe();
      };
      try { run(state.value); } catch (error) { stop(); throw error; }
      return stop;
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
  readonly getI18nSelector: <T>(selector: (snapshot: SayloSvelteSnapshot<S>) => T, options?: SayloSelectorOptions) => Readable<T>;
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
    getI18nSelector<T>(selector: (snapshot: SayloSvelteSnapshot<S>) => T, options?: SayloSelectorOptions) {
      return selectSvelteStore(getI18n(), selector, options);
    },
  });
}
