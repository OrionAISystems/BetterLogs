import {
  createExpressLoggingMiddleware,
  createFastifyLoggingHooks,
  createKoaLoggingMiddleware,
  createLogger,
  withFetchRequestLogging
} from "../src";

const httpLog = createLogger({
  scope: "http"
});

export const expressMiddleware = createExpressLoggingMiddleware(httpLog, {
  includeHeaders: ["user-agent"],
  successLevel: "info"
});

export const fastifyHooks = createFastifyLoggingHooks(httpLog, {
  includeHeaders: ["user-agent"],
  successLevel: "info"
});

export const koaMiddleware = createKoaLoggingMiddleware(httpLog, {
  includeHeaders: ["user-agent"],
  successLevel: "info"
});

export async function handleFetchRequest(
  request: {
    method: string;
    url: string;
    headers: {
      get(name: string): string | undefined;
    };
  }
): Promise<{ status: number }> {
  return withFetchRequestLogging(
    httpLog,
    request,
    async (logger) => {
      logger.info("Handling fetch-style request", {
        runtime: "edge"
      });

      return {
        status: 200
      };
    },
    {
      includeHeaders: ["user-agent"],
      successLevel: "info"
    }
  );
}
