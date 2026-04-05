import type { LogFormat, LoggerOptions } from "./types";

export const DEFAULT_MIN_LEVEL = "info";
export const DEFAULT_FORMAT: LogFormat = "pretty";
export const LEVEL_LABEL_WIDTH = 7;
export const REQUEST_ID_LABEL = "req";
export const CORRELATION_ID_LABEL = "corr";
export const DEFAULT_BUFFER_SIZE = 50;
export const DEFAULT_FLUSH_INTERVAL_MS = 1_000;
export const DEFAULT_REDACTION_REPLACEMENT = "[REDACTED]";
export const DEFAULT_ROTATION_FILE_COUNT = 5;
export const DEFAULT_RETRY_COUNT = 3;
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;
export const DEFAULT_RETRY_MAX_DELAY_MS = 5_000;
export const DEFAULT_RETRY_FACTOR = 2;
export const DEFAULT_PARTIAL_MASK_CHARACTER = "*";
export const DEFAULT_JSON_FLATTEN_DELIMITER = ".";
export const DEFAULT_JSON_FLATTEN_MAX_DEPTH = 5;
export const DEFAULT_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
export const DEFAULT_CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 10_000;
export const DEFAULT_CIRCUIT_BREAKER_HALF_OPEN_WRITES = 1;
export const DEFAULT_RETENTION_PRUNE_INTERVAL_MS = 60_000;

export const DEFAULT_OPTIONS = {
  minLevel: DEFAULT_MIN_LEVEL,
  timestamps: true,
  colors: true,
  prettyPrintObjects: true,
  showStackTrace: true,
  format: DEFAULT_FORMAT
} as const satisfies Required<
  Pick<
    LoggerOptions,
    | "minLevel"
    | "timestamps"
    | "colors"
    | "prettyPrintObjects"
    | "showStackTrace"
    | "format"
  >
>;
