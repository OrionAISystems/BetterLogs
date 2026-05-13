import type {
  CircuitBreakerTransportOptions,
  HealthAwareTransport,
  HealthTrackedTransportOptions,
  LogTransport,
  PrometheusTransportMetricsOptions,
  TransportDiagnosticEntry,
  TransportDiagnosticsLabels,
  TransportDiagnosticsOptions,
  TransportDiagnosticsSnapshot,
  TransportDiagnosticsStatus,
  TransportHealth,
  TransportHealthState
} from "./types";

type MutableTransportHealth = {
  name: string | undefined;
  state: TransportHealthState;
  consecutiveFailures: number;
  totalWrites: number;
  totalSuccesses: number;
  totalFailures: number;
  lastSuccessAt: Date | undefined;
  lastFailureAt: Date | undefined;
  lastErrorMessage: string | undefined;
  openedAt: Date | undefined;
  openUntil: Date | undefined;
};

function cloneHealth(health: MutableTransportHealth): TransportHealth {
  return {
    ...(health.name ? { name: health.name } : {}),
    state: health.state,
    consecutiveFailures: health.consecutiveFailures,
    totalWrites: health.totalWrites,
    totalSuccesses: health.totalSuccesses,
    totalFailures: health.totalFailures,
    ...(health.lastSuccessAt ? { lastSuccessAt: new Date(health.lastSuccessAt) } : {}),
    ...(health.lastFailureAt ? { lastFailureAt: new Date(health.lastFailureAt) } : {}),
    ...(health.lastErrorMessage ? { lastErrorMessage: health.lastErrorMessage } : {}),
    ...(health.openedAt ? { openedAt: new Date(health.openedAt) } : {}),
    ...(health.openUntil ? { openUntil: new Date(health.openUntil) } : {})
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeLabels(
  labels: TransportDiagnosticsLabels | undefined
): TransportDiagnosticsLabels {
  return labels ? { ...labels } : {};
}

function resolveNow(now: TransportDiagnosticsOptions["now"]): Date {
  if (now instanceof Date) {
    return new Date(now);
  }

  if (typeof now === "function") {
    return new Date(now());
  }

  return new Date();
}

function statusForState(state: TransportHealthState): TransportDiagnosticsStatus {
  switch (state) {
    case "healthy":
      return "healthy";
    case "degraded":
    case "half-open":
      return "degraded";
    case "unhealthy":
    case "open":
      return "unhealthy";
  }
}

function isWritableState(state: TransportHealthState): boolean {
  return state !== "open";
}

function ratio(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function dateFields(prefix: string, value: Date | undefined): Record<string, unknown> {
  return value
    ? {
        [prefix]: value.toISOString(),
        [`${prefix}UnixMs`]: value.getTime()
      }
    : {};
}

function quoteLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function normalizeMetricLabelName(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9_]/g, "_");
  const withValidStart = /^[a-zA-Z_]/.test(normalized) ? normalized : `_${normalized}`;

  return withValidStart === "_" ? "label" : withValidStart;
}

function formatLabels(labels: TransportDiagnosticsLabels): string {
  const entries = Object.entries(labels);

  if (entries.length === 0) {
    return "";
  }

  const usedNames = new Map<string, number>();
  const formatted = entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const normalizedKey = normalizeMetricLabelName(key);
      const count = usedNames.get(normalizedKey) ?? 0;
      usedNames.set(normalizedKey, count + 1);
      const uniqueKey = count === 0 ? normalizedKey : `${normalizedKey}_${count + 1}`;

      return `${uniqueKey}="${quoteLabelValue(String(value))}"`;
    })
    .join(",");

  return `{${formatted}}`;
}

function metricName(prefix: string | undefined, suffix: string): string {
  const base = prefix?.trim() ? prefix.trim() : "betterlogs";
  return `${base}_${suffix}`.replace(/[^a-zA-Z0-9_:]/g, "_");
}

