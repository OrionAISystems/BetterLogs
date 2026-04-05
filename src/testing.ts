import { createPrettyFormatter } from "./format";
import { createLogger } from "./logger";
import type {
  FormattedLogOutput,
  LogRecord,
  LoggerOptions,
  MemoryTransport,
  MemoryTransportOptions,
  TestLoggerResult
} from "./types";

function normalizeRecord(record: LogRecord) {
  return {
    ...record,
    timestamp: record.timestamp.toISOString()
  };
}

export function createMemoryTransport(
  options: MemoryTransportOptions = {}
): MemoryTransport {
  const formatter =
    options.formatter ??
    createPrettyFormatter({
      timestamps: false,
      colors: false,
      prettyPrintObjects: true
    });
  const records: LogRecord[] = [];
  const outputs: FormattedLogOutput[] = [];

  return {
    get records() {
      return records;
    },
    get outputs() {
      return outputs;
    },
    write(record) {
      records.push(record);
      outputs.push(formatter.format(record));
    },
    clear() {
      records.length = 0;
      outputs.length = 0;
    },
    flush() {
      return Promise.resolve();
    }
  };
}

export function createTestLogger(
  options: LoggerOptions = {}
): TestLoggerResult {
  const transport = options.formatter
    ? createMemoryTransport({ formatter: options.formatter })
    : createMemoryTransport();

  const logger = createLogger({
    ...options,
    transports: [transport]
  });

  return {
    logger,
    transport
  };
}

export function snapshotRecord(record: LogRecord): string {
  return JSON.stringify(normalizeRecord(record), null, 2);
}

export function snapshotRecords(records: readonly LogRecord[]): string {
  return records.map((record) => snapshotRecord(record)).join("\n\n");
}
