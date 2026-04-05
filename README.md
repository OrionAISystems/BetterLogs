# @trs/betterlogs

`@trs/betterlogs` is a reusable logging package for TypeScript projects that want elegant console output locally and stronger delivery guarantees in production. It keeps the default developer experience clean while supporting scoped child loggers, structured metadata, redaction, async context propagation, durable batching, pluggable transports, broker helpers, health-aware delivery, and framework adapters.

## Installation

```bash
npm install @trs/betterlogs
```

For browser-focused usage, import the dedicated subpath:

```ts
import { createBrowserLogger } from "@trs/betterlogs/browser";
```

## Quick Start

```ts
import {
  createAsyncContextBindingsProvider,
  createDefaultRedactionRules,
  createLogger,
  createPartialKeyRedactionRule,
  runWithLogContext
} from "@trs/betterlogs";

const log = createLogger({
  scope: "api",
  minLevel: "debug",
  bindingsProvider: createAsyncContextBindingsProvider(),
  redact: [
    ...createDefaultRedactionRules(),
    createPartialKeyRedactionRule(["email"], {
      keepStart: 2,
      keepEnd: 10
    })
  ]
});

await runWithLogContext(
  {
    requestId: "req_123",
    correlationId: "corr_987",
    context: {
      route: "/users",
      tenantId: "team_42"
    }
  },
  async () => {
    const requestLog = log.child("users");
    const timer = requestLog.time("User created", {
      id: "u_123"
    });

    timer.finish({
      level: "success",
      meta: {
        email: "user@example.com",
        password: "demo-password-value"
      }
    });

    await requestLog.flush();
  }
);
```

Example output:

```txt
2026-03-30 11:45:22 SUCCESS [api:users] [req:req_123] [corr:corr_987] User created
{
  meta: {
    durationMs: 18,
    email: 'us********ple.com',
    id: 'u_123',
    password: '[REDACTED]'
  }
}
```

## Why BetterLogs

- clean human-readable pretty output by default
- structured JSON formatting and flattening for ingestion pipelines and MCP-oriented consumers
- async-aware logger bindings for request IDs, correlation IDs, and shared context
- durable batching with spool-file persistence and acknowledgement-aware retries
- built-in buffering, file output, file rotation, archival retention, HTTP delivery, and queue helpers
- transport retry, health tracking, circuit breaker wrapping, and explicit `flush()` support
- framework adapters for Express-style, Fastify-style, Koa-style, and fetch-style runtimes
- redaction helpers, OpenTelemetry bridge utilities, and test-friendly memory transports

## API Overview

### `createLogger(options?)`

Creates a logger instance.

```ts
import { createLogger } from "@trs/betterlogs";

const log = createLogger();
```

### Logger Methods

```ts
log.trace(message, meta?);
log.debug(message, meta?);
log.info(message, meta?);
log.success(message, meta?);
log.warn(message, meta?);
log.error(message, meta?);
log.fatal(message, meta?);
log.child(scope);
log.withContext(context);
log.withRequestId(requestId);
log.withCorrelationId(correlationId);
log.withBindings(bindings);
const timer = log.time(message, meta?);
await log.flush();
```

`flush()` waits for async hooks and transports, then asks flush-capable transports to drain buffered work.

## Logger Options

```ts
type LoggerOptions = {
  scope?: string;
  minLevel?: LogLevel;
  timestamps?: boolean;
  colors?: boolean;
  prettyPrintObjects?: boolean;
  showStackTrace?: boolean;
  format?: "pretty" | "json" | "browser";
  formatter?: LogFormatter;
  transports?: LogTransport | LogTransport[];
  hooks?: LogHook | LogHook[];
  serializers?: LogSerializer | LogSerializer[];
  redact?: LogRedactionRule | LogRedactionRule[];
  context?: Record<string, unknown>;
  requestId?: string;
  correlationId?: string;
  bindingsProvider?: LoggerBindingsProvider;
};
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `scope` | `string` | `undefined` | Adds a scope block like `[api]` to every entry. |
| `minLevel` | `LogLevel` | `"info"` | Filters out logs below the configured severity. |
| `timestamps` | `boolean` | `true` | Prints a local timestamp at the start of each entry. |
| `colors` | `boolean` | `true` | Enables colored pretty output for the main Node entry point. |
| `prettyPrintObjects` | `boolean` | `true` | Uses multi-line formatting for structured details. |
| `showStackTrace` | `boolean` | `true` | Includes stacks when logging `Error` objects. |
| `format` | `"pretty" \| "json" \| "browser"` | `"pretty"` | Chooses the default formatter used by the built-in console transport. |
| `formatter` | `LogFormatter` | `undefined` | Overrides the default formatter for the built-in console transport. |
| `transports` | `LogTransport \| LogTransport[]` | built-in console transport | Supplies custom transports. Pass `[]` to disable default output. |
| `hooks` | `LogHook \| LogHook[]` | `[]` | Observes each `LogRecord` before transports run. Hooks may be async. |
| `serializers` | `LogSerializer \| LogSerializer[]` | `[]` | Custom serializers for domain objects in metadata or context. |
| `redact` | `LogRedactionRule \| LogRedactionRule[]` | `[]` | Redaction rules for sensitive keys or exact paths. Supports full replacement and partial masking. |
| `context` | `Record<string, unknown>` | `{}` | Attaches reusable structured context to every entry. |
| `requestId` | `string` | `undefined` | Adds a request ID tag and top-level record field. |
| `correlationId` | `string` | `undefined` | Adds a correlation ID tag and top-level record field. |
| `bindingsProvider` | `LoggerBindingsProvider` | `undefined` | Pulls bindings from async context or another ambient source for every record. |

## Async Context Propagation

Use the built-in async context store when you want request and correlation IDs to flow through asynchronous work automatically.

```ts
import {
  createAsyncContextBindingsProvider,
  createLogger,
  runWithLogContext
} from "@trs/betterlogs";

