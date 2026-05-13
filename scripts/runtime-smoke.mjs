import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  createAsyncContextBindingsProvider,
  createCircuitBreakerTransport,
  createExpressTransportDiagnosticsHandler,
  createFastifyLoggingHooks,
  createFetchTransportDiagnosticsHandler,
  createHealthTrackedTransport,
  createTestLogger,
  createTransportDiagnosticsSnapshot,
  formatTransportDiagnosticsAsPrometheus,
  withFetchRequestLogging
} from "../dist/index.js";

const execFileAsync = promisify(execFile);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function findRecord(records, message) {
  return records.find((record) => record.message === message);
}

const { logger, transport } = createTestLogger({
  bindingsProvider: createAsyncContextBindingsProvider()
});

const fastifyHooks = createFastifyLoggingHooks(logger, {
  includeHeaders: ["user-agent"],
  successLevel: "info"
});

const fastifyRequest = {
  method: "GET",
  url: "/runtime-smoke",
  headers: {
    "user-agent": "betterlogs-runtime-smoke",
    "x-request-id": "req_fastify_runtime",
    "x-correlation-id": "corr_fastify_runtime"
  },
  id: "fallback_fastify_id"
};

fastifyHooks.onRequest(fastifyRequest, { statusCode: 200 });
await Promise.resolve();
logger.info("fastify handler log");
fastifyHooks.onResponse(fastifyRequest, { statusCode: 204 });
await logger.flush();

const fastifyHandlerRecord = findRecord(transport.records, "fastify handler log");
assert(fastifyHandlerRecord, "Fastify handler log was not captured.");
assert(
  fastifyHandlerRecord.requestId === "req_fastify_runtime",
  "Fastify ambient request ID did not survive the runtime lifecycle."
);
assert(
  fastifyHandlerRecord.correlationId === "corr_fastify_runtime",
  "Fastify ambient correlation ID did not survive the runtime lifecycle."
);
assert(
  fastifyHandlerRecord.context.headers?.["user-agent"] === "betterlogs-runtime-smoke",
  "Fastify included headers were not bound into runtime context."
);

const fastifyResponseRecord = transport.records.find(
  (record) =>
    record.message === "GET /runtime-smoke" &&
    record.requestId === "req_fastify_runtime" &&
    record.meta?.statusCode === 204
);
assert(fastifyResponseRecord, "Fastify response timer did not capture status metadata.");

await withFetchRequestLogging(
  logger,
  {
    method: "POST",
    url: "https://example.com/runtime-smoke",
    headers: new Headers({
      "user-agent": "betterlogs-fetch-smoke",
      "x-request-id": "req_fetch_runtime",
      "x-correlation-id": "corr_fetch_runtime"
    })
  },
  async (requestLogger) => {
    await Promise.resolve();
    requestLogger.info("fetch handler log");

    return {
      status: 202
    };
  },
  {
    includeHeaders: ["user-agent"],
    successLevel: "info"
  }
);
await logger.flush();

const fetchHandlerRecord = findRecord(transport.records, "fetch handler log");
assert(fetchHandlerRecord, "Fetch handler log was not captured.");
assert(
  fetchHandlerRecord.requestId === "req_fetch_runtime",
  "Fetch request ID was not bound for handler logs."
);
assert(
  fetchHandlerRecord.context.headers?.["user-agent"] === "betterlogs-fetch-smoke",
  "Fetch Headers includeHeaders support regressed."
);

const transitions = [];
const failingDelivery = createCircuitBreakerTransport({
  name: "runtime-smoke-pipeline",
  transport: createHealthTrackedTransport({
    name: "runtime-smoke-delivery",
    transport: {
      write() {
        throw new Error("runtime smoke ingest unavailable");
      }
    }
  }),
  failureThreshold: 1,
  resetTimeoutMs: 60_000,
  onStateChange(transition) {
    transitions.push(transition);
  }
});

await failingDelivery
  .write({
    timestamp: new Date("2026-05-09T12:00:00.000Z"),
    level: "info",
    message: "diagnostic smoke record",
    context: {}
  })
  .catch(() => undefined);

