type TerminationSignal = 'SIGINT' | 'SIGTERM';
interface SignalSource {
  on(signal: TerminationSignal, listener: () => void): unknown;
  off(signal: TerminationSignal, listener: () => void): unknown;
}
export interface CliCancellation {
  readonly signal: AbortSignal;
  throwIfCancelled(writtenFiles?: readonly string[]): void;
  dispose(): void;
}

export class CommandInterruptedError extends Error {
  readonly exitCode: 130 | 143;
  constructor(readonly signalName: TerminationSignal, readonly writtenFiles: readonly string[] = [], options?: ErrorOptions) {
    super(`Interrupted by ${signalName}.`, options);
    this.name = 'CommandInterruptedError';
    this.exitCode = signalName === 'SIGINT' ? 130 : 143;
  }
}

/** Own listeners until physical writes and cleanup settle. Repeated signals keep the first reason. */
export function createCliCancellation(source: SignalSource = process): CliCancellation {
  const controller = new AbortController();
  const interrupt = (name: TerminationSignal) => controller.abort(new CommandInterruptedError(name));
  const onInterrupt = () => interrupt('SIGINT'), onTerminate = () => interrupt('SIGTERM');
  const dispose = () => { source.off('SIGINT', onInterrupt); source.off('SIGTERM', onTerminate); };
  try { source.on('SIGINT', onInterrupt); source.on('SIGTERM', onTerminate); }
  catch (error) { dispose(); throw error; }
  return {
    signal: controller.signal,
    throwIfCancelled(writtenFiles: readonly string[] = []) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason as CommandInterruptedError;
        throw new CommandInterruptedError(reason.signalName, writtenFiles, { cause: reason });
      }
    },
    dispose,
  };
}
