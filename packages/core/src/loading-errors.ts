export class CatalogLoadError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CatalogLoadError';
  }
}

export class SupersededRequestError extends Error {
  constructor(readonly locale: string) {
    super(`Locale request ${JSON.stringify(locale)} was replaced by a newer selection.`);
    this.name = 'SupersededRequestError';
  }
}

export class I18nDisposedError extends Error {
  constructor() { super('I18n instance is disposed.'); this.name = 'I18nDisposedError'; }
}