const diagnostics = createTransportDiagnosticsSnapshot([failingDelivery], {
  now: new Date(),
  labels: {
    "invalid-label": "normalized",
    service: "runtime-smoke"
  }
});

assert(diagnostics.status === "unhealthy", "Diagnostics did not flag open transport state.");
assert(
  transitions.some(
    (transition) =>
      transition.previousState === "healthy" &&
      transition.currentState === "open" &&
      transition.reason === "circuit-opened"
  ),
  "Circuit breaker did not emit a health transition."
);
assert(
  diagnostics.transports[0]?.openRemainingMs > 0,
  "Diagnostics did not expose open circuit remaining time."
);

const prometheusMetrics = formatTransportDiagnosticsAsPrometheus(diagnostics);
assert(
  prometheusMetrics.includes("betterlogs_transport_total_failures"),
  "Prometheus diagnostics did not include failure counters."
);
assert(
  prometheusMetrics.includes("betterlogs_transports_total"),
  "Prometheus diagnostics did not include aggregate transport gauges."
);
assert(
  prometheusMetrics.includes("betterlogs_total_failures"),
  "Prometheus diagnostics did not include aggregate failure counters."
);
assert(
  prometheusMetrics.includes('service="runtime-smoke"'),
  "Prometheus diagnostics did not include snapshot labels."
);
assert(
  prometheusMetrics.includes('invalid_label="normalized"'),
  "Prometheus diagnostics did not normalize label names."
);

const fetchDiagnostics = createFetchTransportDiagnosticsHandler([failingDelivery], {
  format: "prometheus",
  statusCode: "from-health"
})();
assert(fetchDiagnostics.status === 503, "Fetch diagnostics did not map unhealthy status.");
assert(
  fetchDiagnostics.headers["content-type"].startsWith("text/plain"),
  "Fetch diagnostics did not return Prometheus content type."
);

let expressStatusCode = 0;
const expressHeaders = new Map();
let expressBody = "";
createExpressTransportDiagnosticsHandler([failingDelivery], {
  format: "json",
  statusCode: "from-health"
})(
  {},
  {
    status(code) {
      expressStatusCode = code;
      return this;
    },
    setHeader(name, value) {
      expressHeaders.set(name.toLowerCase(), value);
    },
    end(body) {
      expressBody = body;
    }
  }
);

assert(expressStatusCode === 503, "Express diagnostics did not map unhealthy status.");
assert(
  expressHeaders.get("content-type").startsWith("application/json"),
  "Express diagnostics did not return JSON content type."
);
assert(
  JSON.parse(expressBody).status === "unhealthy",
  "Express diagnostics did not return the diagnostics snapshot."
);

const tempDirectory = await mkdtemp(join(tmpdir(), "betterlogs-runtime-"));
const spoolPath = join(tempDirectory, "spool.jsonl");

try {
  await writeFile(
    spoolPath,
    [
      JSON.stringify({
        timestamp: "2026-05-09T12:00:00.000Z",
        level: "info",
        scope: "runtime",
        message: "first durable record",
        requestId: "req_cli_1",
        context: {
          workflow: "smoke"
        }
      }),
      JSON.stringify({
        timestamp: "2026-05-09T12:00:01.000Z",
        level: "warn",
        scope: "runtime",
        message: "second durable record",
        requestId: "req_cli_2"
      })
    ].join("\n") + "\n",
    "utf8"
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    ["dist/cli.js", "inspect", spoolPath, "--json", "--limit", "1"]
  );
  const inspection = JSON.parse(stdout);

  assert(inspection.totalRecordCount === 2, "CLI inspection did not count JSONL records.");
  assert(inspection.totalInvalidLineCount === 0, "CLI inspection reported unexpected invalid lines.");
  assert(inspection.files[0]?.levels?.info === 1, "CLI inspection did not summarize levels.");
  assert(
    inspection.files[0]?.recentRecords?.[0]?.message === "second durable record",
    "CLI inspection did not honor the recent record limit."
  );
} finally {
  await rm(tempDirectory, {
    recursive: true,
    force: true
  });
}
