import { DEV_DISK_POLICY } from './dev-policy.js';
import { stat } from 'node:fs/promises';
import { schedule } from './scheduling.js';
import type { Schedule } from './scheduling.js';

// Vite's watcher can suppress a second change within its short throttle window.
// Keep the first publication immediate. Probe early for a suppressed rapid
// save, then retain the trailing check for writes arriving after the probe.
interface Check { early?: () => void; middle?: () => void; timer?: () => void; pending?: number; final?: boolean }

export interface DiskRecheckOperations {
  readonly schedule?: Schedule;
  readonly stamp?: typeof diskStamp;
}

export async function diskStamp(file: string): Promise<string> {
  const value = await stat(file, { bigint: true });
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':');
}

export class DiskRechecks {
  private checks = new Map<string, Check>();
  private stopped = false;

  constructor(private enqueue: (file: string) => void, private operations: DiskRecheckOperations = {}) {}

  reset(file: string): Check {
    this.checks.get(file)?.early?.();
    this.checks.get(file)?.middle?.();
    this.checks.get(file)?.timer?.();
    const check: Check = {};
    this.checks.set(file, check);
    return check;
  }

  token(file: string): Check | undefined { return this.checks.get(file); }

  finish(file: string, check: Check | undefined, stamp: string | undefined) {
    if (this.stopped || !check || this.checks.get(file) !== check) return;
    if (stamp === undefined) { this.checks.delete(file); return; }
    const later = this.operations.schedule ?? schedule;
    check.early = later(DEV_DISK_POLICY.earlyRecheckMs, () => {
      void this.verify(file, check, stamp, false);
    });
    check.middle = later(DEV_DISK_POLICY.middleRecheckMs, () => {
      void this.verify(file, check, stamp, false);
    });
    check.timer = later(DEV_DISK_POLICY.trailingRecheckMs, () => {
      void this.verify(file, check, stamp);
    });
  }

  private async verify(file: string, check: Check, stamp: string, final = true) {
    // A stat error also needs the normal reader, which owns diagnostics/removal.
    check.pending = (check.pending ?? 0) + 1;
    let latest: string | undefined;
    try { latest = await (this.operations.stamp ?? diskStamp)(file); } catch { /* The normal reader owns diagnostics. */ }
    check.pending--;
    if (this.stopped || this.checks.get(file) !== check) return;
    if (latest !== stamp) {
      check.early?.(); check.middle?.(); check.timer?.();
      this.checks.delete(file);
      this.enqueue(file);
    } else {
      check.final ||= final;
      // An earlier stat may still report a change after the final probe finishes.
      if (check.final && !check.pending) this.checks.delete(file);
    }
  }

  stop() {
    this.stopped = true;
    for (const check of this.checks.values()) { check.early?.(); check.middle?.(); check.timer?.(); }
    this.checks.clear();
  }
}
