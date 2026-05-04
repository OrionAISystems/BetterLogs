export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "success"
  | "warn"
  | "error"
  | "fatal";

export type LogFormat = "pretty" | "json" | "browser";

export type LogContext = Record<string, unknown>;

export type MaybeArray<T> = T | readonly T[];

export type AsyncOrSync<T> = T | Promise<T>;

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly cause?: unknown;
  readonly [key: string]: unknown;
}

export interface LogRecord {
  readonly timestamp: Date;
  readonly level: LogLevel;
  readonly scope?: string;
  readonly message: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly context: Readonly<LogContext>;
  readonly meta?: unknown;
  readonly error?: SerializedError;
}

export interface FormattedLogOutput {
  readonly message: string;
  readonly stream: "stdout" | "stderr";
}

export interface LogFormatter {
  format(record: LogRecord): FormattedLogOutput;
}

export interface LogTransport {
  write(record: LogRecord): AsyncOrSync<void>;
  flush?(): AsyncOrSync<void>;
}

export type LogHook = (record: LogRecord) => AsyncOrSync<void>;

export type LogSampler = (record: LogRecord) => boolean;

export type SamplingLevelFilter = LogLevel | readonly LogLevel[];

export interface SamplingPolicyOptions {
  readonly rate: number;
  readonly levels?: SamplingLevelFilter;
  readonly random?: () => number;
}

export interface RateLimitSamplerOptions {
  readonly maxRecords: number;
  readonly intervalMs: number;
  readonly levels?: SamplingLevelFilter;
  readonly now?: () => number;
}

export interface LogSerializer<T = unknown> {
  readonly name?: string;
  test(value: unknown): value is T;
  serialize(value: T): unknown;
}

export interface LoggerBindings {
  readonly context?: LogContext;
  readonly requestId?: string;
  readonly correlationId?: string;
}

export type LoggerBindingsProvider = () => LoggerBindings | undefined;

export interface LogContextStore {
  run<T>(bindings: LoggerBindings, callback: () => T): T;
  get(): LoggerBindings | undefined;
  bind<T extends (...args: never[]) => unknown>(bindings: LoggerBindings, callback: T): T;
  enter(bindings: LoggerBindings): void;
}

export interface PrettyFormatterOptions {
  readonly timestamps?: boolean;
  readonly colors?: boolean;
  readonly prettyPrintObjects?: boolean;
}

export interface JsonFieldFlattenOptions {
  readonly enabled?: boolean;
  readonly delimiter?: string;
  readonly maxDepth?: number;
  readonly include?: MaybeArray<"context" | "meta" | "error">;
  readonly flattenArrays?: boolean;
}

export interface JsonFormatterOptions {
  readonly timestamps?: boolean;
  readonly prettyPrintObjects?: boolean;
  readonly flatten?: boolean | JsonFieldFlattenOptions;
}

export interface BrowserFormatterOptions {
  readonly timestamps?: boolean;
  readonly prettyPrintObjects?: boolean;
}

export interface ConsoleTransportOptions {
  readonly formatter?: LogFormatter;
  readonly console?: Pick<Console, "log" | "error">;
}

export type RedactionPattern = string | RegExp;

export interface LogRedactionRule {
  readonly keys?: MaybeArray<RedactionPattern>;
  readonly paths?: MaybeArray<string>;
  readonly replaceWith?: unknown;
  readonly strategy?: "replace" | "partial";
  readonly keepStart?: number;
  readonly keepEnd?: number;
  readonly maskCharacter?: string;
}

export interface BufferedTransportOptions {
  readonly maxBufferSize?: number;
  readonly flushIntervalMs?: number;
  readonly sink: (records: readonly LogRecord[]) => AsyncOrSync<void>;
}

export interface DurableBatchAck {
  readonly acknowledgedCount?: number;
}

export interface DurableBatchingTransportOptions {
  readonly filePath: string;
  readonly sink: (records: readonly LogRecord[]) => AsyncOrSync<void | number | DurableBatchAck>;
  readonly maxBatchSize?: number;
  readonly flushIntervalMs?: number;
  readonly ensureDirectory?: boolean;
  readonly retry?: RetryPolicyOptions;
}

export interface FileRotationOptions {
  readonly maxBytes: number;
  readonly maxFiles?: number;
}

export interface FileRetentionOptions {
  readonly maxAgeMs?: number;
  readonly pruneIntervalMs?: number;
  readonly archiveDirectory?: string;
}

