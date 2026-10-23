import { getContext, setContext } from 'svelte';
import { derived, readable } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type { Schema, Store, StoreSnapshot } from '@0disoft/saylo-core';
import { unwrapReadableResult } from './readable-result.js';
import type { ReadableResult } from './readable-result.js';
export type { RichTextProps, RichTextRenderers } from './rich-text.js';

export interface SayloInstance<S extends Schema> extends Pick<Store<S>, 'getSnapshot' | 'subscribe'> {
  readonly onDispose?: (listener: () => void) => () => void;
  readonly setLocale: (locale: string) => void | Promise<void>;
  readonly loadNamespace?: (namespace: string) => Promise<void>;
  readonly setNamespaces?: (namespaces: readonly string[]) => Promise<void>;
}

export type SayloSvelteSnapshot<S extends Schema> = StoreSnapshot<S> & Readonly<Pick<SayloInstance<S>, 'setLocale' | 'loadNamespace' | 'setNamespaces'>>;
export type SayloSvelteStore<S extends Schema> = Readable<SayloSvelteSnapshot<S>>;

/** Shares one upstream subscription while consumers are mounted. The caller owns disposal. */
export function createSvelteStore<S extends Schema>(instance: SayloInstance<S>): SayloSvelteStore<S> {
  let previous = instance.getSnapshot();
  const bind = (snapshot: StoreSnapshot<S>): SayloSvelteSnapshot<S> => Object.freeze({
    ...snapshot, setLocale: instance.setLocale,
    ...(instance.loadNamespace ? { loadNamespace: instance.loadNamespace } : {}),
    ...(instance.setNamespaces ? { setNamespaces: instance.setNamespaces } : {}),
  });
  let current = bind(previous);
  return unwrapReadableResult(() => readable<ReadableResult<SayloSvelteSnapshot<S>>>({ kind: 'value', value: current }, set => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let offDispose: (() => void) | undefined;
    const stop = () => {
      if (!active) return;
      active = false;
      const releases = [unsubscribe, offDispose];
      unsubscribe = offDispose = undefined;
      const errors: unknown[] = [];
      for (const release of releases) try { release?.(); } catch (error) { errors.push(error); }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Svelte store cleanup failed.', { cause: errors[0] });
    };
    const publish = (snapshot: StoreSnapshot<S>) => {
      if (!active) return;
      if (snapshot !== previous) { previous = snapshot; current = bind(snapshot); }
      set({ kind: 'value', value: current });
    };
    try {
      unsubscribe = instance.subscribe(snapshot => { if (snapshot !== previous) publish(snapshot); });
      offDispose = instance.onDispose?.(stop);
      if (!active) {
        // onDispose may synchronously stop us before returning its own release handle.
        const release = offDispose;
        offDispose = undefined;
        release?.();
      } else publish(instance.getSnapshot()); // Refresh after dormancy, with the listener already installed.
    } catch (error) {
      try { stop(); }
      catch (cleanupError) { error = new AggregateError([error, cleanupError], 'Svelte store setup and cleanup failed.', { cause: error }); }
      set({ kind: 'error', error });
    }
    return stop;
  }));
}

export interface SayloSelectorOptions {
  /** Live selection failures retain the last value; defaults to console.error. Initial failures throw. */
  readonly onError?: (error: unknown) => void;
}

/** Pure selection; only Object.is changes invalidate or notify downstream subscribers. */
export function selectSvelteStore<S extends Schema, T>(source: SayloSvelteStore<S>,
  selector: (snapshot: SayloSvelteSnapshot<S>) => T, options: SayloSelectorOptions = {}): Readable<T> {
  let previous: ReadableResult<T> | undefined;
  return unwrapReadableResult(hasSubscribers => derived<SayloSvelteStore<S>, ReadableResult<T>>(source, (snapshot, set) => {
    let value: T;
    try { value = selector(snapshot); }
    catch (error) {
      if (!hasSubscribers()) {
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
  }));
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
