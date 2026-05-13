import {
  createAsyncContextBindingsProvider,
  createFastifyLoggingHooks,
  createOrionProductionLoggingPreset,
  createTransportDiagnosticsSnapshot,
  formatTransportDiagnosticsAsPrometheus,
  inspectDurableLogPaths,
  createLogger,
  createRequestLoggerBindings,
  createTestLogger,
  runWithLogContext,
  withFetchRequestLogging,
  type DurableSpoolInspection,
  type FastifyLikeReply,
  type FastifyLikeRequest,
  type FetchLikeRequest,
  type FetchLikeResponse,
  type Logger,
  type LogRecord,
  type TransportDiagnosticsSnapshot
} from "@orionaisystems/betterlogs";
import {
  createBrowserConsoleTransport,
  createBrowserLogger,
  createPercentageSampler,
  type BrowserLoggerOptions
} from "@orionaisystems/betterlogs/browser";

const rootLogger: Logger = createLogger({
  scope: "api-test",
  bindingsProvider: createAsyncContextBindingsProvider(),
  transports: []
});

runWithLogContext(
  {
    requestId: "req_type_test",
    correlationId: "corr_type_test",
    context: {
      route: "/type-test"
    }
  },
  () => {
    rootLogger.info("Root package public API compiles");
  }
);

const bindings = createRequestLoggerBindings(
  {
    method: "GET",
    url: "/type-test",
    headers: new Headers({
      "user-agent": "type-test",
      "x-request-id": "req_headers"
    })
  },
  {
    includeHeaders: ["user-agent"]
  }
);

rootLogger.withBindings(bindings).debug("Headers-style request bindings compile");

const fastifyHooks = createFastifyLoggingHooks(rootLogger, {
  includeHeaders: ["user-agent"]
});

const fastifyRequest: FastifyLikeRequest = {
  method: "GET",
  url: "/type-test",
  headers: {
    "user-agent": "type-test"
  },
  id: "req_fastify"
};
const fastifyReply: FastifyLikeReply = {
  statusCode: 204
};

fastifyHooks.onRequest(fastifyRequest, fastifyReply);
fastifyHooks.onResponse(fastifyRequest, fastifyReply);

const fetchRequest: FetchLikeRequest = {
  method: "GET",
  url: "https://example.com/type-test",
  headers: new Headers({
    "user-agent": "type-test"
  })
};

const fetchResponse: Promise<FetchLikeResponse> = withFetchRequestLogging(
  rootLogger,
  fetchRequest,
  async (logger) => {
    logger.info("Fetch adapter public API compiles");
    return {
      status: 200
    };
  }
);

void fetchResponse;

const { logger: testLogger, transport } = createTestLogger({
  transports: []
});
testLogger.warn("Test utilities compile");

const firstRecord: LogRecord | undefined = transport.records[0];
void firstRecord;

const browserOptions: BrowserLoggerOptions = {
  scope: "browser-type-test",
  transports: [
    createBrowserConsoleTransport()
  ],
  sample: createPercentageSampler({
    rate: 1
  })
};

const browserLogger = createBrowserLogger(browserOptions);
browserLogger.info("Browser subpath public API compiles");

const durableInspection: Promise<DurableSpoolInspection> = inspectDurableLogPaths(
  ["./.betterlogs/spool.jsonl"],
  {
    limit: 5
  }
);

void durableInspection;

const loggingPreset = createOrionProductionLoggingPreset({
  scope: "orion-type-test",
  serviceName: "orion",
  environment: "test",
  console: false,
  http: {
    url: "https://logs.example.test/ingest"
  },
  durable: {
    filePath: "./.betterlogs/type-test-spool.jsonl"
  },
  labels: {
    surface: "type-test"
  }
});

loggingPreset.logger.info("Preset public API compiles");

const diagnostics: TransportDiagnosticsSnapshot = loggingPreset.getDiagnostics();
const directDiagnostics = createTransportDiagnosticsSnapshot(
  loggingPreset.healthTransports
);
const prometheusMetrics = formatTransportDiagnosticsAsPrometheus(diagnostics, {
  labels: {
    source: "api-test"
  }
});

void directDiagnostics;
void prometheusMetrics;