export interface FileTransportOptions {
  readonly filePath: string;
  readonly formatter?: LogFormatter;
  readonly rotate?: FileRotationOptions;
  readonly ensureDirectory?: boolean;
  readonly retention?: FileRetentionOptions;
}

export interface BrowserConsoleTransportOptions {
  readonly formatter?: LogFormatter;
  readonly console?: Pick<Console, "log" | "error">;
}

export interface MemoryTransportOptions {
  readonly formatter?: LogFormatter;
}

export interface RetryPolicyOptions {
  readonly retries?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly factor?: number;
  readonly jitter?: boolean;
}

export interface RetryingTransportOptions {
  readonly transport: LogTransport;
  readonly retry?: RetryPolicyOptions;
  readonly shouldRetry?: (
    error: unknown,
    attempt: number,
    record?: LogRecord
  ) => boolean;
}

export interface HttpTransportOptions {
  readonly url: string;
  readonly method?: "POST" | "PUT";
  readonly formatter?: LogFormatter;
  readonly headers?: Record<string, string>;
  readonly retry?: RetryPolicyOptions;
  readonly fetch?: typeof globalThis.fetch;
}

export interface QueueTransportOptions {
  readonly formatter?: LogFormatter;
  readonly retry?: RetryPolicyOptions;
  readonly send: (payload: string, record: LogRecord) => AsyncOrSync<void>;
}

export interface SqsMessageAttribute {
  readonly DataType: string;
  readonly StringValue?: string;
}

export interface SqsLikeClient {
  sendMessage(input: {
    QueueUrl: string;
    MessageBody: string;
    MessageGroupId?: string;
    MessageDeduplicationId?: string;
    MessageAttributes?: Record<string, SqsMessageAttribute>;
  }): AsyncOrSync<unknown>;
}

export interface SqsTransportOptions {
  readonly client: SqsLikeClient;
  readonly queueUrl: string;
  readonly formatter?: LogFormatter;
  readonly retry?: RetryPolicyOptions;
  readonly messageGroupId?: string | ((record: LogRecord) => string | undefined);
  readonly messageDeduplicationId?: string | ((record: LogRecord) => string | undefined);
  readonly messageAttributes?: (record: LogRecord) => Record<string, SqsMessageAttribute> | undefined;
}

export interface KafkaLikeProducer {
  send(input: {
    topic: string;
    messages: Array<{
      key?: string;
      value: string;
      headers?: Record<string, string>;
    }>;
  }): AsyncOrSync<unknown>;
}

export interface KafkaTransportOptions {
  readonly producer: KafkaLikeProducer;
  readonly topic: string;
  readonly formatter?: LogFormatter;
  readonly retry?: RetryPolicyOptions;
  readonly key?: string | ((record: LogRecord) => string | undefined);
  readonly headers?: Record<string, string> | ((record: LogRecord) => Record<string, string> | undefined);
}

export interface BullMqLikeQueue {
  add(name: string, data: unknown, opts?: Record<string, unknown>): AsyncOrSync<unknown>;
}

export interface BullMqTransportOptions {
  readonly queue: BullMqLikeQueue;
  readonly formatter?: LogFormatter;
  readonly retry?: RetryPolicyOptions;
  readonly name?: string | ((record: LogRecord) => string);
  readonly mode?: "record" | "formatted";
  readonly jobOptions?: Record<string, unknown> | ((record: LogRecord) => Record<string, unknown> | undefined);
}

export type TransportHealthState = "healthy" | "degraded" | "unhealthy" | "open" | "half-open";

export interface TransportHealth {
  readonly name?: string;
  readonly state: TransportHealthState;
  readonly consecutiveFailures: number;
  readonly totalWrites: number;
  readonly totalSuccesses: number;
  readonly totalFailures: number;
  readonly lastSuccessAt?: Date;
  readonly lastFailureAt?: Date;
  readonly lastErrorMessage?: string;
  readonly openedAt?: Date;
  readonly openUntil?: Date;
}

export interface HealthAwareTransport extends LogTransport {
  getHealth(): TransportHealth;
}

export interface HealthTrackedTransportOptions {
  readonly transport: LogTransport;
  readonly name?: string;
  readonly degradedAfterFailures?: number;
  readonly unhealthyAfterFailures?: number;
}

export interface CircuitBreakerTransportOptions {
  readonly transport: LogTransport;
  readonly name?: string;
  readonly failureThreshold?: number;
  readonly resetTimeoutMs?: number;
  readonly halfOpenMaxWrites?: number;
}

