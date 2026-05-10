import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface DurableSpoolInspectionOptions {
  readonly limit?: number;
}

export interface InspectableLogRecord {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly timestamp?: string;
  readonly level?: string;
  readonly scope?: string;
  readonly message?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly context?: unknown;
  readonly meta?: unknown;
  readonly error?: unknown;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface DurableSpoolFileInspection {
  readonly filePath: string;
  readonly recordCount: number;
  readonly invalidLineCount: number;
  readonly firstTimestamp?: string;
  readonly lastTimestamp?: string;
  readonly levels: Readonly<Record<string, number>>;
  readonly scopes: Readonly<Record<string, number>>;
  readonly requestIds: readonly string[];
  readonly recentRecords: readonly InspectableLogRecord[];
}

export interface DurableSpoolInspection {
  readonly files: readonly DurableSpoolFileInspection[];
  readonly totalRecordCount: number;
  readonly totalInvalidLineCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function increment(
  counts: Record<string, number>,
  key: string | undefined
): void {
  if (!key) {
    return;
  }

  counts[key] = (counts[key] ?? 0) + 1;
}

function pushRecentRecord(
  records: InspectableLogRecord[],
  record: InspectableLogRecord,
  limit: number
): void {
  if (limit <= 0) {
    return;
  }

  records.push(record);

  if (records.length > limit) {
    records.shift();
  }
}

function toInspectableRecord(
  filePath: string,
  lineNumber: number,
  raw: Record<string, unknown>
): InspectableLogRecord {
  const timestamp = stringField(raw, "timestamp");
  const level = stringField(raw, "level");
  const scope = stringField(raw, "scope");
  const message = stringField(raw, "message");
  const requestId = stringField(raw, "requestId");
  const correlationId = stringField(raw, "correlationId");

  return {
    filePath,
    lineNumber,
    ...(timestamp ? { timestamp } : {}),
    ...(level ? { level } : {}),
    ...(scope ? { scope } : {}),
    ...(message ? { message } : {}),
    ...(requestId ? { requestId } : {}),
    ...(correlationId ? { correlationId } : {}),
    ...(raw.context !== undefined ? { context: raw.context } : {}),
    ...(raw.meta !== undefined ? { meta: raw.meta } : {}),
    ...(raw.error !== undefined ? { error: raw.error } : {}),
    raw
  };
}

async function resolveInspectionFiles(paths: readonly string[]): Promise<readonly string[]> {
  const resolved = new Set<string>();

  for (const path of paths) {
    const metadata = await stat(path);

    if (!metadata.isDirectory()) {
      resolved.add(path);
      continue;
    }

    const entries = await readdir(path);
    for (const entry of entries.sort()) {
      const fullPath = join(path, entry);
      const entryMetadata = await stat(fullPath).catch(() => undefined);

      if (entryMetadata?.isFile()) {
        resolved.add(fullPath);
      }
    }
  }

  return Array.from(resolved);
}

export async function inspectDurableLogFile(
  filePath: string,
  options: DurableSpoolInspectionOptions = {}
): Promise<DurableSpoolFileInspection> {
  const limit = Math.max(0, options.limit ?? 10);
  const content = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (isRecord(error) && error.code === "ENOENT") {
      return "";
    }

    throw error;
  });
  const levels: Record<string, number> = {};
  const scopes: Record<string, number> = {};
  const requestIds = new Set<string>();
  const recentRecords: InspectableLogRecord[] = [];
  let recordCount = 0;
  let invalidLineCount = 0;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let lineNumber = 0;

  for (const line of content.split(/\r?\n/)) {
    lineNumber += 1;

    if (!line.trim()) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      invalidLineCount += 1;
      continue;
    }

    if (!isRecord(parsed)) {
      invalidLineCount += 1;
      continue;
    }

    const record = toInspectableRecord(filePath, lineNumber, parsed);
    recordCount += 1;
    increment(levels, record.level);
    increment(scopes, record.scope);

    if (record.requestId) {
      requestIds.add(record.requestId);
    }

    if (record.timestamp) {
      firstTimestamp = firstTimestamp ?? record.timestamp;
      lastTimestamp = record.timestamp;
    }

    pushRecentRecord(recentRecords, record, limit);
  }

  return {
    filePath,
    recordCount,
    invalidLineCount,
    ...(firstTimestamp ? { firstTimestamp } : {}),
    ...(lastTimestamp ? { lastTimestamp } : {}),
    levels,
    scopes,
    requestIds: Array.from(requestIds).sort(),
    recentRecords
  };
}

export async function inspectDurableLogPaths(
  paths: readonly string[],
  options: DurableSpoolInspectionOptions = {}
): Promise<DurableSpoolInspection> {
  const filePaths = await resolveInspectionFiles(paths);
  const files = await Promise.all(
    filePaths.map((filePath) => inspectDurableLogFile(filePath, options))
  );

  return {
    files,
    totalRecordCount: files.reduce((sum, file) => sum + file.recordCount, 0),
    totalInvalidLineCount: files.reduce(
      (sum, file) => sum + file.invalidLineCount,
      0
    )
  };
}
