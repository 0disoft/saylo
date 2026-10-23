import { computed, getCurrentInstance, inject, onMounted, onScopeDispose, provide, shallowReadonly, shallowRef } from 'vue';
import type { App, ComputedRef, InjectionKey, ObjectPlugin, ShallowRef } from 'vue';
import type { Schema, Store, StoreSnapshot } from '@0disoft/saylo-core';

export { renderRichText } from './rich-text.js';
export type { RichTextRenderers } from './rich-text.js';

export interface SayloInstance<S extends Schema> extends Pick<Store<S>, 'getSnapshot' | 'subscribe'> {
  readonly onDispose?: (listener: () => void) => () => void;
  readonly setLocale: (locale: string) => void | Promise<void>;
  readonly loadNamespace?: (namespace: string) => Promise<void>;
  readonly setNamespaces?: (namespaces: readonly string[]) => Promise<void>;
}

export type SayloVueSnapshot<S extends Schema> = StoreSnapshot<S> & Readonly<Pick<SayloInstance<S>, 'setLocale' | 'loadNamespace' | 'setNamespaces'>>;
export type SayloVueStore<S extends Schema> = Readonly<ShallowRef<SayloVueSnapshot<S>>>;

function requireSetup() {
  if (!getCurrentInstance()) throw new Error('Saylo Vue bindings must be called synchronously during component setup.');
}

/** One subscription per composable, owned by its component; caller owns the instance. */
export function useVueStore<S extends Schema>(instance: SayloInstance<S>): SayloVueStore<S> {
  requireSetup();
  const bind = (snapshot: StoreSnapshot<S>): SayloVueSnapshot<S> => Object.freeze({
    ...snapshot, setLocale: instance.setLocale,
    ...(instance.loadNamespace ? { loadNamespace: instance.loadNamespace } : {}),
    ...(instance.setNamespaces ? { setNamespaces: instance.setNamespaces } : {}),
  });
  let previous = instance.getSnapshot();
  const state = shallowRef(bind(previous));
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  let offDispose: (() => void) | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const off = unsubscribe, dispose = offDispose;
    unsubscribe = offDispose = undefined;
    const errors: unknown[] = [];
    for (const release of [off, dispose]) try { release?.(); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Vue store cleanup failed.', { cause: errors[0] });
  };
  const publish = (snapshot: StoreSnapshot<S>) => {
    if (stopped || snapshot === previous) return;
    previous = snapshot;
    state.value = bind(snapshot);
  };
  onScopeDispose(stop);
  // Mount hooks do not run during SSR, so a server render cannot retain listeners.
  onMounted(() => {
    if (stopped) return;
    try {
      unsubscribe = instance.subscribe(publish);
      if (stopped) { const off = unsubscribe; unsubscribe = undefined; off(); return; }
      offDispose = instance.onDispose?.(stop);
      if (stopped) { const off = offDispose; offDispose = undefined; off?.(); return; }
      // Include changes committed between setup and mount, after installing the listener.
      publish(instance.getSnapshot());
    } catch (error) {
      try { stop(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Vue store setup and cleanup failed.', { cause: error }); }
      throw error;
    }
  });
  return shallowReadonly(state);
}

/** Lazy, readonly selection; Vue skips downstream updates when Object.is is unchanged. */
export function useVueSelector<S extends Schema, T>(instance: SayloInstance<S>,
  selector: (snapshot: SayloVueSnapshot<S>) => T): ComputedRef<T> {
  const source = useVueStore(instance);
  return computed(() => selector(source.value));
}

export interface SayloVueBindings<S extends Schema> {
  /** Install before mount; the caller owns the instance. No subscriptions are acquired. */
  readonly createPlugin: (instance: SayloInstance<S>) => ObjectPlugin<[]>;
  /** Provide a stable caller-owned instance during a parent component's setup. */
  readonly provideI18n: (instance: SayloInstance<S>) => void;
  /** Read-only reactive snapshot; use i18n.value in script and i18n in templates. */
  readonly useI18n: () => SayloVueStore<S>;
  /** Call during setup. Reactive values read by the selector are also tracked. */
  readonly useI18nSelector: <T>(selector: (snapshot: SayloVueSnapshot<S>) => T) => ComputedRef<T>;
}

/** Create once at module scope; each provider/request supplies its own instance. */
export function createSayloVue<S extends Schema = Schema>(): SayloVueBindings<S> {
  const key: InjectionKey<SayloInstance<S>> = Symbol('Saylo');
  const installed = new WeakMap<App, SayloInstance<S>>();
  function requireInstance() {
    requireSetup();
    const instance = inject(key);
    if (!instance) throw new Error('useI18n/useI18nSelector requires provideI18n or app.use(createPlugin(instance)) from the same createSayloVue factory.');
    return instance;
  }
  return Object.freeze({
    createPlugin(instance: SayloInstance<S>): ObjectPlugin<[]> {
      return Object.freeze({ install(app: App) {
        const current = installed.get(app);
        if (current === instance) return;
        if (current) throw new Error('This Saylo Vue factory already installed a different instance in this app.');
        app.provide(key, instance);
        installed.set(app, instance);
      } });
    },
    provideI18n(instance: SayloInstance<S>) { requireSetup(); provide(key, instance); },
    useI18n() {
      return useVueStore(requireInstance());
    },
    useI18nSelector<T>(selector: (snapshot: SayloVueSnapshot<S>) => T) {
      return useVueSelector(requireInstance(), selector);
    },
  });
}
