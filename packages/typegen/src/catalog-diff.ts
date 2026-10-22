import type { TranslationImportPlan } from './catalog-import.js';

interface Line { readonly kind: ' ' | '-' | '+'; readonly text: string }
const DIFF_CONTEXT_LINES = 3;
const lines = (source: string) => source.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/** Unique matching lines provide ordered anchors without a quadratic comparison table. */
function anchors(before: readonly string[], after: readonly string[]): readonly [number, number][] {
  const index = (input: readonly string[]) => {
    const positions = new Map<string, number>();
    input.forEach((line, position) => positions.set(line, positions.has(line) ? -1 : position));
    return positions;
  };
  const old = index(before), next = index(after);
  const candidates: [number, number][] = [];
  before.forEach((line, position) => {
    const target = next.get(line);
    if (old.get(line) === position && target !== undefined && target >= 0) candidates.push([position, target]);
  });
  const tails: number[] = [], previous: number[] = [];
  candidates.forEach((candidate, position) => {
    let low = 0, high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candidates[tails[middle]!]![1] < candidate[1]) low = middle + 1;
      else high = middle;
    }
    previous[position] = low ? tails[low - 1]! : -1;
    tails[low] = position;
  });
  const result: [number, number][] = [];
  for (let position = tails.at(-1) ?? -1; position >= 0; position = previous[position]!) result.push(candidates[position]!);
  return result.reverse();
}

function compare(before: readonly string[], after: readonly string[]): Line[] {
  const result: Line[] = [];
  const gap = (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
    while (oldStart < oldEnd && newStart < newEnd && before[oldStart] === after[newStart]) {
      result.push({ kind: ' ', text: before[oldStart++]! }); newStart++;
    }
    let suffix = 0;
    while (oldStart < oldEnd && newStart < newEnd && before[oldEnd - 1] === after[newEnd - 1]) {
      oldEnd--; newEnd--; suffix++;
    }
    for (let i = oldStart; i < oldEnd; i++) result.push({ kind: '-', text: before[i]! });
    for (let i = newStart; i < newEnd; i++) result.push({ kind: '+', text: after[i]! });
    for (let i = oldEnd; i < oldEnd + suffix; i++) result.push({ kind: ' ', text: before[i]! });
  };
  let oldStart = 0, newStart = 0;
  for (const [oldEnd, newEnd] of anchors(before, after)) {
    gap(oldStart, oldEnd, newStart, newEnd);
    result.push({ kind: ' ', text: before[oldEnd]! });
    oldStart = oldEnd + 1; newStart = newEnd + 1;
  }
  gap(oldStart, before.length, newStart, after.length);
  return result;
}

const pathLabel = (name: string) => /[\s"\\]/.test(name) ? JSON.stringify(name) : name;
const renderLine = ({ kind, text }: Line) => kind + text + (text.endsWith('\n') ? '' : '\n\\ No newline at end of file\n');

/** A review preview, relative to the locales root. Blocked plans never produce a patch. */
export function createImportDiff(plan: TranslationImportPlan): string | null {
  if (plan.report.blocked) return null;
  const output: string[] = [];
  for (const file of plan.files) {
    const edits = compare(lines(file.source ?? ''), lines(file.nextSource));
    const ranges: { start: number; end: number }[] = [];
    const old = [0], next = [0];
    edits.forEach((line, i) => {
      old.push(old[i]! + (line.kind === '+' ? 0 : 1));
      next.push(next[i]! + (line.kind === '-' ? 0 : 1));
      if (line.kind === ' ') return;
      const start = Math.max(0, i - DIFF_CONTEXT_LINES), end = Math.min(edits.length, i + DIFF_CONTEXT_LINES + 1);
      const last = ranges.at(-1);
      if (last && start <= last.end) last.end = end;
      else ranges.push({ start, end });
    });
    if (!ranges.length) continue;
    output.push(`--- ${file.source === null ? '/dev/null' : pathLabel('a/' + file.sourceName)}\n+++ ${pathLabel('b/' + file.sourceName)}\n`);
    for (const { start, end } of ranges) {
      const oldCount = old[end]! - old[start]!, newCount = next[end]! - next[start]!;
      output.push(`@@ -${old[start]! + (oldCount ? 1 : 0)},${oldCount} +${next[start]! + (newCount ? 1 : 0)},${newCount} @@\n`);
      for (let i = start; i < end; i++) output.push(renderLine(edits[i]!));
    }
  }
  return output.join('');
}
