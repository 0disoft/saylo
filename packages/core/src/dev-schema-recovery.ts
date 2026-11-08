import { InvalidArgumentError, UnknownMessageError } from './translation-errors.js';
import type { MessageSchema, ParsedMessage, RichTextPart, TranslationErrorSurface } from './types.js';

export interface DevSchemaRecoveryDiagnostic {
  readonly status: 'retained' | 'resolved';
  readonly reason: 'required-argument-added' | 'key-deleted';
  readonly key: string;
  readonly locale: string;
  readonly surface: TranslationErrorSurface;
  readonly error: InvalidArgumentError | UnknownMessageError;
}

export interface DevSchemaRecoveryOptions {
  /** Maximum successful message/surface records retained per instance; defaults to 128. */
  readonly maxEntries?: number;
  /** Deferred until after rendering; receives no message text or input values. */
  readonly onDiagnostic?: (diagnostic: DevSchemaRecoveryDiagnostic) => void;
}

export interface RecoveryMessage {
  readonly arguments: MessageSchema;
  readonly message: ParsedMessage;
  readonly sourceLocale: string;
}

export interface RecoveryScope {
  readonly locale: string;
  readonly identity: (key: string, surface: TranslationErrorSurface) => string;
  readonly history: ReadonlyMap<string, RecoveryMessage>;
}

type Rendered = string | readonly RichTextPart[];

/** Bounded per-message history. Retains parsed messages, never catalogs, translators or user values. */
export class DevSchemaRecovery {
  private readonly records = new Map<string, RecoveryMessage>();
  private readonly warnings = new Map<string, DevSchemaRecoveryDiagnostic>();
  private readonly scopes = new WeakMap<object, RecoveryScope>();
  private active: RecoveryScope | undefined;
  private disposed = false;

  constructor(private readonly limit: number,
    private readonly report: (diagnostic: DevSchemaRecoveryDiagnostic) => void) {}

  scope(locale: string, baseLocale: string, timeZone: string): RecoveryScope {
    return { locale, identity: (key, surface) => JSON.stringify([locale, baseLocale, timeZone, key, surface]),
      history: new Map(this.records) };
  }

  track(render: object, scope: RecoveryScope) { this.scopes.set(render, scope); }
  activate(render: object) { this.active = this.scopes.get(render); }

  private trim<T>(map: Map<string, T>) {
    if (map.size > this.limit) map.delete(map.keys().next().value!);
  }

  private diagnostic(id: string, event: DevSchemaRecoveryDiagnostic) {
    queueMicrotask(() => {
      if (this.disposed || (event.status === 'retained' ? this.warnings.get(id) !== event : this.warnings.has(id))) return;
      try { this.report(event); }
      catch (error) {
        try { console.error('[saylo:dev-schema-recovery] diagnostic observer failed', error); } catch { /* Keep rendering safe. */ }
      }
    });
  }

  remember(scope: RecoveryScope, key: string, surface: TranslationErrorSurface, plan: RecoveryMessage) {
    if (scope !== this.active || this.disposed) return;
    const id = scope.identity(key, surface);
    this.records.delete(id); this.records.set(id, plan); this.trim(this.records);
    const warning = this.warnings.get(id);
    if (warning) {
      this.warnings.delete(id);
      this.diagnostic(id, Object.freeze({ ...warning, status: 'resolved' }));
    }
  }

  recover(scope: RecoveryScope, error: unknown, key: string, args: Record<string, unknown> | undefined,
    surface: TranslationErrorSurface, contract: MessageSchema | undefined,
    render: (plan: RecoveryMessage) => Rendered): Rendered | undefined {
    const id = scope.identity(key, surface), previous = scope.history.get(id);
    if (!previous) return;
    let reason: DevSchemaRecoveryDiagnostic['reason'];
    if (error instanceof UnknownMessageError && error.key === key && contract === undefined) reason = 'key-deleted';
    else if (error instanceof InvalidArgumentError && error.key === key && error.argument !== undefined &&
      contract && Object.hasOwn(contract, error.argument) && !Object.hasOwn(previous.arguments, error.argument) &&
      (args === undefined || !Object.hasOwn(args, error.argument))) reason = 'required-argument-added';
    else return;
    let result: Rendered;
    try { result = render(previous); } catch { return; }
    if (scope === this.active && !this.disposed) {
      const before = this.warnings.get(id);
      if (!before || before.reason !== reason || (before.error instanceof InvalidArgumentError &&
          error instanceof InvalidArgumentError && before.error.argument !== error.argument)) {
        const event = Object.freeze({ status: 'retained' as const, reason, key, locale: scope.locale, surface,
          error: error as InvalidArgumentError | UnknownMessageError });
        this.warnings.delete(id); this.warnings.set(id, event); this.trim(this.warnings);
        this.diagnostic(id, event);
      }
    }
    return result;
  }

  clear() { this.disposed = true; this.active = undefined; this.records.clear(); this.warnings.clear(); }
}

export function createDevSchemaRecovery(options: DevSchemaRecoveryOptions | false | undefined): DevSchemaRecovery | undefined {
  if (options === undefined || options === false) return;
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('devSchemaRecovery must be options or false.');
  const limit = options.maxEntries ?? 128, onDiagnostic = options.onDiagnostic;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('devSchemaRecovery.maxEntries must be a positive safe integer.');
  if (onDiagnostic !== undefined && typeof onDiagnostic !== 'function') throw new TypeError('devSchemaRecovery.onDiagnostic must be a function.');
  return new DevSchemaRecovery(limit, onDiagnostic ?? (event => {
    if (event.status === 'retained') console.warn('[saylo:dev-schema-recovery]', event.reason, event.locale, event.key, event.surface);
  }));
}