export interface MemoryTransport extends LogTransport {
  readonly records: readonly LogRecord[];
  readonly outputs: readonly FormattedLogOutput[];
  clear(): void;
}

export interface LogTimerFinishOptions {
  readonly level?: LogLevel;
  readonly message?: string;
  readonly meta?: unknown;
}

export interface LogTimerFailOptions {
  readonly level?: "error" | "fatal";
  readonly message?: string;
  readonly meta?: unknown;
}

export interface LogTimer {
  readonly startedAt: Date;
  finish(options?: LogTimerFinishOptions): number;
  fail(error: Error, options?: LogTimerFailOptions): number;
}

export interface TestLoggerResult {
  readonly logger: Logger;
  readonly transport: MemoryTransport;
}

export interface OpenTelemetryLogRecord {
  readonly timestamp: number;
  readonly severityText: string;
  readonly severityNumber: number;
  readonly body: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export interface OpenTelemetryLogEmitter {
  emit(record: OpenTelemetryLogRecord): AsyncOrSync<void>;
}

export interface OpenTelemetrySpanLike {
  addEvent(name: string, attributes?: Record<string, unknown>): void;
}

export interface BrowserLoggerOptions extends LoggerBindings {
  readonly scope?: string;
  readonly minLevel?: LogLevel;
  readonly timestamps?: boolean;
  readonly prettyPrintObjects?: boolean;
  readonly formatter?: LogFormatter;
  readonly transports?: MaybeArray<LogTransport>;
  readonly hooks?: MaybeArray<LogHook>;
  readonly sample?: MaybeArray<LogSampler>;
  readonly serializers?: MaybeArray<LogSerializer>;
  readonly redact?: MaybeArray<LogRedactionRule>;
  readonly bindingsProvider?: LoggerBindingsProvider;
}

export interface LoggerOptions extends LoggerBindings {
  readonly scope?: string;
  readonly minLevel?: LogLevel;
  readonly timestamps?: boolean;
  readonly colors?: boolean;
  readonly prettyPrintObjects?: boolean;
  readonly showStackTrace?: boolean;
  readonly format?: LogFormat;
  readonly formatter?: LogFormatter;
  readonly transports?: MaybeArray<LogTransport>;
  readonly hooks?: MaybeArray<LogHook>;
  readonly sample?: MaybeArray<LogSampler>;
  readonly serializers?: MaybeArray<LogSerializer>;
  readonly redact?: MaybeArray<LogRedactionRule>;
  readonly bindingsProvider?: LoggerBindingsProvider;
}

export interface HeaderCarrier {
  readonly get?: (name: string) => string | null | undefined;
}

export interface RequestLoggerBindingOptions {
  readonly requestIdHeader?: string;
  readonly correlationIdHeader?: string;
  readonly includeHeaders?: MaybeArray<string>;
}

export interface ExpressLikeRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly id?: string;
}

export interface ExpressLikeResponse {
  readonly statusCode: number;
  on(event: "finish", listener: () => void): void;
}

export type ExpressLikeNext = () => void;

export interface FastifyLikeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly id?: string;
}

export interface FastifyLikeReply {
  readonly statusCode: number;
}

export interface KoaLikeContext {
  readonly request: {
    readonly method: string;
    readonly url: string;
    readonly headers: Record<string, string | string[] | undefined>;
    readonly id?: string;
  };
  readonly response: {
    status: number;
  };
}

export type KoaLikeNext = () => Promise<unknown>;

export interface FetchLikeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: HeaderCarrier;
}

export interface FetchLikeResponse {
  readonly status: number;
}

export interface HttpLoggingAdapterOptions extends RequestLoggerBindingOptions {
  readonly scope?: string;
  readonly message?: string;
  readonly successLevel?: LogLevel;
}

export interface FastifyLoggingHooks {
  onRequest(request: FastifyLikeRequest, reply: FastifyLikeReply): void;
  onResponse(request: FastifyLikeRequest, reply: FastifyLikeReply): void;
}

export interface Logger {
  trace(message: string, meta?: unknown): void;
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  success(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  fatal(message: string, meta?: unknown): void;
  child(scope: string): Logger;
  withContext(context: LogContext): Logger;
  withRequestId(requestId: string): Logger;
  withCorrelationId(correlationId: string): Logger;
  withBindings(bindings: LoggerBindings): Logger;
  time(message: string, meta?: unknown): LogTimer;
  flush(): Promise<void>;
}
