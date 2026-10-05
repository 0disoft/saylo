/** Include @saylo/vite/virtual in compilerOptions.types for TS/checkJs. */
declare module 'virtual:saylo' {
  export const initialCatalogs: readonly import('@saylo/core').ParsedCatalog[];
  export const baseLocale: string;
  export const initialLocale: string;
  export const timeZone: string;
}
