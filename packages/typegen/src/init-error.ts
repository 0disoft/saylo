export class InitApplyError extends Error {
  constructor(message: string, readonly writtenFiles: readonly string[], cause: unknown) { super(message, { cause }); }
}
