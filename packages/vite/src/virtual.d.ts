/** Include @0disoft/saylo-vite/virtual in compilerOptions.types for TS/checkJs. */
declare module 'virtual:saylo' {
  export const initialCatalogs: readonly import('@0disoft/saylo-core').ParsedCatalog[];
  export const baseLocale: string;
  export const initialLocale: string;
  export const timeZone: string;
}

declare module 'virtual:saylo/lazy' {
  export const initialCatalogs: readonly import('@0disoft/saylo-core').CatalogOutcome[];
  export const initialLocale: string;
  export const initialNamespaces: readonly string[];
  export const timeZone: string;
  export const catalogSource: import('@0disoft/saylo-vite/client').DevCatalogSource;
}

declare module 'virtual:saylo/server' {
  export const catalogSource: import('@0disoft/saylo-core').CatalogSource;
  export function createRequestI18n<S extends import('@0disoft/saylo-core').Schema = import('@0disoft/saylo-core').Schema>(
    options?: Partial<Omit<import('@0disoft/saylo-core').ServerI18nOptions, 'catalogSource'>>
  ): Promise<import('@0disoft/saylo-core').I18n<S>>;
}
