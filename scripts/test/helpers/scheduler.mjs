/** A per-test deferred timer queue; no global mocks or wall-clock sleeps. */
export function scheduler(initial = 0) {
  let now = initial, sequence = 0;
  const pending = new Map();
  return {
    now: () => now,
    schedule(delay, callback) {
      const id = ++sequence;
      pending.set(id, { at: now + delay, callback });
      return () => { pending.delete(id); };
    },
    tick(milliseconds) {
      const end = now + milliseconds;
      let steps = 0;
      while (true) {
        const next = [...pending].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next || next[1].at > end) break;
        if (++steps > 10000) throw new Error('Timer queue did not settle.');
        pending.delete(next[0]); now = next[1].at; next[1].callback();
      }
      now = end;
    },
    get size() { return pending.size; },
  };
}
