import type {
  CircuitBreakerTransportOptions,
  HealthAwareTransport,
  HealthTrackedTransportOptions,
  LogTransport,
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
