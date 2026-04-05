import { AsyncLocalStorage } from "node:async_hooks";

import type {
  LoggerBindings,
  LoggerBindingsProvider,
  LogContextStore
} from "./types";

function mergeBindings(
  base: LoggerBindings | undefined,
  next: LoggerBindings | undefined
): LoggerBindings | undefined {
  if (!base && !next) {
    return undefined;
  }

  const context = {
    ...(base?.context ?? {}),
    ...(next?.context ?? {})
  };
  const requestId = next?.requestId ?? base?.requestId;
  const correlationId = next?.correlationId ?? base?.correlationId;

  return {
    context,
    ...(requestId ? { requestId } : {}),
    ...(correlationId ? { correlationId } : {})
  };
}

export function createLogContextStore(): LogContextStore {
  const storage = new AsyncLocalStorage<LoggerBindings>();

  return {
    run<T>(bindings: LoggerBindings, callback: () => T): T {
      const merged = mergeBindings(storage.getStore(), bindings) ?? bindings;
      return storage.run(merged, callback);
    },
    get(): LoggerBindings | undefined {
      return storage.getStore();
    },
    bind<T extends (...args: never[]) => unknown>(bindings: LoggerBindings, callback: T): T {
      const merged = mergeBindings(storage.getStore(), bindings) ?? bindings;
      return ((...args: Parameters<T>) => storage.run(merged, () => callback(...args))) as T;
    },
    enter(bindings: LoggerBindings): void {
      const merged = mergeBindings(storage.getStore(), bindings) ?? bindings;
      storage.enterWith(merged);
    }
  };
}

const defaultLogContextStore = createLogContextStore();

export function getLogContext(): LoggerBindings | undefined {
  return defaultLogContextStore.get();
}

export function runWithLogContext<T>(bindings: LoggerBindings, callback: () => T): T {
  return defaultLogContextStore.run(bindings, callback);
}

export function bindLogContext<T extends (...args: never[]) => unknown>(
  bindings: LoggerBindings,
  callback: T
): T {
  return defaultLogContextStore.bind(bindings, callback);
}

export function enterLogContext(bindings: LoggerBindings): void {
  defaultLogContextStore.enter(bindings);
}

export function createAsyncContextBindingsProvider(
  store: LogContextStore = defaultLogContextStore
): LoggerBindingsProvider {
  return () => store.get();
}
