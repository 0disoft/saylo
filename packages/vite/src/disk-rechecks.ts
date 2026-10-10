import { stat } from 'node:fs/promises';

// Vite's watcher can suppress a second change within its short throttle window.
// Keep the first publication immediate. Probe early for a suppressed rapid
// save, then retain the trailing check for writes arriving after the probe.
const EARLY_RECHECK_MS = 10;
const RECHECK_MS = 60;
interface Check { early?: ReturnType<typeof setTimeout>; timer?: ReturnType<typeof setTimeout> }

export async function diskStamp(file: string): Promise<string> {
  const value = await stat(file, { bigint: true });
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');
}

export class DiskRechecks {
  private checks = new Map<string, Check>();
  private stopped = false;

  constructor(private enqueue: (file: string) => void) {}

  reset(file: string): Check {
    clearTimeout(this.checks.get(file)?.early);
    clearTimeout(this.checks.get(file)?.timer);
    const check: Check = {};
    this.checks.set(file, check);
    return check;
  }

  token(file: string): Check | undefined { return this.checks.get(file); }

  finish(file: string, check: Check | undefined, stamp: string | undefined) {
    if (this.stopped || !check || this.checks.get(file) !== check) return;
    if (stamp === undefined) { this.checks.delete(file); return; }
    check.early = setTimeout(() => {
      void this.verify(file, check, stamp, false);
    }, EARLY_RECHECK_MS);
    check.timer = setTimeout(() => {
      void this.verify(file, check, stamp);
    }, RECHECK_MS);
  }

  private async verify(file: string, check: Check, stamp: string, final = true) {
    // A stat error also needs the normal reader, which owns diagnostics/removal.
    const latest = await diskStamp(file).catch(() => undefined);
    if (this.stopped || this.checks.get(file) !== check) return;
    if (latest !== stamp) {
      clearTimeout(check.early); clearTimeout(check.timer);
      this.checks.delete(file);
      this.enqueue(file);
    } else if (final) this.checks.delete(file);
  }

  stop() {
    this.stopped = true;
    for (const check of this.checks.values()) { clearTimeout(check.early); clearTimeout(check.timer); }
    this.checks.clear();
  }
}
