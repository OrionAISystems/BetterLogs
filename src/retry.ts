import {
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_COUNT,
  DEFAULT_RETRY_FACTOR,
  DEFAULT_RETRY_MAX_DELAY_MS
} from "./constants";
import type { LogRecord, LogTransport, RetryingTransportOptions, RetryPolicyOptions } from "./types";

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function resolveRetryPolicy(policy: RetryPolicyOptions = {}) {
  return {
    retries: policy.retries ?? DEFAULT_RETRY_COUNT,
    baseDelayMs: policy.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs: policy.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
    factor: policy.factor ?? DEFAULT_RETRY_FACTOR,
    jitter: policy.jitter ?? true
  };
}

function calculateDelay(
  attempt: number,
  policy: ReturnType<typeof resolveRetryPolicy>
): number {
  const rawDelay = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * policy.factor ** Math.max(attempt - 1, 0)
  );

  if (!policy.jitter) {
    return rawDelay;
  }

  const jitterRatio = 0.75 + Math.random() * 0.5;
  return Math.round(rawDelay * jitterRatio);
}

export async function executeWithRetry<T>(options: {
  readonly retry?: RetryPolicyOptions;
  readonly task: () => Promise<T>;
  readonly shouldRetry?: (error: unknown, attempt: number) => boolean;
}): Promise<T> {
  const policy = resolveRetryPolicy(options.retry);
  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      return await options.task();
    } catch (error) {
      const shouldRetry = options.shouldRetry?.(error, attempt) ?? true;

      if (!shouldRetry || attempt > policy.retries) {
        throw error;
      }

      await sleep(calculateDelay(attempt, policy));
    }
  }
}

export function createRetryingTransport(
  options: RetryingTransportOptions
): LogTransport {
  const runWithRetry = async (
    task: () => Promise<void>,
    record?: LogRecord
  ): Promise<void> => {
    if (options.retry) {
      await executeWithRetry({
        retry: options.retry,
        shouldRetry: (error, attempt) =>
          options.shouldRetry?.(error, attempt, record) ?? true,
        task
      });
      return;
    }

    await executeWithRetry({
      shouldRetry: (error, attempt) =>
        options.shouldRetry?.(error, attempt, record) ?? true,
      task
    });
  };

  return {
    write(record) {
      return runWithRetry(
        async () => {
          await options.transport.write(record);
        },
        record
      );
    },
    flush() {
      if (!options.transport.flush) {
        return Promise.resolve();
      }

      return runWithRetry(async () => {
        await options.transport.flush?.();
      });
    }
  };
}