function createBaseHealth(name: string | undefined): MutableTransportHealth {
  return {
    name,
    state: "healthy",
    consecutiveFailures: 0,
    totalWrites: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    lastSuccessAt: undefined,
    lastFailureAt: undefined,
    lastErrorMessage: undefined,
    openedAt: undefined,
    openUntil: undefined
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

export function getTransportHealth(transport: LogTransport): TransportHealth | undefined {
  return "getHealth" in transport && typeof transport.getHealth === "function"
    ? transport.getHealth()
    : undefined;
}

export function createTransportDiagnosticsSnapshot(
  transports: LogTransport | readonly LogTransport[],
  options: TransportDiagnosticsOptions = {}
): TransportDiagnosticsSnapshot {
  const now = resolveNow(options.now);
  const labels = normalizeLabels(options.labels);
  const entries = (Array.isArray(transports) ? transports : [transports])
    .map((transport, index): TransportDiagnosticEntry | undefined => {
      const health = getTransportHealth(transport);

      if (!health) {
        return undefined;
      }

      const openRemainingMs =
        health.openUntil && health.openUntil.getTime() > now.getTime()
          ? health.openUntil.getTime() - now.getTime()
          : undefined;
      const totalWrites = health.totalWrites;

      return {
        name: health.name ?? `transport-${index + 1}`,
        state: health.state,
        status: statusForState(health.state),
        writable: isWritableState(health.state),
        consecutiveFailures: health.consecutiveFailures,
        totalWrites,
        totalSuccesses: health.totalSuccesses,
        totalFailures: health.totalFailures,
        successRatio: ratio(health.totalSuccesses, totalWrites),
        failureRatio: ratio(health.totalFailures, totalWrites),
        ...dateFields("lastSuccessAt", health.lastSuccessAt),
        ...dateFields("lastFailureAt", health.lastFailureAt),
        ...(health.lastErrorMessage ? { lastErrorMessage: health.lastErrorMessage } : {}),
        ...dateFields("openedAt", health.openedAt),
        ...dateFields("openUntil", health.openUntil),
        ...(openRemainingMs !== undefined ? { openRemainingMs } : {}),
        labels
      };
    })
    .filter((entry): entry is TransportDiagnosticEntry => entry !== undefined);

  const unhealthyTransportCount = entries.filter(
    (entry) => entry.status === "unhealthy"
  ).length;
  const degradedTransportCount = entries.filter(
    (entry) => entry.status === "degraded"
  ).length;
  const openTransportCount = entries.filter((entry) => entry.state === "open").length;
  const status: TransportDiagnosticsStatus =
    unhealthyTransportCount > 0
      ? "unhealthy"
      : degradedTransportCount > 0
        ? "degraded"
        : "healthy";

  return {
    generatedAt: now.toISOString(),
    generatedAtUnixMs: now.getTime(),
    status,
    totalTransportCount: entries.length,
    degradedTransportCount,
    unhealthyTransportCount,
    openTransportCount,
    totalWrites: entries.reduce((total, entry) => total + entry.totalWrites, 0),
    totalSuccesses: entries.reduce((total, entry) => total + entry.totalSuccesses, 0),
    totalFailures: entries.reduce((total, entry) => total + entry.totalFailures, 0),
    labels,
    transports: entries
  };
}

export function formatTransportDiagnosticsAsPrometheus(
  snapshot: TransportDiagnosticsSnapshot,
  options: PrometheusTransportMetricsOptions = {}
): string {
  const metric = (suffix: string): string => metricName(options.prefix, suffix);
  const lines = [
    `# HELP ${metric("transport_writable")} Whether a transport can currently accept writes.`,
    `# TYPE ${metric("transport_writable")} gauge`,
    `# HELP ${metric("transport_consecutive_failures")} Consecutive transport failures.`,
    `# TYPE ${metric("transport_consecutive_failures")} gauge`,
    `# HELP ${metric("transport_total_writes")} Total transport write attempts.`,
    `# TYPE ${metric("transport_total_writes")} counter`,
    `# HELP ${metric("transport_total_successes")} Total successful transport writes.`,
    `# TYPE ${metric("transport_total_successes")} counter`,
    `# HELP ${metric("transport_total_failures")} Total failed transport writes.`,
    `# TYPE ${metric("transport_total_failures")} counter`,
    `# HELP ${metric("transport_success_ratio")} Successful write ratio for the transport.`,
    `# TYPE ${metric("transport_success_ratio")} gauge`,
    `# HELP ${metric("transport_open_remaining_ms")} Remaining open-circuit time in milliseconds.`,
    `# TYPE ${metric("transport_open_remaining_ms")} gauge`
  ];

  for (const entry of snapshot.transports) {
    const labels = formatLabels({
      ...snapshot.labels,
      ...entry.labels,
      ...normalizeLabels(options.labels),
      transport: entry.name,
      state: entry.state,
      status: entry.status
    });

    lines.push(
      `${metric("transport_writable")}${labels} ${entry.writable ? 1 : 0}`,
      `${metric("transport_consecutive_failures")}${labels} ${entry.consecutiveFailures}`,
      `${metric("transport_total_writes")}${labels} ${entry.totalWrites}`,
      `${metric("transport_total_successes")}${labels} ${entry.totalSuccesses}`,
      `${metric("transport_total_failures")}${labels} ${entry.totalFailures}`,
      `${metric("transport_success_ratio")}${labels} ${entry.successRatio}`,
      `${metric("transport_open_remaining_ms")}${labels} ${entry.openRemainingMs ?? 0}`
    );
  }

  return `${lines.join("\n")}\n`;
}

export function createHealthTrackedTransport(
  options: HealthTrackedTransportOptions
): HealthAwareTransport {
  const degradedAfterFailures = options.degradedAfterFailures ?? 1;
  const unhealthyAfterFailures = options.unhealthyAfterFailures ?? 3;
  const health = createBaseHealth(options.name);

  const updateState = (): void => {
    if (health.consecutiveFailures >= unhealthyAfterFailures) {
      health.state = "unhealthy";
      return;
    }

    if (health.consecutiveFailures >= degradedAfterFailures) {
      health.state = "degraded";
      return;
    }

    health.state = "healthy";
  };

  const onSuccess = (): void => {
    health.totalWrites += 1;
    health.totalSuccesses += 1;
    health.consecutiveFailures = 0;
    health.lastSuccessAt = new Date();
    health.lastErrorMessage = undefined;
    updateState();
  };

  const onFailure = (error: unknown): void => {
    health.totalWrites += 1;
    health.totalFailures += 1;
    health.consecutiveFailures += 1;
    health.lastFailureAt = new Date();
    health.lastErrorMessage = errorMessage(error);
    updateState();
  };

  const run = async (task: () => unknown): Promise<void> => {
    try {
      const result = task();
      if (isPromiseLike(result)) {
        await result;
      }
      onSuccess();
    } catch (error) {
      onFailure(error);
      throw error;
    }
  };

  return {
    write(record) {
      return run(() => options.transport.write(record));
    },
    flush() {
      return run(() => options.transport.flush?.());
    },
    getHealth() {
      return cloneHealth(health);
    }
  };
}

export function createCircuitBreakerTransport(
  options: CircuitBreakerTransportOptions
): HealthAwareTransport {
  const failureThreshold = options.failureThreshold ?? 5;
  const resetTimeoutMs = options.resetTimeoutMs ?? 10_000;
  const halfOpenMaxWrites = options.halfOpenMaxWrites ?? 1;
  const health = createBaseHealth(options.name);
  let halfOpenAttempts = 0;

  const closeCircuit = (): void => {
    health.state = "healthy";
    health.consecutiveFailures = 0;
    health.openedAt = undefined;
    health.openUntil = undefined;
    health.lastErrorMessage = undefined;
    halfOpenAttempts = 0;
  };

  const openCircuit = (error: unknown): void => {
    const now = new Date();
    health.state = "open";
    health.totalFailures += 1;
    health.consecutiveFailures += 1;
    health.lastFailureAt = now;
    health.lastErrorMessage = errorMessage(error);
    health.openedAt = now;
    health.openUntil = new Date(now.getTime() + resetTimeoutMs);
    halfOpenAttempts = 0;
  };

  const noteSuccess = (): void => {
    health.totalWrites += 1;
    health.totalSuccesses += 1;
    health.lastSuccessAt = new Date();
    closeCircuit();
  };

  const noteFailure = (error: unknown): void => {
    health.totalWrites += 1;

    if (health.state === "half-open") {
      openCircuit(error);
      return;
    }

    health.totalFailures += 1;
    health.consecutiveFailures += 1;
    health.lastFailureAt = new Date();
    health.lastErrorMessage = errorMessage(error);

    if (health.consecutiveFailures >= failureThreshold) {
      health.openedAt = health.lastFailureAt;
      health.openUntil = new Date(Date.now() + resetTimeoutMs);
      health.state = "open";
      halfOpenAttempts = 0;
      return;
    }

    health.state = "degraded";
  };

  const ensureWritable = (): void => {
    if (health.state !== "open") {
      if (health.state === "half-open" && halfOpenAttempts >= halfOpenMaxWrites) {
        throw new Error("Circuit breaker half-open write budget exceeded");
      }
      return;
    }

    if (health.openUntil && health.openUntil.getTime() <= Date.now()) {
      health.state = "half-open";
      halfOpenAttempts = 0;
      return;
    }

    throw new Error("Circuit breaker is open");
  };

  const run = async (task: () => unknown, countHalfOpenAttempt: boolean): Promise<void> => {
    ensureWritable();

    if (health.state === "half-open" && countHalfOpenAttempt) {
      halfOpenAttempts += 1;
    }

    try {
      const result = task();
      if (isPromiseLike(result)) {
        await result;
      }
      noteSuccess();
    } catch (error) {
      noteFailure(error);
      throw error;
    }
  };

  return {
    write(record) {
      return run(() => options.transport.write(record), true);
    },
    flush() {
      return run(() => options.transport.flush?.(), false);
    },
    getHealth() {
      return cloneHealth(health);
    }
  };
}
