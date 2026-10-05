export class UnknownMessageError extends Error {
  constructor(readonly key: string) {
    super(`Unknown message ${JSON.stringify(key)}.`);
    this.name = 'UnknownMessageError';
  }
}

export class NamespaceNotLoadedError extends Error {
  constructor(readonly namespace: string, readonly key: string) {
    super(`Namespace ${JSON.stringify(namespace)} is not loaded for ${JSON.stringify(key)}.`);
    this.name = 'NamespaceNotLoadedError';
  }
}

export class InvalidArgumentError extends Error {
  constructor(readonly key: string, readonly argument: string | undefined, reason: string) {
    super(`${JSON.stringify(key)}${argument === undefined ? '' : ` argument ${JSON.stringify(argument)}`}: ${reason}`);
    this.name = 'InvalidArgumentError';
  }
}
