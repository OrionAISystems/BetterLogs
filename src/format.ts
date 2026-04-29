import pc from "picocolors";

import {
  CORRELATION_ID_LABEL,
  DEFAULT_JSON_FLATTEN_DELIMITER,
  DEFAULT_JSON_FLATTEN_MAX_DEPTH,
  DEFAULT_OPTIONS,
  LEVEL_LABEL_WIDTH,
  REQUEST_ID_LABEL
} from "./constants";
import type {
  BrowserFormatterOptions,
  FormattedLogOutput,
  JsonFieldFlattenOptions,
  JsonFormatterOptions,
  LogFormatter,
  LogLevel,
  LogRecord,
  PrettyFormatterOptions,
  SerializedError
} from "./types";

const levelColorizers: Record<LogLevel, (value: string) => string> = {
  trace: pc.dim,
  debug: pc.gray,
  info: pc.cyan,
  success: pc.green,
  warn: pc.yellow,
  error: pc.red,
  fatal: (value) => pc.bgRed(pc.white(pc.bold(value)))
};

type PrettyFormattingConfig = Required<PrettyFormatterOptions>;
type BrowserFormattingConfig = Required<BrowserFormatterOptions>;
type JsonFormattingConfig = Required<Omit<JsonFormatterOptions, "flatten">> & {
  flatten: {
    enabled: boolean;
    delimiter: string;
    maxDepth: number;
    include: readonly ("context" | "meta" | "error")[];
    flattenArrays: boolean;
  };
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function createInspectOptions(config: PrettyFormattingConfig) {
  return {
    depth: null,
    compact: !config.prettyPrintObjects,
    breakLength: config.prettyPrintObjects ? 100 : Number.POSITIVE_INFINITY
  };
}

function stringifyForHumans(value: unknown, space: number): string | undefined {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    value,
    (_key, entry) => {
      if (typeof entry === "bigint") {
        return entry.toString();
      }

      if (typeof entry === "symbol") {
        return String(entry);
      }

      if (typeof entry === "function") {
        return `[Function ${entry.name || "anonymous"}]`;
      }

      if (entry instanceof Error) {
        return {
          name: entry.name,
          message: entry.message,
          stack: entry.stack
        };
      }

      if (typeof entry === "object" && entry !== null) {
        if (seen.has(entry)) {
          return "[Circular]";
        }

        seen.add(entry);
      }

      return entry;
    },
    space
  );
}

function formatStructuredValue(
  value: unknown,
  options: ReturnType<typeof createInspectOptions>
): string {
  const space = options.compact ? 0 : 2;
  const serialized = stringifyForHumans(value, space);

  if (serialized !== undefined) {
    return serialized;
  }

  return String(value);
}

function resolvePrettyConfig(
  options: PrettyFormatterOptions = {}
): PrettyFormattingConfig {
  return {
    timestamps: options.timestamps ?? DEFAULT_OPTIONS.timestamps,
    colors: options.colors ?? DEFAULT_OPTIONS.colors,
    prettyPrintObjects:
      options.prettyPrintObjects ?? DEFAULT_OPTIONS.prettyPrintObjects
  };
}

function resolveBrowserConfig(
  options: BrowserFormatterOptions = {}
): BrowserFormattingConfig {
  return {
    timestamps: options.timestamps ?? DEFAULT_OPTIONS.timestamps,
    prettyPrintObjects:
      options.prettyPrintObjects ?? DEFAULT_OPTIONS.prettyPrintObjects
  };
}

function resolveFlattenConfig(
  flatten: JsonFormatterOptions["flatten"]
): JsonFormattingConfig["flatten"] {
  if (flatten === undefined || flatten === false) {
    return {
      enabled: false,
      delimiter: DEFAULT_JSON_FLATTEN_DELIMITER,
      maxDepth: DEFAULT_JSON_FLATTEN_MAX_DEPTH,
      include: ["context", "meta", "error"],
      flattenArrays: false
    };
  }

  if (flatten === true) {
    return {
      enabled: true,
      delimiter: DEFAULT_JSON_FLATTEN_DELIMITER,
      maxDepth: DEFAULT_JSON_FLATTEN_MAX_DEPTH,
      include: ["context", "meta", "error"],
      flattenArrays: false
    };
  }

  return {
    enabled: flatten.enabled ?? true,
    delimiter: flatten.delimiter ?? DEFAULT_JSON_FLATTEN_DELIMITER,
    maxDepth: flatten.maxDepth ?? DEFAULT_JSON_FLATTEN_MAX_DEPTH,
    include: Array.isArray(flatten.include)
      ? flatten.include
      : flatten.include
        ? [flatten.include]
        : ["context", "meta", "error"],
    flattenArrays: flatten.flattenArrays ?? false
  };
}

function resolveJsonConfig(
  options: JsonFormatterOptions = {}
): JsonFormattingConfig {
  return {
    timestamps: options.timestamps ?? DEFAULT_OPTIONS.timestamps,
    prettyPrintObjects:
      options.prettyPrintObjects ?? DEFAULT_OPTIONS.prettyPrintObjects,
    flatten: resolveFlattenConfig(options.flatten)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenInto(
  result: Record<string, unknown>,
  prefix: string,
  value: unknown,
  config: JsonFormattingConfig["flatten"],
  depth: number
): void {
  if (depth >= config.maxDepth || value === null || typeof value !== "object") {
    result[prefix] = value;
    return;
  }

  if (Array.isArray(value) && !config.flattenArrays) {
    result[prefix] = value;
    return;
  }

  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry] as const)
    : Object.entries(value);

  if (entries.length === 0) {
    result[prefix] = value;
    return;
  }

  for (const [key, entry] of entries) {
    const nextPrefix = `${prefix}${config.delimiter}${key}`;
    flattenInto(result, nextPrefix, entry, config, depth + 1);
  }
}

