import type { LogLevel } from "./types";

export const LEVEL_PRIORITIES = {
  trace: 10,
  debug: 20,
  info: 30,
  success: 35,
  warn: 40,
  error: 50,
  fatal: 60
} as const satisfies Record<LogLevel, number>;

export function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LEVEL_PRIORITIES[level] >= LEVEL_PRIORITIES[minLevel];
}
