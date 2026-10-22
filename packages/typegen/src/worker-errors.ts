export interface WorkerFailure { name: string; message: string; code?: string; cause?: WorkerFailure }

/** Bounded, cloneable error data also tolerates cyclic causes and opaque thrown values. */
export function serializeFailure(value: unknown, depth = 0): WorkerFailure {
  try {
    if (!(value instanceof Error)) return { name: 'Error', message: String(value) };
    const code = (value as Error & { code?: unknown }).code;
    return { name: value.name, message: value.message,
      ...(typeof code === 'string' ? { code } : {}),
      ...(value.cause !== undefined && depth < 5 ? { cause: serializeFailure(value.cause, depth + 1) } : {}) };
  } catch { return { name: 'Error', message: 'Typegen failed with an unreadable error.' }; }
}

export function restoreFailure(value: WorkerFailure): Error {
  const error = new Error(value.message, value.cause ? { cause: restoreFailure(value.cause) } : {});
  error.name = value.name;
  if (value.code !== undefined) Object.assign(error, { code: value.code });
  return error;
}
