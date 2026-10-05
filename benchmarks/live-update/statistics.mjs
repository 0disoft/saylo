export function summarize(values) {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Timings must be finite, nonnegative and nonempty.');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = fraction => sorted[Math.ceil(sorted.length * fraction) - 1];
  return { count: sorted.length, p50Ms: rank(0.5), p95Ms: rank(0.95), minMs: sorted[0], maxMs: sorted.at(-1) };
}