const log = createLogger({
  scope: "worker",
  bindingsProvider: createAsyncContextBindingsProvider()
});

await runWithLogContext(
  {
    requestId: "req_123",
    correlationId: "corr_987",
    context: {
      jobId: "job_42"
    }
  },
  async () => {
    log.info("Processing started");
    await Promise.resolve();
    log.success("Processing finished");
  }
);
```

If you need more control, BetterLogs also exports `createLogContextStore()`, `bindLogContext()`, `enterLogContext()`, and `getLogContext()`.

## Request Timing Helpers

Use `time()` when you want a structured duration without hand-rolling start and end timestamps.

```ts
const timer = log.time("Tool call processed", {
  tool: "search"
});

try {
  timer.finish({
    level: "success",
    meta: {
      tokenCount: 1_234
    }
  });
} catch (error) {
  timer.fail(error as Error, {
    message: "Tool call failed"
  });
}
```

## Redaction Helpers

Use key or path based rules to protect secrets and PII before records reach hooks, transports, or formatters.

```ts
import {
  createDefaultRedactionRules,
  createKeyRedactionRule,
  createPartialKeyRedactionRule,
  createPathRedactionRule,
  createLogger
} from "@trs/betterlogs";

const log = createLogger({
  redact: [
    ...createDefaultRedactionRules(),
    createKeyRedactionRule(["authorization", "cookie"]),
    createPartialKeyRedactionRule(["email"], {
      keepStart: 2,
      keepEnd: 10
    }),
    createPathRedactionRule("meta.user.ssn")
  ]
});
```

## Durable Batching With Acknowledgement-Aware Retries

Use durable batching when you want a transport to persist records locally before attempting delivery.

```ts
import {
  createDurableBatchingTransport,
  createKafkaTransport,
  createLogger
} from "@trs/betterlogs";

const kafkaTransport = createKafkaTransport({
  producer: {
    async send(input) {
      void input;
    }
  },
  topic: "app.logs",
  key: (record) => record.requestId
});

const durableTransport = createDurableBatchingTransport({
  filePath: "./.betterlogs/spool.jsonl",
  maxBatchSize: 50,
  retry: {
    retries: 5,
    baseDelayMs: 250,
    maxDelayMs: 2_000
  },
  async sink(records) {
    for (const record of records) {
      await kafkaTransport.write(record);
    }

    return {
      acknowledgedCount: records.length
    };
  }
});

const log = createLogger({
  scope: "pipeline",
  transports: [durableTransport]
});
```

If the sink only acknowledges part of a batch, BetterLogs keeps the remaining records in the spool file for the next flush cycle.

## Transport Health And Circuit Breakers

Wrap transports when you want delivery diagnostics or a guardrail around unstable downstream systems.

```ts
import {
  createCircuitBreakerTransport,
  createHealthTrackedTransport,
  createHttpTransport,
  createLogger,
  getTransportHealth
} from "@trs/betterlogs";

const delivery = createCircuitBreakerTransport({
  name: "log-ingest",
  transport: createHealthTrackedTransport({
    name: "log-ingest",
    transport: createHttpTransport({
      url: "https://logs.internal.example/ingest"
    })
  }),
  failureThreshold: 3,
  resetTimeoutMs: 5_000
});

const log = createLogger({ transports: [delivery] });

log.info("Queued for delivery");
await log.flush();

