import type { BootSnapshot, CreateI18nOptions, I18n, Schema } from '@0disoft/saylo-core/runtime';

/** Private experiment only; the runtime reuses the public Saylo schema types. */
export interface LazyLayer<S extends Schema = Schema> extends I18n<S> {
  getProbeStats(): Readonly<{ resourceDictionaries: number; instances: number }>;
}

/** Unlike createI18n, this experiment also accepts serialized boot JSON. */
export type CreateLazyLayerOptions = CreateI18nOptions | (
  Omit<Extract<CreateI18nOptions, { readonly initialSnapshot: BootSnapshot }>, 'initialSnapshot'> &
  { readonly initialSnapshot: string }
);

/** Async initialization is an intentional difference from synchronous createI18n. */
export function createLazyLayer<S extends Schema = Schema>(options: CreateLazyLayerOptions): Promise<LazyLayer<S>>;
