import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  DEFAULT_BUFFER_SIZE,
  DEFAULT_FLUSH_INTERVAL_MS
} from "./constants";
import { executeWithRetry } from "./retry";
import type {
  DurableBatchAck,
  DurableBatchingTransportOptions,
  LogRecord,
  LogTransport
} from "./types";

type PersistedLogRecord = Omit<LogRecord, "timestamp"> & {
  readonly timestamp: string;
};

function normalizeAck(result: void | number | DurableBatchAck, count: number): number {
  if (typeof result === "number") {
    return result;
  }

  if (result && typeof result === "object" && "acknowledgedCount" in result) {
    return result.acknowledgedCount ?? count;
  }

  return count;
}

function toPersistedRecord(record: LogRecord): PersistedLogRecord {
  return {
    ...record,
    timestamp: record.timestamp.toISOString()
  };
}

function fromPersistedRecord(record: PersistedLogRecord): LogRecord {
  return {
    ...record,
    timestamp: new Date(record.timestamp)
  };
}

async function readRecords(filePath: string): Promise<readonly LogRecord[]> {
  const content = await readFile(filePath, "utf8").catch(() => "");
  if (!content.trim()) {
    return [];
  }

  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => fromPersistedRecord(JSON.parse(line) as PersistedLogRecord));
}

async function writeRecords(filePath: string, records: readonly LogRecord[]): Promise<void> {
  const payload = records
    .map((record) => JSON.stringify(toPersistedRecord(record)))
    .join("\n");

  await writeFile(filePath, payload.length > 0 ? `${payload}\n` : "", "utf8");
}

export function createDurableBatchingTransport(
  options: DurableBatchingTransportOptions
): LogTransport {
  const maxBatchSize = options.maxBatchSize ?? DEFAULT_BUFFER_SIZE;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const ensureDirectory = options.ensureDirectory ?? true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bufferedWrites = 0;
  let queue = Promise.resolve();

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task, task);
    return queue;
  };

  const scheduleFlush = (): void => {
    if (flushIntervalMs <= 0 || timer) {
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;
      void flushInternal();
    }, flushIntervalMs);
  };

  const flushInternal = (): Promise<void> =>
    enqueue(async () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }

      if (ensureDirectory) {
        await mkdir(dirname(options.filePath), { recursive: true });
      }

      while (true) {
        const records = await readRecords(options.filePath);
        if (records.length === 0) {
          bufferedWrites = 0;
          return;
        }

        const batch = records.slice(0, maxBatchSize);
        const runAck = async (): Promise<number> =>
          normalizeAck(await options.sink(batch), batch.length);
        const acknowledgedCount = options.retry
          ? await executeWithRetry({
              retry: options.retry,
              task: runAck
            })
          : await runAck();

        if (acknowledgedCount <= 0) {
          throw new Error("Durable batching sink acknowledged zero records");
        }

        await writeRecords(options.filePath, records.slice(acknowledgedCount));
        bufferedWrites = Math.max(records.length - acknowledgedCount, 0);

        if (acknowledgedCount < batch.length) {
          return;
        }
      }
    });

  return {
    write(record) {
      return enqueue(async () => {
        if (ensureDirectory) {
          await mkdir(dirname(options.filePath), { recursive: true });
        }

        await appendFile(
          options.filePath,
          `${JSON.stringify(toPersistedRecord(record))}\n`,
          "utf8"
        );

        bufferedWrites += 1;
      }).then(() => {
        if (bufferedWrites >= maxBatchSize) {
          return flushInternal();
        }

        scheduleFlush();
      });
    },
    flush() {
      return flushInternal();
    }
  };
}
