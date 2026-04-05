import { getRedactionReplacement } from "./redact";
import type {
  LogContext,
  LogRedactionRule,
  LogSerializer,
  SerializedError
} from "./types";

type SerializeOptions = {
  readonly serializers: readonly LogSerializer[];
  readonly showStackTrace: boolean;
  readonly redactions: readonly LogRedactionRule[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getMatchingSerializer(
  value: unknown,
  serializers: readonly LogSerializer[]
): LogSerializer | undefined {
  for (const serializer of serializers) {
    try {
      if (serializer.test(value)) {
        return serializer;
      }
    } catch {
      // Ignore serializer test failures so logging stays resilient.
    }
  }

  return undefined;
}

function serializeEntries(
  value: Record<string, unknown>,
  options: SerializeOptions,
  seen: WeakSet<object>,
  path: readonly string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(value).sort()) {
    const serialized = serializeValue(value[key], options, seen, [...path, key]);
    if (serialized !== undefined) {
      result[key] = serialized;
    }
  }

  return result;
}

export function serializeError(
  error: Error,
  options: SerializeOptions,
  seen: WeakSet<object> = new WeakSet<object>(),
  path: readonly string[] = ["error"]
): SerializedError {
  const ownKeys = Object.getOwnPropertyNames(error).sort();
  const serialized: SerializedError = {
    name: error.name,
    message: error.message,
    ...(options.showStackTrace && error.stack ? { stack: error.stack } : {})
  };

  if ("cause" in error && error.cause !== undefined) {
    const serializedCause = serializeValue(
      error.cause,
      options,
      seen,
      [...path, "cause"]
    );
    if (serializedCause !== undefined) {
      Object.assign(serialized, { cause: serializedCause });
    }
  }

  for (const key of ownKeys) {
    if (["name", "message", "stack", "cause"].includes(key)) {
      continue;
    }

    const serializedValue = serializeValue(
      error[key as keyof Error],
      options,
      seen,
      [...path, key]
    );

    if (serializedValue !== undefined) {
      Object.assign(serialized, { [key]: serializedValue });
    }
  }

  return serialized;
}

export function serializeValue(
  value: unknown,
  options: SerializeOptions,
  seen: WeakSet<object> = new WeakSet<object>(),
  path: readonly string[] = []
): unknown {
  const replacement = getRedactionReplacement(path, value, options.redactions);
  if (replacement.matched) {
    return replacement.value;
  }

  if (value === undefined || value === null) {
    return value;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint" || typeof value === "symbol") {
    return String(value);
  }

  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (value instanceof Error) {
    return serializeError(value, options, seen, path);
  }

  const serializer = getMatchingSerializer(value, options.serializers);
  if (serializer) {
    const nextValue = serializer.serialize(value);
    if (nextValue !== value) {
      return serializeValue(nextValue, options, seen, path);
    }
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Map) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const result: Record<string, unknown> = {};

    for (const [key, entry] of Array.from(value.entries()).sort(([left], [right]) =>
      String(left).localeCompare(String(right))
    )) {
      const serialized = serializeValue(
        entry,
        options,
        seen,
        [...path, String(key)]
      );
      if (serialized !== undefined) {
        result[String(key)] = serialized;
      }
    }

    seen.delete(value);
    return result;
  }

  if (value instanceof Set) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const result = Array.from(value, (entry, index) =>
      serializeValue(entry, options, seen, [...path, String(index)])
    );
    seen.delete(value);
    return result;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    const result = value.map((entry, index) =>
      serializeValue(entry, options, seen, [...path, String(index)])
    );
    seen.delete(value);
    return result;
  }

  if (isRecord(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    if (typeof value.toJSON === "function") {
      const jsonValue = value.toJSON();
      if (jsonValue !== value) {
        seen.delete(value);
        return serializeValue(jsonValue, options, seen, path);
      }
    }

    const result = serializeEntries(value, options, seen, path);
    seen.delete(value);
    return result;
  }

  return String(value);
}

export function serializeContext(
  context: LogContext | undefined,
  options: SerializeOptions
): LogContext {
  if (!context) {
    return {};
  }

  const serialized = serializeValue(context, options, new WeakSet<object>(), ["context"]);

  return isRecord(serialized) ? serialized : { value: serialized };
}

export function serializeMeta(
  meta: unknown,
  options: SerializeOptions
): Pick<{ meta?: unknown; error?: SerializedError }, "meta" | "error"> {
  if (meta === undefined) {
    return {};
  }

  if (meta instanceof Error) {
    return {
      error: serializeError(meta, options, new WeakSet<object>(), ["error"])
    };
  }

  return {
    meta: serializeValue(meta, options, new WeakSet<object>(), ["meta"])
  };
}
