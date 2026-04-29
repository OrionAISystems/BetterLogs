import {
  DEFAULT_FORMAT,
  DEFAULT_OPTIONS
} from "./constants";
import {
  createBrowserFormatter,
  createJsonFormatter,
  createPrettyFormatter
} from "./format";
import { shouldLog } from "./levels";
import { serializeContext, serializeMeta } from "./serialize";
import { createConsoleTransport } from "./transports";
import type {
  AsyncOrSync,
  LogContext,
  LogFormatter,
  LogHook,
  LogRecord,
  LogRedactionRule,
  LogSampler,
  LogSerializer,
  LogTimer,
  LogTimerFailOptions,
  LogTimerFinishOptions,
  Logger,
  LoggerBindings,
  LoggerBindingsProvider,
  LoggerOptions,
  LogFormat,
  LogLevel,
  LogTransport
} from "./types";

type LoggerRuntime = {
  readonly pending: Set<Promise<unknown>>;
};

type ResolvedLoggerOptions = {
  readonly scope: string | undefined;
  readonly minLevel: LogLevel;
  readonly timestamps: boolean;
  readonly colors: boolean;
  readonly prettyPrintObjects: boolean;
  readonly showStackTrace: boolean;
  readonly format: LogFormat;
  readonly formatter: LogFormatter | undefined;
  readonly transports: readonly LogTransport[];
  readonly hooks: readonly LogHook[];
  readonly samplers: readonly LogSampler[];
  readonly serializers: readonly LogSerializer[];
  readonly redactions: readonly LogRedactionRule[];
  readonly context: LogContext;
  readonly requestId: string | undefined;
  readonly correlationId: string | undefined;
  readonly bindingsProvider: LoggerBindingsProvider | undefined;
  readonly runtime: LoggerRuntime;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeScope(scope: string | undefined): string | undefined {
  const normalizedScope = scope?.trim();
  return normalizedScope ? normalizedScope : undefined;
}

function normalizeId(value: string | undefined): string | undefined {
  const normalizedValue = value?.trim();
  return normalizedValue ? normalizedValue : undefined;
}

function composeScope(
  parentScope: string | undefined,
  childScope: string
): string | undefined {
  const normalizedChildScope = normalizeScope(childScope);

  if (!parentScope) {
    return normalizedChildScope;
  }

  if (!normalizedChildScope) {
    return parentScope;
  }

  return `${parentScope}:${normalizedChildScope}`;
}

function mergeContext(
  baseContext: LogContext,
  nextContext: LogContext | undefined
): LogContext {
  return nextContext ? { ...baseContext, ...nextContext } : { ...baseContext };
}

function normalizeArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : ([value] as readonly T[]);
}

function resolveFormatter(options: {
  readonly formatter: LogFormatter | undefined;
  readonly format: LogFormat;
  readonly timestamps: boolean;
  readonly colors: boolean;
  readonly prettyPrintObjects: boolean;
}): LogFormatter {
  if (options.formatter) {
    return options.formatter;
  }

  switch (options.format) {
    case "json":
      return createJsonFormatter({
        timestamps: options.timestamps,
        prettyPrintObjects: options.prettyPrintObjects
      });
    case "browser":
      return createBrowserFormatter({
        timestamps: options.timestamps,
        prettyPrintObjects: options.prettyPrintObjects
      });
    case "pretty":
    default:
      return createPrettyFormatter({
        timestamps: options.timestamps,
        colors: options.colors,
        prettyPrintObjects: options.prettyPrintObjects
      });
  }
}

