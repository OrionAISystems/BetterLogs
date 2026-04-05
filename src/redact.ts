import {
  DEFAULT_PARTIAL_MASK_CHARACTER,
  DEFAULT_REDACTION_REPLACEMENT
} from "./constants";
import type {
  LogRedactionRule,
  MaybeArray,
  RedactionPattern
} from "./types";

export const DEFAULT_REDACTION_KEYS = [
  "password",
  "secret",
  "token",
  "apiKey",
  "authorization",
  "cookie",
  "set-cookie",
  "ssn",
  "creditCard",
  "cardNumber"
] as const;

function normalizeArray<T>(value: MaybeArray<T> | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : ([value] as readonly T[]);
}

function matchesPattern(value: string, pattern: RedactionPattern): boolean {
  return typeof pattern === "string"
    ? value === pattern
    : pattern.test(value);
}

function createPartialRule(
  input: Pick<LogRedactionRule, "keys" | "paths">,
  options: Pick<LogRedactionRule, "keepStart" | "keepEnd" | "maskCharacter"> = {}
): LogRedactionRule {
  return {
    ...input,
    strategy: "partial",
    keepStart: options.keepStart ?? 2,
    keepEnd: options.keepEnd ?? 2,
    maskCharacter: options.maskCharacter ?? DEFAULT_PARTIAL_MASK_CHARACTER
  };
}

function maskValue(value: unknown, rule: LogRedactionRule): unknown {
  const text = typeof value === "string" ? value : String(value);
  const keepStart = rule.keepStart ?? 0;
  const keepEnd = rule.keepEnd ?? 0;
  const maskCharacter = rule.maskCharacter ?? DEFAULT_PARTIAL_MASK_CHARACTER;

  if (text.length <= keepStart + keepEnd) {
    return maskCharacter.repeat(Math.max(text.length, 1));
  }

  const middleLength = Math.max(text.length - keepStart - keepEnd, 1);
  return `${text.slice(0, keepStart)}${maskCharacter.repeat(middleLength)}${text.slice(text.length - keepEnd)}`;
}

export function createKeyRedactionRule(
  keys: MaybeArray<RedactionPattern>,
  replaceWith: unknown = DEFAULT_REDACTION_REPLACEMENT
): LogRedactionRule {
  return {
    keys: normalizeArray(keys),
    replaceWith,
    strategy: "replace"
  };
}

export function createPathRedactionRule(
  paths: MaybeArray<string>,
  replaceWith: unknown = DEFAULT_REDACTION_REPLACEMENT
): LogRedactionRule {
  return {
    paths: normalizeArray(paths),
    replaceWith,
    strategy: "replace"
  };
}

export function createPartialKeyRedactionRule(
  keys: MaybeArray<RedactionPattern>,
  options: Pick<LogRedactionRule, "keepStart" | "keepEnd" | "maskCharacter"> = {}
): LogRedactionRule {
  return createPartialRule({ keys: normalizeArray(keys) }, options);
}

export function createPartialPathRedactionRule(
  paths: MaybeArray<string>,
  options: Pick<LogRedactionRule, "keepStart" | "keepEnd" | "maskCharacter"> = {}
): LogRedactionRule {
  return createPartialRule({ paths: normalizeArray(paths) }, options);
}

export function createDefaultRedactionRules(): readonly LogRedactionRule[] {
  return [createKeyRedactionRule(DEFAULT_REDACTION_KEYS)];
}

export function getRedactionReplacement(
  path: readonly string[],
  value: unknown,
  redactions: readonly LogRedactionRule[]
): { matched: boolean; value: unknown } {
  if (path.length === 0 || redactions.length === 0) {
    return { matched: false, value: undefined };
  }

  const key = path[path.length - 1];
  if (!key) {
    return { matched: false, value: undefined };
  }

  const joinedPath = path.join(".");

  for (const rule of redactions) {
    const pathMatched = normalizeArray(rule.paths).includes(joinedPath);
    const keyMatched = normalizeArray(rule.keys).some((pattern) =>
      matchesPattern(key, pattern)
    );

    if (pathMatched || keyMatched) {
      return {
        matched: true,
        value:
          rule.strategy === "partial"
            ? maskValue(value, rule)
            : rule.replaceWith ?? DEFAULT_REDACTION_REPLACEMENT
      };
    }
  }

  return { matched: false, value: undefined };
}
