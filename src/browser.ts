import { createBrowserFormatter } from "./format";
import { createLogger } from "./logger";
import { createBrowserConsoleTransport } from "./transports";
import type { BrowserLoggerOptions, Logger } from "./types";

export function createBrowserLogger(
  options: BrowserLoggerOptions = {}
): Logger {
  const formatter =
    options.formatter ??
    createBrowserFormatter({
      ...(options.timestamps !== undefined
        ? { timestamps: options.timestamps }
        : {}),
      ...(options.prettyPrintObjects !== undefined
        ? { prettyPrintObjects: options.prettyPrintObjects }
        : {})
    });

  return createLogger({
    ...options,
    colors: false,
    format: "browser",
    formatter,
    transports:
      options.transports ??
      [
        createBrowserConsoleTransport({
          formatter
        })
      ]
  });
}

export { createBrowserConsoleTransport } from "./transports";
export { createBrowserFormatter } from "./format";
export {
  createBurstRateLimitSampler,
  createCompositeSampler,
  createPercentageSampler
} from "./sampling";
export type {
  BrowserConsoleTransportOptions,
  BrowserFormatterOptions,
  BrowserLoggerOptions,
  Logger,
  LoggerOptions,
  LogRecord,
  LogSampler,
  LogTransport
} from "./types";
