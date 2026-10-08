import { rename } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

interface Operations {
  readonly platform: NodeJS.Platform;
  readonly rename: typeof rename;
  readonly wait: (milliseconds: number) => Promise<void>;
}

/** Internal writer helper: preserve the old file while Windows readers briefly prevent replacement. */
export async function replaceGenerated(temp: string, target: string, isCurrent: () => boolean,
  operations: Operations = { platform: process.platform, rename, wait: setTimeout }): Promise<'written' | 'cancelled'> {
  for (let attempt = 0; ; attempt++) {
    if (!isCurrent()) return 'cancelled';
    try {
      await operations.rename(temp, target);
      return 'written';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (operations.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= 5) throw error;
      // At most five waits (620ms total). Newer generations and stop() cancel before retrying.
      if (!isCurrent()) return 'cancelled';
      await operations.wait(20 * 2 ** attempt);
    }
  }
}
