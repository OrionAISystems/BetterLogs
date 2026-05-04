import { enterLogContext, runWithLogContext } from "./context";
import type {
  ExpressLikeNext,
  ExpressLikeRequest,
  ExpressLikeResponse,
  FastifyLikeReply,
  FastifyLikeRequest,
  FastifyLoggingHooks,
  FetchLikeRequest,
  FetchLikeResponse,
  HeaderCarrier,
  HttpLoggingAdapterOptions,
  KoaLikeContext,
  KoaLikeNext,
  Logger,
  LoggerBindings,
  LogLevel,
  LogTimer,
  RequestLoggerBindingOptions
} from "./types";

function getHeader(
  headers: HeaderCarrier | Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  if (typeof headers.get === "function") {
    const value = headers.get(name);
    return value ?? undefined;
  }

  const headerRecord = headers as Record<string, string | string[] | undefined>;

  for (const [key, value] of Object.entries(headerRecord)) {
    if (key.toLowerCase() !== name.toLowerCase()) {
      continue;
    }

    return Array.isArray(value) ? value.join(",") : value;
  }

  return undefined;
}

function pickHeaders(
  headers: HeaderCarrier | Record<string, string | string[] | undefined>,
  includeHeaders: readonly string[]
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};

  for (const headerName of includeHeaders) {
    const value = getHeader(headers, headerName);
    if (value !== undefined) {
      result[headerName] = value;
    }
  }

  return result;
}

function normalizeIncludedHeaders(value: RequestLoggerBindingOptions["includeHeaders"]): readonly string[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : ([value as string] as readonly string[]);
}

function resolveBindings(
  request: {
    readonly method: string;
    readonly url?: string;
    readonly originalUrl?: string;
    readonly headers: HeaderCarrier | Record<string, string | string[] | undefined>;
    readonly id?: string;
  },
  options: RequestLoggerBindingOptions = {}
): LoggerBindings {
  const requestId =
    getHeader(request.headers, options.requestIdHeader ?? "x-request-id") ??
    request.id;
  const correlationId = getHeader(
    request.headers,
    options.correlationIdHeader ?? "x-correlation-id"
  );
  const includeHeaders = normalizeIncludedHeaders(options.includeHeaders);
  const context: Record<string, unknown> = {
    method: request.method,
    url: request.originalUrl ?? request.url
  };

  if (includeHeaders.length > 0) {
    context.headers = pickHeaders(request.headers, includeHeaders);
  }

  return {
    context,
    ...(requestId ? { requestId } : {}),
    ...(correlationId ? { correlationId } : {})
  };
}

function levelForStatus(statusCode: number, fallback: LogLevel = "info"): LogLevel {
  if (statusCode >= 500) {
    return "error";
  }

  if (statusCode >= 400) {
    return "warn";
  }

  return fallback;
}

export function createRequestLoggerBindings(
  request: {
    readonly method: string;
    readonly url?: string;
    readonly originalUrl?: string;
    readonly headers: HeaderCarrier | Record<string, string | string[] | undefined>;
    readonly id?: string;
  },
  options: RequestLoggerBindingOptions = {}
): LoggerBindings {
  return resolveBindings(request, options);
}

export function createExpressLoggingMiddleware(
  baseLogger: Logger,
  options: HttpLoggingAdapterOptions = {}
): (req: ExpressLikeRequest, res: ExpressLikeResponse, next: ExpressLikeNext) => void {
  return (req, res, next) => {
    const bindings = resolveBindings(req, options);
    const scopedLogger = options.scope ? baseLogger.child(options.scope) : baseLogger;
    const requestLogger = scopedLogger.withBindings(bindings);
    const label = options.message ?? `${req.method} ${req.originalUrl ?? req.url ?? ""}`.trim();
    const timer = requestLogger.time(label, {
      request: {
        method: req.method,
        url: req.originalUrl ?? req.url
      }
    });

    res.on("finish", () => {
      timer.finish({
        level: levelForStatus(res.statusCode, options.successLevel ?? "info"),
        meta: {
          statusCode: res.statusCode
        }
      });
    });

    runWithLogContext(bindings, () => next());
  };
}

export function createFastifyLoggingHooks(
  baseLogger: Logger,
  options: HttpLoggingAdapterOptions = {}
): FastifyLoggingHooks {
  const timers = new WeakMap<object, LogTimer>();

  return {
    onRequest(request: FastifyLikeRequest) {
      const bindings = resolveBindings(request, options);
      const scopedLogger = options.scope ? baseLogger.child(options.scope) : baseLogger;
      const requestLogger = scopedLogger.withBindings(bindings);
      const label = options.message ?? `${request.method} ${request.url}`;

      timers.set(
        request,
        requestLogger.time(label, {
          request: {
            method: request.method,
            url: request.url
          }
        })
      );

      enterLogContext(bindings);
    },
    onResponse(request: FastifyLikeRequest, reply: FastifyLikeReply) {
      const timer = timers.get(request);
      if (!timer) {
        return;
      }

      timer.finish({
        level: levelForStatus(reply.statusCode, options.successLevel ?? "info"),
        meta: {
          statusCode: reply.statusCode
        }
      });

      timers.delete(request);
    }
  };
}

export function createKoaLoggingMiddleware(
  baseLogger: Logger,
  options: HttpLoggingAdapterOptions = {}
): (context: KoaLikeContext, next: KoaLikeNext) => Promise<void> {
  return async (context, next) => {
    const bindings = resolveBindings(
      {
        method: context.request.method,
        url: context.request.url,
        headers: context.request.headers,
        ...(context.request.id ? { id: context.request.id } : {})
      },
      options
    );
    const scopedLogger = options.scope ? baseLogger.child(options.scope) : baseLogger;
    const requestLogger = scopedLogger.withBindings(bindings);
    const label = options.message ?? `${context.request.method} ${context.request.url}`;
    const timer = requestLogger.time(label);

    await runWithLogContext(bindings, async () => {
      try {
        await next();
        timer.finish({
          level: levelForStatus(context.response.status, options.successLevel ?? "info"),
          meta: {
            statusCode: context.response.status
          }
        });
      } catch (error) {
        timer.fail(error instanceof Error ? error : new Error(String(error)), {
          meta: {
            statusCode: context.response.status || 500
          }
        });
        throw error;
      }
    });
  };
}

export async function withFetchRequestLogging<TResponse extends FetchLikeResponse>(
  baseLogger: Logger,
  request: FetchLikeRequest,
  handler: (logger: Logger) => Promise<TResponse>,
  options: HttpLoggingAdapterOptions = {}
): Promise<TResponse> {
  const bindings = resolveBindings(request, options);
  const scopedLogger = options.scope ? baseLogger.child(options.scope) : baseLogger;
  const requestLogger = scopedLogger.withBindings(bindings);
  const label = options.message ?? `${request.method} ${request.url}`;
  const timer = requestLogger.time(label);

  return runWithLogContext(bindings, async () => {
    try {
      const response = await handler(requestLogger);
      timer.finish({
        level: levelForStatus(response.status, options.successLevel ?? "info"),
        meta: {
          statusCode: response.status
        }
      });
      return response;
    } catch (error) {
      timer.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  });
}
