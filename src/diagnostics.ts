import {
  createTransportDiagnosticsSnapshot,
  formatTransportDiagnosticsAsPrometheus
} from "./health";
import type {
  ExpressLikeDiagnosticsResponse,
  FastifyLikeDiagnosticsReply,
  FetchDiagnosticsResponse,
  KoaLikeDiagnosticsContext,
  LogTransport,
  TransportDiagnosticsEndpointOptions,
  TransportDiagnosticsPayload,
  TransportDiagnosticsSnapshot
} from "./types";

function statusCodeForSnapshot(
  snapshot: TransportDiagnosticsSnapshot,
  mode: TransportDiagnosticsEndpointOptions["statusCode"]
): number {
  if (mode !== "from-health") {
    return 200;
  }

  switch (snapshot.status) {
    case "healthy":
      return 200;
    case "degraded":
      return 200;
    case "unhealthy":
      return 503;
  }
}

export function createTransportDiagnosticsPayload(
  transports: LogTransport | readonly LogTransport[],
  options: TransportDiagnosticsEndpointOptions = {}
): TransportDiagnosticsPayload {
  const snapshot = createTransportDiagnosticsSnapshot(transports, options);
  const format = options.format ?? "json";

  if (format === "prometheus") {
    return {
      statusCode: statusCodeForSnapshot(snapshot, options.statusCode),
      contentType: "text/plain; version=0.0.4; charset=utf-8",
      body: formatTransportDiagnosticsAsPrometheus(snapshot, options.prometheus),
      snapshot
    };
  }

  return {
    statusCode: statusCodeForSnapshot(snapshot, options.statusCode),
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(snapshot, undefined, options.jsonSpace),
    snapshot
  };
}

export function createFetchTransportDiagnosticsHandler(
  transports: LogTransport | readonly LogTransport[],
  options: TransportDiagnosticsEndpointOptions = {}
): () => FetchDiagnosticsResponse {
  return () => {
    const payload = createTransportDiagnosticsPayload(transports, options);

    return {
      status: payload.statusCode,
      headers: {
        "content-type": payload.contentType
      },
      body: payload.body
    };
  };
}

export function createExpressTransportDiagnosticsHandler(
  transports: LogTransport | readonly LogTransport[],
  options: TransportDiagnosticsEndpointOptions = {}
): (_request: unknown, response: ExpressLikeDiagnosticsResponse) => void {
  return (_request, response) => {
    const payload = createTransportDiagnosticsPayload(transports, options);

    response.status(payload.statusCode);
    response.setHeader("content-type", payload.contentType);
    response.end(payload.body);
  };
}

export function createFastifyTransportDiagnosticsHandler(
  transports: LogTransport | readonly LogTransport[],
  options: TransportDiagnosticsEndpointOptions = {}
): (_request: unknown, reply: FastifyLikeDiagnosticsReply) => unknown {
  return (_request, reply) => {
    const payload = createTransportDiagnosticsPayload(transports, options);

    return reply
      .code(payload.statusCode)
      .header("content-type", payload.contentType)
      .send(payload.body);
  };
}

export function createKoaTransportDiagnosticsMiddleware(
  transports: LogTransport | readonly LogTransport[],
  options: TransportDiagnosticsEndpointOptions = {}
): (context: KoaLikeDiagnosticsContext) => void {
  return (context) => {
    const payload = createTransportDiagnosticsPayload(transports, options);

    context.status = payload.statusCode;
    context.type = payload.contentType;
    context.body = payload.body;
  };
}