const health = getTransportHealth(delivery);
```

Health-aware transports expose state such as `healthy`, `degraded`, `unhealthy`, `open`, and `half-open` alongside counters and timestamps.

## Queue And Broker Helpers

BetterLogs ships lightweight helpers for common broker-style destinations without taking hard dependencies on their SDKs.

### Generic Queue Transport

```ts
import { createLogger, createQueueTransport } from "@trs/betterlogs";

const queueLog = createLogger({
  transports: [
    createQueueTransport({
      async send(payload) {
        void payload;
      }
    })
  ]
});
```

### SQS Helper

```ts
import { createLogger, createSqsTransport } from "@trs/betterlogs";

const sqsLog = createLogger({
  transports: [
    createSqsTransport({
      client: {
        async sendMessage(input) {
          void input;
        }
      },
      queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/app-logs",
      messageGroupId: (record) => record.requestId ?? "default"
    })
  ]
});
```

### Kafka Helper

```ts
import { createKafkaTransport, createLogger } from "@trs/betterlogs";

const kafkaLog = createLogger({
  transports: [
    createKafkaTransport({
      producer: {
        async send(input) {
          void input;
        }
      },
      topic: "app.logs",
      key: (record) => record.requestId
    })
  ]
});
```

### BullMQ Helper

```ts
import { createBullMqTransport, createLogger } from "@trs/betterlogs";

const workerLog = createLogger({
  transports: [
    createBullMqTransport({
      queue: {
        async add(name, data, opts) {
          void name;
          void data;
          void opts;
        }
      },
      mode: "record",
      name: (record) => `${record.level}.log`
    })
  ]
});
```

## JSON Flattening

When logs are headed to ingestion pipelines, queue consumers, or an MCP layer, flattened JSON can be easier to query and route.

```ts
import { createJsonFormatter } from "@trs/betterlogs";

const formatter = createJsonFormatter({
  flatten: {
    enabled: true,
    include: ["context", "meta", "error"],
    delimiter: "."
  },
  prettyPrintObjects: false
});
```

This converts nested sections like `context.user.id` and `meta.durationMs` into top-level JSON keys while keeping the rest of the record shape stable.

## Buffered Transports And Flush Support

```ts
import { createBufferedTransport, createLogger } from "@trs/betterlogs";

const records: string[] = [];

const transport = createBufferedTransport({
  maxBufferSize: 10,
  flushIntervalMs: 1_000,
  sink: async (batch) => {
    records.push(...batch.map((record) => record.message));
  }
});

const log = createLogger({ transports: [transport] });

log.info("queued");
await log.flush();
```

Buffered transports are useful when you want to batch network, file, or analytics writes without making the logging callsite async.

## Retry And Backoff Policies

Wrap a transport when you want retry behavior without baking retry logic into every destination.

```ts
import {
  createHttpTransport,
  createRetryingTransport,
  createLogger
} from "@trs/betterlogs";

const transport = createRetryingTransport({
  transport: createHttpTransport({
    url: "https://logs.internal.example/ingest"
  }),
  retry: {
    retries: 5,
    baseDelayMs: 250,
    maxDelayMs: 2_000
  }
});

const log = createLogger({ transports: [transport] });
```

## File Transport, Rotation, And Retention

```ts
import { createFileTransport, createLogger } from "@trs/betterlogs";

const fileLog = createLogger({
  scope: "audit",
  format: "json",
  transports: [
    createFileTransport({
      filePath: "./logs/audit.log",
      rotate: {
        maxBytes: 1_000_000,
        maxFiles: 5
      },
      retention: {
        maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
        archiveDirectory: "./logs/archive"
      }
    })
  ]
});

fileLog.info("Audit event recorded", {
  actorId: "u_123",
  event: "user.updated"
});

await fileLog.flush();
```

The file transport writes asynchronously, rotates files once a size threshold is exceeded, and can archive or prune old log segments on a retention schedule.

## Formatter Variants

### Pretty Formatter

The default formatter for local development and service logs.

```ts
import { createPrettyFormatter } from "@trs/betterlogs";
```

### JSON Formatter

Best for pipelines, ingestion, or machine processing.

```ts
import { createJsonFormatter } from "@trs/betterlogs";
```

### Browser Formatter And Browser Entry

For browser-targeted imports, use the dedicated subpath:

```ts
import {
  createBrowserConsoleTransport,
  createBrowserLogger
} from "@trs/betterlogs/browser";

const log = createBrowserLogger({ scope: "ui" });
log.info("Mounted application shell");
```

## Framework Adapters

BetterLogs stays dependency-light, so the framework adapters are opt-in helpers rather than hard integrations.

### Express-Style Middleware

```ts
import { createExpressLoggingMiddleware, createLogger } from "@trs/betterlogs";

const baseLogger = createLogger({ scope: "http" });

