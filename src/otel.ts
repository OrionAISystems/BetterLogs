import type {
  LogHook,
  LogLevel,
  LogRecord,
  OpenTelemetryLogEmitter,
  OpenTelemetryLogRecord,
  OpenTelemetrySpanLike
} from "./types";

const severityNumbers: Record<LogLevel, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  success: 10,
  warn: 13,
  error: 17,
  fatal: 21
};

function toAttributeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toAttributeValue(entry));
  }

  if (value === undefined) {
    return undefined;
  }

  return JSON.stringify(value);
}

export function toOpenTelemetrySeverityNumber(level: LogLevel): number {
  return severityNumbers[level];
}

export function createOpenTelemetryLogRecord(
  record: LogRecord
): OpenTelemetryLogRecord {
  const attributes: Record<string, unknown> = {
    "log.level": record.level,
    ...(record.scope ? { "log.scope": record.scope } : {}),
    ...(record.requestId ? { "log.request_id": record.requestId } : {}),
    ...(record.correlationId
      ? { "log.correlation_id": record.correlationId }
      : {})
  };

  for (const [key, value] of Object.entries(record.context)) {
    attributes[`context.${key}`] = toAttributeValue(value);
  }

  if (record.meta !== undefined) {
    attributes["log.meta"] = toAttributeValue(record.meta);
  }

  if (record.error) {
    attributes["exception.type"] = record.error.name;
    attributes["exception.message"] = record.error.message;

    if (record.error.stack) {
      attributes["exception.stacktrace"] = record.error.stack;
    }
  }

  return {
    timestamp: record.timestamp.getTime(),
    severityText: record.level.toUpperCase(),
    severityNumber: toOpenTelemetrySeverityNumber(record.level),
    body: record.message,
    attributes
  };
}

export function createOpenTelemetryLogHook(
  emitter: OpenTelemetryLogEmitter
): LogHook {
  return (record) => emitter.emit(createOpenTelemetryLogRecord(record));
}

export function createOpenTelemetrySpanHook(
  span: OpenTelemetrySpanLike,
  eventName = "log"
): LogHook {
  return (record) => {
    const otelRecord = createOpenTelemetryLogRecord(record);
    span.addEvent(eventName, {
      ...otelRecord.attributes,
      "log.body": otelRecord.body,
      "log.severity_number": otelRecord.severityNumber,
      "log.severity_text": otelRecord.severityText,
      "log.timestamp_unix_ms": otelRecord.timestamp
    });
  };
}