function resolveOptions(
  options: LoggerOptions = {},
  runtime: LoggerRuntime = { pending: new Set<Promise<unknown>>() }
): ResolvedLoggerOptions {
  const minLevel = options.minLevel ?? DEFAULT_OPTIONS.minLevel;
  const timestamps = options.timestamps ?? DEFAULT_OPTIONS.timestamps;
  const colors = options.colors ?? DEFAULT_OPTIONS.colors;
  const prettyPrintObjects =
    options.prettyPrintObjects ?? DEFAULT_OPTIONS.prettyPrintObjects;
  const showStackTrace =
    options.showStackTrace ?? DEFAULT_OPTIONS.showStackTrace;
  const format = options.format ?? DEFAULT_FORMAT;
  const formatter = options.formatter;
  const transports = normalizeArray(options.transports);
  const hooks = normalizeArray(options.hooks);
  const samplers = normalizeArray(options.sample);
  const serializers = normalizeArray(options.serializers);
  const redactions = normalizeArray(options.redact);

  return {
    scope: normalizeScope(options.scope),
    minLevel,
    timestamps,
    colors,
    prettyPrintObjects,
    showStackTrace,
    format,
    formatter,
    transports:
      options.transports === undefined
        ? [
            createConsoleTransport({
              formatter: resolveFormatter({
                formatter,
                format,
                timestamps,
                colors,
                prettyPrintObjects
              })
            })
          ]
        : transports,
    hooks,
    samplers,
    serializers,
    redactions,
    context: mergeContext({}, options.context),
    requestId: normalizeId(options.requestId),
    correlationId: normalizeId(options.correlationId),
    bindingsProvider: options.bindingsProvider,
    runtime
  };
}

function reportInternalError(kind: string, error: unknown): void {
  const details =
    error instanceof Error
      ? error.stack ?? `${error.name}: ${error.message}`
      : String(error);

  console.error(`BetterLogs internal ${kind} failure\n${details}`);
}

function trackAsyncOperation(
  runtime: LoggerRuntime,
  operation: PromiseLike<unknown>,
  kind: string
): void {
  const promise = Promise.resolve(operation)
    .catch((error) => {
      reportInternalError(kind, error);
    })
    .finally(() => {
      runtime.pending.delete(promise);
    });

  runtime.pending.add(promise);
}

function invokeAndTrack(
  runtime: LoggerRuntime,
  kind: string,
  action: () => AsyncOrSync<void>
): void {
  try {
    const result = action();
    if (isPromiseLike(result)) {
      trackAsyncOperation(runtime, result, kind);
    }
  } catch (error) {
    reportInternalError(kind, error);
  }
}

async function drainPending(runtime: LoggerRuntime): Promise<void> {
  while (runtime.pending.size > 0) {
    await Promise.allSettled(Array.from(runtime.pending));
  }
}

async function flushTransports(config: ResolvedLoggerOptions): Promise<void> {
  await drainPending(config.runtime);

  for (const transport of config.transports) {
    if (!transport.flush) {
      continue;
    }

    try {
      await transport.flush();
    } catch (error) {
      reportInternalError("transport flush", error);
    }
  }

  await drainPending(config.runtime);
}

function buildTimedMeta(
  initialMeta: unknown,
  nextMeta: unknown,
  durationMs: number,
  error?: Error
): unknown {
  const payload: Record<string, unknown> = {
    durationMs
  };

  if (isRecord(initialMeta)) {
    Object.assign(payload, initialMeta);
  } else if (initialMeta !== undefined) {
    payload.initialMeta = initialMeta;
  }

  if (isRecord(nextMeta)) {
    Object.assign(payload, nextMeta);
  } else if (nextMeta !== undefined) {
    payload.finalMeta = nextMeta;
  }

  if (error) {
    payload.error = error;
  }

  return payload;
}

function resolveActiveBindings(config: ResolvedLoggerOptions): LoggerBindings {
  const providedBindings = config.bindingsProvider?.();
  const requestId = config.requestId ?? normalizeId(providedBindings?.requestId);
  const correlationId =
    config.correlationId ?? normalizeId(providedBindings?.correlationId);

  return {
    context: mergeContext(providedBindings?.context ?? {}, config.context),
    ...(requestId ? { requestId } : {}),
    ...(correlationId ? { correlationId } : {})
  };
}

