import { createAsyncContextBindingsProvider } from "./context";
import { createDurableBatchingTransport } from "./durable";
import { createJsonFormatter } from "./format";
import {
  createCircuitBreakerTransport,
  createHealthTrackedTransport,
  createTransportDiagnosticsSnapshot
} from "./health";
import { createLogger } from "./logger";
import { createHttpTransport } from "./network";
import { createDefaultRedactionRules } from "./redact";
import { createBurstRateLimitSampler, createCompositeSampler } from "./sampling";
import { createConsoleTransport } from "./transports";
import type {
  DurableBatchingTransportOptions,
  HealthAwareTransport,
  HttpTransportOptions,
  Logger,
  LogContext,
  LogLevel,
  LogRedactionRule,
  LogSampler,
  LogTransport,
  MaybeArray,
  RetryPolicyOptions,
  TransportDiagnosticsLabels,
  TransportDiagnosticsSnapshot
} from "./types";

export interface OrionProductionLoggingPresetOptions {
  readonly scope: string;
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly environment?: string;
  readonly minLevel?: LogLevel;
  readonly context?: LogContext;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly labels?: TransportDiagnosticsLabels;
  readonly http?: Pick<
    HttpTransportOptions,
    "url" | "method" | "headers" | "fetch" | "retry"
  >;
  readonly durable?: Pick<
    DurableBatchingTransportOptions,
    "filePath" | "maxBatchSize" | "flushIntervalMs" | "ensureDirectory" | "retry"
  >;
  readonly circuitBreaker?: {
    readonly failureThreshold?: number;
    readonly resetTimeoutMs?: number;
    readonly halfOpenMaxWrites?: number;
  };
  readonly health?: {
    readonly degradedAfterFailures?: number;
    readonly unhealthyAfterFailures?: number;
  };
  readonly console?: boolean;
  readonly sample?: MaybeArray<LogSampler>;
  readonly debugBurstLimit?: {
    readonly maxRecords: number;
    readonly intervalMs: number;
  };
  readonly redact?: MaybeArray<LogRedactionRule>;
  readonly includeDefaultRedaction?: boolean;
  readonly extraTransports?: MaybeArray<LogTransport>;
}

export interface OrionProductionLoggingPreset {
  readonly logger: Logger;
  readonly healthTransports: readonly HealthAwareTransport[];
  getDiagnostics(): TransportDiagnosticsSnapshot;
  flush(): Promise<void>;
}

function normalizeArray<T>(value: MaybeArray<T> | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

function buildServiceContext(options: OrionProductionLoggingPresetOptions): LogContext {
  return {
    ...(options.serviceName ? { service: options.serviceName } : {}),
    ...(options.serviceVersion ? { serviceVersion: options.serviceVersion } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    ...options.context
  };
}

function buildSamplers(options: OrionProductionLoggingPresetOptions): readonly LogSampler[] {
  const samplers = [...normalizeArray(options.sample)];

  if (options.debugBurstLimit) {
    samplers.push(
      createBurstRateLimitSampler({
        ...options.debugBurstLimit,
        levels: "debug"
      })
    );
  }

  return samplers.length > 1 ? [createCompositeSampler(samplers)] : samplers;
}

function buildHttpPipeline(options: OrionProductionLoggingPresetOptions): {
  readonly transport: LogTransport | undefined;
  readonly healthTransports: readonly HealthAwareTransport[];
} {
  if (!options.http) {
    return {
      transport: undefined,
      healthTransports: []
    };
  }

  const delivery = createHealthTrackedTransport({
    name: `${options.scope}:http-delivery`,
    transport: createHttpTransport({
      ...options.http,
      formatter: createJsonFormatter()
    }),
    degradedAfterFailures: options.health?.degradedAfterFailures ?? 1,
    unhealthyAfterFailures: options.health?.unhealthyAfterFailures ?? 3
  });

  const pipelineTransport = options.durable
    ? createDurableBatchingTransport({
        ...options.durable,
        sink: async (records) => {
          for (const record of records) {
            await delivery.write(record);
          }

          return {
            acknowledgedCount: records.length
          };
        },
        retry: resolveDurableRetry(options.durable.retry)
      })
    : delivery;

  const pipeline = createCircuitBreakerTransport({
    name: `${options.scope}:${options.durable ? "durable-pipeline" : "http-pipeline"}`,
    transport: pipelineTransport,
    failureThreshold: options.circuitBreaker?.failureThreshold ?? 3,
    resetTimeoutMs: options.circuitBreaker?.resetTimeoutMs ?? 30_000,
    halfOpenMaxWrites: options.circuitBreaker?.halfOpenMaxWrites ?? 1
  });

  return {
    transport: pipeline,
    healthTransports: [pipeline, delivery]
  };
}

function resolveDurableRetry(retry: RetryPolicyOptions | undefined): RetryPolicyOptions {
  return retry ?? { retries: 5, baseDelayMs: 100, maxDelayMs: 2_000 };
}

export function createOrionProductionLoggingPreset(
  options: OrionProductionLoggingPresetOptions
): OrionProductionLoggingPreset {
  const formatter = createJsonFormatter({
    flatten: {
      enabled: true,
      include: ["context", "meta", "error"]
    }
  });
  const pipeline = buildHttpPipeline(options);
  const healthTransports = pipeline.healthTransports;
  const transports = [
    ...(options.console !== false ? [createConsoleTransport({ formatter })] : []),
    ...(pipeline.transport ? [pipeline.transport] : []),
    ...normalizeArray(options.extraTransports)
  ];
  const redactions =
    options.includeDefaultRedaction === false
      ? normalizeArray(options.redact)
      : [...createDefaultRedactionRules(), ...normalizeArray(options.redact)];
  const logger = createLogger({
    scope: options.scope,
    minLevel: options.minLevel ?? "info",
    colors: false,
    format: "json",
    formatter,
    transports,
    bindingsProvider: createAsyncContextBindingsProvider(),
    context: buildServiceContext(options),
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
    sample: buildSamplers(options),
    redact: redactions
  });

  return {
    logger,
    healthTransports,
    getDiagnostics() {
      return createTransportDiagnosticsSnapshot(healthTransports, {
        labels: {
          ...(options.serviceName ? { service: options.serviceName } : {}),
          ...(options.environment ? { environment: options.environment } : {}),
          ...options.labels
        }
      });
    },
    flush() {
      return logger.flush();
    }
  };
}
