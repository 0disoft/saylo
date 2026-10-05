/** Include @saylo/vite/virtual in compilerOptions.types for TS/checkJs. */
declare module 'virtual:saylo' {
  export const initialCatalogs: readonly import('@saylo/core').ParsedCatalog[];
  export const baseLocale: string;
  export const initialLocale: string;
  export const timeZone: string;
}

declare module 'virtual:saylo/lazy' {
  export const initialCatalogs: readonly import('@saylo/core').CatalogOutcome[];
  export const initialLocale: string;
  export const initialNamespaces: readonly string[];
  export const timeZone: string;
  export const catalogSource: import('@saylo/vite/client').DevCatalogSource;
}

declare module 'virtual:saylo/server' {
  export const catalogSource: import('@saylo/core').CatalogSource;
  export function createRequestI18n<S extends import('@saylo/core').Schema = import('@saylo/core').Schema>(
    options?: Partial<Omit<import('@saylo/core').ServerI18nOptions, 'catalogSource'>>
  ): Promise<import('@saylo/core').I18n<S>>;
}
