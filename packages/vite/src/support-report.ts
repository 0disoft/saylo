import type { DiagnosticCode, SourcePosition } from '@0disoft/saylo-core';
import type { DevSyncState } from './dev-sync.js';
import type { LiveDiagnostic } from './types.js';

export interface SupportEnvironment {
  readonly runtime?: 'browser' | 'node' | 'unknown';
  readonly node?: string;
  readonly vite?: string;
  readonly sayloCore?: string;
  readonly sayloVite?: string;
  readonly sayloReact?: string;
  readonly sayloSvelte?: string;
  readonly sayloTypegen?: string;
}
export interface SupportDiagnostic {
  readonly code: DiagnosticCode | 'UNKNOWN';
  /** Report-local source alias, scoped to this event; never the original path. */
  readonly source?: number;
  readonly position?: SourcePosition;
}
export interface SupportEvent {
  readonly operation: 'catalog' | 'handshake' | 'observer' | 'unknown';
  readonly hasMessage: boolean;
  readonly diagnostics: readonly SupportDiagnostic[];
  readonly omittedDiagnostics: number;
}
export interface SupportReport {
  readonly schemaVersion: 'saylo.support/v1';
  readonly environment: SupportEnvironment & { readonly runtime: 'browser' | 'node' | 'unknown' };
  readonly syncState?: DevSyncState;
  readonly events: readonly SupportEvent[];
  readonly omittedEvents: number;
}
export interface SupportReportOptions {
  readonly environment?: SupportEnvironment;
  readonly syncState?: DevSyncState;
  readonly diagnostics?: readonly LiveDiagnostic[];
}
export interface SupportRecorder {
  readonly onDiagnostic: (value: LiveDiagnostic) => void;
  readonly onSyncState: (value: DevSyncState) => void;
  readonly getReport: () => SupportReport;
  readonly clear: () => void;
}

const maxEvents = 32;
const maxDiagnostics = 64;
const codes: Record<DiagnosticCode, true> = {
  INVALID_LOCALE: true, INVALID_NAMESPACE: true, INVALID_JSON: true,
  INVALID_CATALOG: true, INVALID_ID: true, DUPLICATE_ID: true,
  INVALID_ICU: true, ARGUMENT_CONFLICT: true, NAMESPACE_MISMATCH: true,
  UNKNOWN_MESSAGE: true, UNKNOWN_ARGUMENT: true, ARGUMENT_TYPE_NARROWING: true,
  MISSING_MESSAGE: true, MISSING_NAMESPACE: true, DUPLICATE_CATALOG: true, LOCALE_MISMATCH: true,
};
const statuses = new Set(['idle', 'connecting', 'retrying', 'connected', 'disconnected', 'failed', 'stopped']);
const integer = (value: unknown, minimum = 0): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;

function environment(value?: SupportEnvironment): SupportReport['environment'] {
  const result: { -readonly [K in keyof SupportEnvironment]: SupportEnvironment[K] } & {
    runtime: 'browser' | 'node' | 'unknown';
  } = {
    runtime: value?.runtime === 'browser' || value?.runtime === 'node' ? value.runtime : 'unknown',
  };
  for (const key of ['node', 'vite', 'sayloCore', 'sayloVite', 'sayloReact', 'sayloSvelte', 'sayloTypegen'] as const) {
    const version = value?.[key];
    // Reject URLs, build metadata and arbitrary prerelease labels, rather than
    // trying to redact secrets from free text. The entire supplied value must match.
    if (typeof version === 'string' && version.length <= 64 &&
        /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc|dev|next)\.(?:0|[1-9]\d*))?$/.exec(version)?.[0] === version)
      result[key] = version;
  }
  return Object.freeze(result);
}

function state(value?: DevSyncState): DevSyncState | undefined {
  if (!value || !statuses.has(value.status) || !integer(value.attempt) || value.attempt > 3 || value.maxAttempts !== 3) return;
  return Object.freeze({ status: value.status, attempt: value.attempt, maxAttempts: 3 });
}

function event(value: LiveDiagnostic): SupportEvent {
  const sources = new Map<string, number>();
  const rows = Array.isArray(value?.diagnostics) ? value.diagnostics : [];
  const diagnostics = rows.slice(0, maxDiagnostics).map(row => {
    const result: { code: SupportDiagnostic['code']; source?: number; position?: SourcePosition } = {
      code: row && typeof row.code === 'string' && Object.hasOwn(codes, row.code) ? row.code : 'UNKNOWN',
    };
    if (typeof row?.sourceName === 'string') {
      if (!sources.has(row.sourceName)) sources.set(row.sourceName, sources.size + 1);
      result.source = sources.get(row.sourceName)!;
    }
    const position = row?.position;
    if (position && integer(position.offset) && integer(position.line, 1) && integer(position.column, 1))
      result.position = Object.freeze({ offset: position.offset, line: position.line, column: position.column });
    return Object.freeze(result);
  });
  const operation = value?.operation;
  return Object.freeze({
    operation: operation === undefined ? 'catalog' : operation === 'handshake' || operation === 'observer' ? operation : 'unknown',
    hasMessage: typeof value?.message === 'string' && value.message.length > 0,
    diagnostics: Object.freeze(diagnostics), omittedDiagnostics: Math.max(0, rows.length - maxDiagnostics),
  });
}

/** Pure, bounded allowlist projection. Does not collect globals, files or send data. */
export function createSupportReport(options: SupportReportOptions = {}): SupportReport {
  const diagnostics = Array.isArray(options.diagnostics) ? options.diagnostics : [];
  const syncState = state(options.syncState);
  return Object.freeze({ schemaVersion: 'saylo.support/v1', environment: environment(options.environment),
    ...(syncState ? { syncState } : {}), events: Object.freeze(diagnostics.slice(-maxEvents).map(event)),
    omittedEvents: Math.max(0, diagnostics.length - maxEvents),
  });
}

/** Store sanitized observations immediately, never caller diagnostics or messages. */
export function createSupportRecorder(input?: SupportEnvironment): SupportRecorder {
  const safeEnvironment = environment(input);
  let syncState: DevSyncState | undefined;
  let events: SupportEvent[] = [];
  let omittedEvents = 0;
  return Object.freeze({
    onDiagnostic: (value: LiveDiagnostic) => {
      events.push(event(value));
      if (events.length > maxEvents) { events.shift(); omittedEvents++; }
    },
    onSyncState: (value: DevSyncState) => { syncState = state(value); },
    getReport: () => Object.freeze({ schemaVersion: 'saylo.support/v1', environment: safeEnvironment,
      ...(syncState ? { syncState } : {}), events: Object.freeze([...events]), omittedEvents }),
    clear: () => { events = []; syncState = undefined; omittedEvents = 0; },
  });
}