function flattenJsonPayload(
  payload: Record<string, unknown>,
  config: JsonFormattingConfig["flatten"]
): Record<string, unknown> {
  if (!config.enabled) {
    return payload;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (config.include.includes(key as "context" | "meta" | "error") && isRecord(value)) {
      flattenInto(result, key, value, config, 0);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function getDetailsPayload(record: LogRecord): unknown {
  const hasContext = Object.keys(record.context).length > 0;

  if (!record.error && !hasContext) {
    return record.meta;
  }

  if (record.error && !hasContext) {
    return record.error;
  }

  const payload: Record<string, unknown> = {};

  if (hasContext) {
    payload.context = record.context;
  }

  if (record.meta !== undefined) {
    payload.meta = record.meta;
  }

  if (record.error) {
    payload.error = record.error;
  }

  return payload;
}

function formatPrettyValue(value: unknown, config: PrettyFormattingConfig): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }

  return formatStructuredValue(value, createInspectOptions(config));
}

function formatBrowserValue(
  value: unknown,
  config: BrowserFormattingConfig
): string {
  if (value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }

  return JSON.stringify(
    value,
    null,
    config.prettyPrintObjects ? 2 : 0
  );
}

function formatSerializedError(error: SerializedError): string {
  const { name, message, stack, ...rest } = error;
  const lines = [`${name}: ${message}`];

  if (Object.keys(rest).length > 0) {
    lines.push(JSON.stringify(rest, null, 2));
  }

  if (stack) {
    const stackLines = stack.split("\n").slice(1);
    if (stackLines.length > 0) {
      lines.push(stackLines.join("\n"));
    }
  }

  return lines.join("\n");
}

function formatLevelLabel(level: LogLevel, colors: boolean): string {
  const label = level.toUpperCase().padEnd(LEVEL_LABEL_WIDTH, " ");
  return colors ? levelColorizers[level](label) : label;
}

function formatScope(scope: string | undefined, colors: boolean): string | undefined {
  if (!scope) {
    return undefined;
  }

  const formattedScope = `[${scope}]`;
  return colors ? pc.dim(formattedScope) : formattedScope;
}

function formatTag(
  label: string,
  value: string | undefined,
  colors: boolean
): string | undefined {
  if (!value) {
    return undefined;
  }

  const tag = `[${label}:${value}]`;
  return colors ? pc.dim(tag) : tag;
}

function getStream(level: LogLevel): "stdout" | "stderr" {
  return level === "error" || level === "fatal" ? "stderr" : "stdout";
}

export function formatTimestamp(date: Date = new Date()): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") +
    " " +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(":");
}

export function createPrettyFormatter(
  options: PrettyFormatterOptions = {}
): LogFormatter {
  const config = resolvePrettyConfig(options);

  return {
    format(record: LogRecord): FormattedLogOutput {
      const primaryLine = [
        config.timestamps ? formatTimestamp(record.timestamp) : undefined,
        formatLevelLabel(record.level, config.colors),
        formatScope(record.scope, config.colors),
        formatTag(REQUEST_ID_LABEL, record.requestId, config.colors),
        formatTag(CORRELATION_ID_LABEL, record.correlationId, config.colors),
        record.message
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ");

      const detailsPayload = getDetailsPayload(record);
      const details =
        detailsPayload === undefined
          ? undefined
          : record.error && detailsPayload === record.error
            ? formatSerializedError(record.error)
            : formatPrettyValue(detailsPayload, config);

      return {
        message: details ? `${primaryLine}\n${details}` : primaryLine,
        stream: getStream(record.level)
      };
    }
  };
}

export function createJsonFormatter(
  options: JsonFormatterOptions = {}
): LogFormatter {
  const config = resolveJsonConfig(options);

  return {
    format(record: LogRecord): FormattedLogOutput {
      const payload = flattenJsonPayload(
        {
          ...(config.timestamps ? { timestamp: record.timestamp.toISOString() } : {}),
          level: record.level,
          ...(record.scope ? { scope: record.scope } : {}),
          ...(record.requestId ? { requestId: record.requestId } : {}),
          ...(record.correlationId
            ? { correlationId: record.correlationId }
            : {}),
          message: record.message,
          ...(Object.keys(record.context).length > 0
            ? { context: record.context }
            : {}),
          ...(record.meta !== undefined ? { meta: record.meta } : {}),
          ...(record.error ? { error: record.error } : {})
        },
        config.flatten
      );

      return {
        message: JSON.stringify(
          payload,
          null,
          config.prettyPrintObjects ? 2 : 0
        ),
        stream: getStream(record.level)
      };
    }
  };
}

export function createBrowserFormatter(
  options: BrowserFormatterOptions = {}
): LogFormatter {
  const config = resolveBrowserConfig(options);

  return {
    format(record: LogRecord): FormattedLogOutput {
      const primaryLine = [
        config.timestamps ? formatTimestamp(record.timestamp) : undefined,
        record.level.toUpperCase().padEnd(LEVEL_LABEL_WIDTH, " "),
        record.scope ? `[${record.scope}]` : undefined,
        record.requestId ? `[${REQUEST_ID_LABEL}:${record.requestId}]` : undefined,
        record.correlationId
          ? `[${CORRELATION_ID_LABEL}:${record.correlationId}]`
          : undefined,
        record.message
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ");

      const detailsPayload = getDetailsPayload(record);
      const details =
        detailsPayload === undefined
          ? undefined
          : record.error && detailsPayload === record.error
            ? formatSerializedError(record.error)
            : formatBrowserValue(detailsPayload, config);

      return {
        message: details ? `${primaryLine}\n${details}` : primaryLine,
        stream: getStream(record.level)
      };
    }
  };
}
