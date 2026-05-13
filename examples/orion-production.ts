import {
  createFetchTransportDiagnosticsHandler,
  createOrionProductionLoggingPreset,
  formatTransportDiagnosticsAsPrometheus,
  runWithLogContext
} from "../src";

const logging = createOrionProductionLoggingPreset({
  scope: "orion-gateway",
  serviceName: "orion-gateway",
  serviceVersion: "0.11.0",
  environment: process.env.NODE_ENV ?? "development",
  http: {
    url: process.env.ORION_LOG_INGEST_URL ?? "https://logs.internal.example/ingest",
    headers: {
      "x-log-source": "orion"
    }
  },
  durable: {
    filePath: "./.betterlogs/orion-gateway-spool.jsonl",
    maxBatchSize: 25,
    flushIntervalMs: 1_000
  },
  circuitBreaker: {
    onStateChange(transition) {
      console.warn("Log delivery state changed", {
        currentState: transition.currentState,
        previousState: transition.previousState,
        reason: transition.reason,
        transport: transition.name
      });
    }
  },
  debugBurstLimit: {
    maxRecords: 100,
    intervalMs: 60_000
  },
  labels: {
    service: "orion-gateway"
  }
});

await runWithLogContext(
  {
    requestId: "req_orion_123",
    correlationId: "corr_orion_456",
    context: {
      route: "/v1/tasks",
      workspace: "local"
    }
  },
  async () => {
    logging.logger.info("Task accepted", {
      taskId: "task_001",
      surface: "gateway"
    });

    await logging.flush();
  }
);

const diagnostics = logging.getDiagnostics();
console.log(diagnostics.status, diagnostics.totalFailures);
console.log(formatTransportDiagnosticsAsPrometheus(diagnostics));

export const metricsHandler = createFetchTransportDiagnosticsHandler(
  logging.healthTransports,
  {
    format: "prometheus",
    labels: {
      endpoint: "metrics"
    },
    statusCode: "from-health"
  }
);
