import type {
  LogLevel,
  LogRecord,
  LogSampler,
  RateLimitSamplerOptions,
  SamplingLevelFilter,
  SamplingPolicyOptions
} from "./types";

function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 1;
  }

  return Math.min(1, Math.max(0, rate));
}

function normalizeLevels(
  levels: SamplingLevelFilter | undefined
): ReadonlySet<LogLevel> | undefined {
  if (!levels) {
    return undefined;
  }

  return new Set(Array.isArray(levels) ? levels : [levels]);
}

function shouldApplyToLevel(
  levels: ReadonlySet<LogLevel> | undefined,
  record: LogRecord
): boolean {
  return !levels || levels.has(record.level);
}

export function createPercentageSampler(
  options: SamplingPolicyOptions
): LogSampler {
  const rate = normalizeRate(options.rate);
  const random = options.random ?? Math.random;
  const levels = normalizeLevels(options.levels);

  return (record) => {
    if (!shouldApplyToLevel(levels, record)) {
      return true;
    }

    if (rate <= 0) {
      return false;
    }

    if (rate >= 1) {
      return true;
    }

    return random() < rate;
  };
}

export function createBurstRateLimitSampler(
  options: RateLimitSamplerOptions
): LogSampler {
  const maxRecords = Math.max(0, Math.floor(options.maxRecords));
  const intervalMs = Math.max(1, Math.floor(options.intervalMs));
  const now = options.now ?? Date.now;
  const levels = normalizeLevels(options.levels);
  let windowStartedAt = now();
  let emittedInWindow = 0;

  return (record) => {
    if (!shouldApplyToLevel(levels, record)) {
      return true;
    }

    if (maxRecords <= 0) {
      return false;
    }

    const currentTime = now();
    if (currentTime - windowStartedAt >= intervalMs) {
      windowStartedAt = currentTime;
      emittedInWindow = 0;
    }

    if (emittedInWindow >= maxRecords) {
      return false;
    }

    emittedInWindow += 1;
    return true;
  };
}

export function createCompositeSampler(
  samplers: readonly LogSampler[]
): LogSampler {
  return (record) => samplers.every((sampler) => sampler(record));
}