export const requestLogger = createExpressLoggingMiddleware(baseLogger, {
  includeHeaders: ["user-agent"],
  successLevel: "info"
});
```

### Fastify-Style Hooks

```ts
import { createFastifyLoggingHooks, createLogger } from "@trs/betterlogs";

const baseLogger = createLogger({ scope: "http" });

export const hooks = createFastifyLoggingHooks(baseLogger, {
  includeHeaders: ["user-agent"]
});
```

### Koa-Style Middleware

```ts
import { createKoaLoggingMiddleware, createLogger } from "@trs/betterlogs";

const baseLogger = createLogger({ scope: "http" });

export const koaMiddleware = createKoaLoggingMiddleware(baseLogger, {
  includeHeaders: ["user-agent"]
});
```

### Fetch-Style Request Wrapper

```ts
import { createLogger, withFetchRequestLogging } from "@trs/betterlogs";

const baseLogger = createLogger({ scope: "http" });

export async function handle(request: Request) {
  return withFetchRequestLogging(
    baseLogger,
    request,
    async (logger) => {
      logger.info("Handling request");
      return new Response("ok", { status: 200 });
    }
  );
}
```

## OpenTelemetry Bridge Utilities

`@trs/betterlogs` stays dependency-light, so the OpenTelemetry helpers work through small compatible interfaces rather than taking a hard dependency on the OTel SDK.

```ts
import {
  createLogger,
  createOpenTelemetryLogHook,
  createOpenTelemetrySpanHook
} from "@trs/betterlogs";

const emitted: unknown[] = [];

const log = createLogger({
  hooks: [
    createOpenTelemetryLogHook({
      emit(record) {
        emitted.push(record);
      }
    }),
    createOpenTelemetrySpanHook({
      addEvent(name, attributes) {
        emitted.push({ name, attributes });
      }
    })
  ]
});
```

## Testing Utilities And Snapshots

```ts
import {
  createTestLogger,
  snapshotRecords
} from "@trs/betterlogs";

const { logger, transport } = createTestLogger({
  timestamps: false,
  colors: false
});

logger.info("Captured in tests", { id: "u_123" });
await logger.flush();

const snapshot = snapshotRecords(transport.records);
```

The memory transport and snapshot helpers make it easy to assert on structured log records in unit tests without stubbing global console methods.

## Custom Serializers

Serializers let you normalize domain objects before they reach formatters or transports.

```ts
import { createLogger, type LogSerializer } from "@trs/betterlogs";

class Money {
  constructor(
    public readonly amount: number,
    public readonly currency: string
  ) {}
}

const moneySerializer: LogSerializer<Money> = {
  name: "money",
  test(value): value is Money {
    return value instanceof Money;
  },
  serialize(value) {
    return `${value.currency} ${value.amount.toFixed(2)}`;
  }
};

const log = createLogger({
  serializers: [moneySerializer]
});

log.info("Invoice settled", {
  amount: new Money(129.99, "USD")
});
```

## Error Logging

```ts
const log = createLogger({ scope: "worker", showStackTrace: true });

try {
  throw new Error("Queue processing failed");
} catch (error) {
  log.error("Unhandled exception", error);
}
```

Errors are routed to `console.error` by the console transport, formatted clearly, and keep stack traces unless you disable them.

## Security

If you discover a vulnerability, please use the reporting guidance in [SECURITY.md](./SECURITY.md) rather than opening a public issue with exploit details.

## Example Project Files

The repository includes:

- [`examples/basic.ts`](./examples/basic.ts) for async context propagation, scoped logging, timing, redaction, and structured output
- [`examples/advanced.ts`](./examples/advanced.ts) for durable batching, Kafka-style delivery, health reporting, and circuit breaker wrapping
- [`examples/server.ts`](./examples/server.ts) for Express-style, Fastify-style, Koa-style, and fetch-style runtime adapters

## Development Scripts

```bash
npm run build
npm run dev
npm run typecheck
npm run clean
```

## Design Notes

`@trs/betterlogs` v0.5.0 keeps the runtime small while separating:

- record creation and ambient binding resolution
- redaction and serialization
- formatter selection and JSON shaping
- transport delivery, batching, retry, health tracking, and flushing
- hook observation
- Node and browser entry points
- runtime-specific adapter helpers

That separation makes it practical to add more outputs and integrations later without disturbing the logger API most callers use every day.

## Roadmap

Future ideas for the package:

- configurable log sampling and burst rate limiting
- transport metrics exporters and richer delivery diagnostics
- schema-driven structured event helpers for shared internal log contracts
- worker-thread and multi-process relay transports
- OTLP and vendor-specific transport presets
- CLI tooling for inspecting durable spool and archive files

## License

MIT
