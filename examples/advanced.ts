import {
  createCircuitBreakerTransport,
  createDurableBatchingTransport,
  createHealthTrackedTransport,
  createKafkaTransport,
  createLogger,
  getTransportHealth
} from "../src";

const producer = {
  async send(input: {
    topic: string;
    messages: Array<{
      key?: string;
      value: string;
      headers?: Record<string, string>;
    }>;
  }): Promise<void> {
    console.log("Kafka send", {
      messageCount: input.messages.length,
      topic: input.topic
    });
  }
};

const kafkaTransport = createKafkaTransport({
  producer,
  topic: "betterlogs.events",
  key: (record) => record.requestId,
  headers: (record) => ({
    level: record.level
  })
});

const deliveryTransport = createHealthTrackedTransport({
  name: "kafka-delivery",
  transport: kafkaTransport,
  degradedAfterFailures: 1,
  unhealthyAfterFailures: 3
});

const durableTransport = createDurableBatchingTransport({
  filePath: "./.betterlogs/spool.jsonl",
  maxBatchSize: 2,
  flushIntervalMs: 500,
  retry: {
    retries: 5,
    baseDelayMs: 100,
    maxDelayMs: 1_000
  },
  async sink(records) {
    for (const record of records) {
      await deliveryTransport.write(record);
    }

    return {
      acknowledgedCount: records.length
    };
  }
});

const protectedTransport = createCircuitBreakerTransport({
  name: "durable-pipeline",
  transport: durableTransport,
  failureThreshold: 3,
  resetTimeoutMs: 5_000
});

const log = createLogger({
  scope: "pipeline",
  minLevel: "info",
  format: "json",
  transports: [protectedTransport]
});

log.info("Batch queued", {
  batchId: "batch_001",
  source: "mcp"
});

log.success("Batch acknowledged", {
  batchId: "batch_001",
  recordCount: 2
});

await log.flush();

console.log("Pipeline health", getTransportHealth(protectedTransport));
console.log("Delivery health", getTransportHealth(deliveryTransport));