function createRecord(
  level: LogLevel,
  message: string,
  meta: unknown,
  config: ResolvedLoggerOptions
): LogRecord {
  const activeBindings = resolveActiveBindings(config);
  const serializationOptions = {
    serializers: config.serializers,
    showStackTrace: config.showStackTrace,
    redactions: config.redactions
  };

  const context = serializeContext(activeBindings.context, serializationOptions);
  const metadata = serializeMeta(meta, serializationOptions);

  return {
    timestamp: new Date(),
    level,
    ...(config.scope ? { scope: config.scope } : {}),
    message,
    ...(activeBindings.requestId ? { requestId: activeBindings.requestId } : {}),
    ...(activeBindings.correlationId
      ? { correlationId: activeBindings.correlationId }
      : {}),
    context,
    ...(metadata.meta !== undefined ? { meta: metadata.meta } : {}),
    ...(metadata.error ? { error: metadata.error } : {})
  };
}

function shouldEmitRecord(
  record: LogRecord,
  samplers: readonly LogSampler[]
): boolean {
  return samplers.every((sampler) => {
    try {
      return sampler(record);
    } catch (error) {
      reportInternalError("sampler", error);
      return true;
    }
  });
}

function buildLogger(config: ResolvedLoggerOptions): Logger {
  const emit = (level: LogLevel, message: string, meta?: unknown): void => {
    if (!shouldLog(level, config.minLevel)) {
      return;
    }

    const record = createRecord(level, message, meta, config);

    if (!shouldEmitRecord(record, config.samplers)) {
      return;
    }

    for (const hook of config.hooks) {
      invokeAndTrack(config.runtime, "hook", () => hook(record));
    }

    for (const transport of config.transports) {
      invokeAndTrack(config.runtime, "transport", () => transport.write(record));
    }
  };

  const createTimer = (message: string, meta?: unknown): LogTimer => {
    const startedAt = new Date();
    const startedMs = startedAt.getTime();

    return {
      startedAt,
      finish(options: LogTimerFinishOptions = {}): number {
        const durationMs = Date.now() - startedMs;
        emit(
          options.level ?? "info",
          options.message ?? message,
          buildTimedMeta(meta, options.meta, durationMs)
        );
        return durationMs;
      },
      fail(error: Error, options: LogTimerFailOptions = {}): number {
        const durationMs = Date.now() - startedMs;
        emit(
          options.level ?? "error",
          options.message ?? message,
          buildTimedMeta(meta, options.meta, durationMs, error)
        );
        return durationMs;
      }
    };
  };

  return {
    trace: (message, meta) => emit("trace", message, meta),
    debug: (message, meta) => emit("debug", message, meta),
    info: (message, meta) => emit("info", message, meta),
    success: (message, meta) => emit("success", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    error: (message, meta) => emit("error", message, meta),
    fatal: (message, meta) => emit("fatal", message, meta),
    child: (scope) =>
      buildLogger({
        ...config,
        scope: composeScope(config.scope, scope)
      }),
    withContext: (context) =>
      buildLogger({
        ...config,
        context: mergeContext(config.context, context)
      }),
    withRequestId: (requestId) =>
      buildLogger({
        ...config,
        requestId: normalizeId(requestId)
      }),
    withCorrelationId: (correlationId) =>
      buildLogger({
        ...config,
        correlationId: normalizeId(correlationId)
      }),
    withBindings: (bindings: LoggerBindings) =>
      buildLogger({
        ...config,
        context: mergeContext(config.context, bindings.context),
        requestId: normalizeId(bindings.requestId) ?? config.requestId,
        correlationId:
          normalizeId(bindings.correlationId) ?? config.correlationId
      }),
    time: (message, meta) => createTimer(message, meta),
    flush: () => flushTransports(config)
  };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const runtime = { pending: new Set<Promise<unknown>>() };
  return buildLogger(resolveOptions(options, runtime));
}
