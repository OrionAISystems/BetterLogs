import { createJsonFormatter } from "./format";
import { createRetryingTransport } from "./retry";
import type {
  BullMqTransportOptions,
  HttpTransportOptions,
  KafkaTransportOptions,
  LogRecord,
  LogTransport,
  QueueTransportOptions,
  SqsTransportOptions
} from "./types";

function resolveRecordValue<T>(
  value: T | ((record: LogRecord) => T),
  record: LogRecord
): T {
  return typeof value === "function"
    ? (value as (record: LogRecord) => T)(record)
    : value;
}

function maybeWrapRetry(
  transport: LogTransport,
  retry: QueueTransportOptions["retry"]
): LogTransport {
  return retry
    ? createRetryingTransport({
        transport,
        retry
      })
    : transport;
}

export function createHttpTransport(
  options: HttpTransportOptions
): LogTransport {
  const formatter =
    options.formatter ??
    createJsonFormatter({
      timestamps: true,
      prettyPrintObjects: false,
      flatten: true
    });
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const baseTransport: LogTransport = {
    async write(record) {
      const output = formatter.format(record);
      const response = await fetchImpl(options.url, {
        method: options.method ?? "POST",
        headers: {
          "content-type": "application/json",
          ...options.headers
        },
        body: output.message
      });

      if (!response.ok) {
        throw new Error(`HTTP transport failed with ${response.status} ${response.statusText}`);
      }
    }
  };

  return maybeWrapRetry(baseTransport, options.retry);
}

export function createQueueTransport(
  options: QueueTransportOptions
): LogTransport {
  const formatter =
    options.formatter ??
    createJsonFormatter({
      timestamps: true,
      prettyPrintObjects: false,
      flatten: true
    });

  const baseTransport: LogTransport = {
    async write(record) {
      const output = formatter.format(record);
      await options.send(output.message, record);
    }
  };

  return maybeWrapRetry(baseTransport, options.retry);
}

export function createSqsTransport(options: SqsTransportOptions): LogTransport {
  const formatter =
    options.formatter ??
    createJsonFormatter({
      timestamps: true,
      prettyPrintObjects: false,
      flatten: true
    });

  return createQueueTransport({
    formatter,
    ...(options.retry ? { retry: options.retry } : {}),
    async send(payload, record) {
      const messageGroupId = options.messageGroupId
        ? resolveRecordValue(options.messageGroupId, record)
        : undefined;
      const deduplicationId = options.messageDeduplicationId
        ? resolveRecordValue(options.messageDeduplicationId, record)
        : undefined;
      const attributes = options.messageAttributes?.(record);

      await options.client.sendMessage({
        QueueUrl: options.queueUrl,
        MessageBody: payload,
        ...(messageGroupId ? { MessageGroupId: messageGroupId } : {}),
        ...(deduplicationId ? { MessageDeduplicationId: deduplicationId } : {}),
        ...(attributes ? { MessageAttributes: attributes } : {})
      });
    }
  });
}

export function createKafkaTransport(options: KafkaTransportOptions): LogTransport {
  const formatter =
    options.formatter ??
    createJsonFormatter({
      timestamps: true,
      prettyPrintObjects: false,
      flatten: true
    });

  return createQueueTransport({
    formatter,
    ...(options.retry ? { retry: options.retry } : {}),
    async send(payload, record) {
      const key = options.key ? resolveRecordValue(options.key, record) : undefined;
      const headers = options.headers
        ? resolveRecordValue(options.headers, record)
        : undefined;

      await options.producer.send({
        topic: options.topic,
        messages: [
          {
            ...(key ? { key } : {}),
            value: payload,
            ...(headers ? { headers } : {})
          }
        ]
      });
    }
  });
}

export function createBullMqTransport(options: BullMqTransportOptions): LogTransport {
  const formatter =
    options.formatter ??
    createJsonFormatter({
      timestamps: true,
      prettyPrintObjects: false,
      flatten: true
    });

  return createQueueTransport({
    formatter,
    ...(options.retry ? { retry: options.retry } : {}),
    async send(payload, record) {
      const name = options.name
        ? resolveRecordValue(options.name, record)
        : record.level;
      const jobOptions = options.jobOptions
        ? resolveRecordValue(options.jobOptions, record)
        : undefined;
      const data =
        (options.mode ?? "record") === "formatted"
          ? payload
          : {
              ...record,
              timestamp: record.timestamp.toISOString()
            };

      await options.queue.add(name, data, jobOptions);
    }
  });
}
