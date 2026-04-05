import {
  DEFAULT_BUFFER_SIZE,
  DEFAULT_FLUSH_INTERVAL_MS
} from "./constants";
import { createBrowserFormatter, createPrettyFormatter } from "./format";
import type {
  BrowserConsoleTransportOptions,
  BufferedTransportOptions,
  ConsoleTransportOptions,
  LogRecord,
  LogTransport
} from "./types";

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

export function createConsoleTransport(
  options: ConsoleTransportOptions = {}
): LogTransport {
  const formatter = options.formatter ?? createPrettyFormatter();
  const target = options.console ?? console;

  return {
    write(record) {
      const output = formatter.format(record);
      const writer =
        output.stream === "stderr"
          ? target.error.bind(target)
          : target.log.bind(target);

      writer(output.message);
    }
  };
}

export function createBrowserConsoleTransport(
  options: BrowserConsoleTransportOptions = {}
): LogTransport {
  const formatter = options.formatter ?? createBrowserFormatter();
  const target = options.console ?? console;

  return {
    write(record) {
      const output = formatter.format(record);
      const writer =
        output.stream === "stderr"
          ? target.error.bind(target)
          : target.log.bind(target);

      writer(output.message);
    }
  };
}

export function createBufferedTransport(
  options: BufferedTransportOptions
): LogTransport {
  const maxBufferSize = options.maxBufferSize ?? DEFAULT_BUFFER_SIZE;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const buffer: LogRecord[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();

  const scheduleFlush = (): void => {
    if (flushIntervalMs <= 0 || timer) {
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;
      void flushBuffer();
    }, flushIntervalMs);
  };

  const flushBuffer = (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    if (buffer.length === 0) {
      return queue;
    }

    const records = buffer.splice(0, buffer.length);
    queue = queue.then(() => Promise.resolve(options.sink(records)));
    return queue;
  };

  return {
    write(record) {
      buffer.push(record);

      if (buffer.length >= maxBufferSize) {
        return flushBuffer();
      }

      scheduleFlush();
    },
    flush() {
      const result = flushBuffer();
      return isPromiseLike(result) ? result : Promise.resolve();
    }
  };
}
