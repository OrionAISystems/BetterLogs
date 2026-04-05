import {
  createAsyncContextBindingsProvider,
  createDefaultRedactionRules,
  createLogger,
  createPartialKeyRedactionRule,
  runWithLogContext
} from "../src";

const rootLog = createLogger({
  scope: "api",
  minLevel: "trace",
  bindingsProvider: createAsyncContextBindingsProvider(),
  context: {
    service: "betterlogs-example"
  },
  redact: [
    ...createDefaultRedactionRules(),
    createPartialKeyRedactionRule(["email"], {
      keepStart: 2,
      keepEnd: 10
    })
  ]
});

rootLog.info("BetterLogs example starting");

await runWithLogContext(
  {
    requestId: "req_123",
    correlationId: "corr_987",
    context: {
      region: "us-east-1",
      route: "/users"
    }
  },
  async () => {
    const requestLog = rootLog.child("users");

    requestLog.info("User created", {
      email: "user@example.com",
      id: "u_123",
      password: "demo-password-value",
      plan: "pro"
    });

    const invoiceTimer = requestLog.time("Invoice settled", {
      invoiceId: "inv_123"
    });

    invoiceTimer.finish({
      level: "success",
      meta: {
        amount: 129.99,
        currency: "USD"
      }
    });

    requestLog.warn("Using fallback configuration", {
      source: "defaults",
      timeoutMs: 1_000
    });

    try {
      throw new Error("Database connection lost");
    } catch (error) {
      requestLog.error("Unhandled exception", error);
    }
  }
);

rootLog.fatal("Service shutting down", {
  code: "E_SHUTDOWN",
  restartSuggested: true
});

await rootLog.flush();
