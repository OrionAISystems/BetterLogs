#!/usr/bin/env node
import { inspectDurableLogPaths } from "./inspect";
import type {
  DurableSpoolFileInspection,
  DurableSpoolInspection,
  InspectableLogRecord
} from "./inspect";

interface ParsedArgs {
  readonly command: string | undefined;
  readonly paths: readonly string[];
  readonly json: boolean;
  readonly limit: number;
  readonly help: boolean;
}

function printHelp(): void {
  console.log(`BetterLogs CLI

Usage:
  betterlogs inspect <spool-or-archive-path...> [--limit <count>] [--json]

Commands:
  inspect   Summarize durable spool, rotated log, or archive JSONL files.

Options:
  --limit, -n   Number of recent records to include per file. Defaults to 10.
  --json        Print machine-readable JSON.
  --help, -h    Show this help message.`);
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Limit must be a non-negative integer.");
  }

  return parsed;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: string | undefined;
  const paths: string[] = [];
  let json = false;
  let limit = 10;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--limit" || arg === "-n") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`${arg} requires a numeric value.`);
      }

      limit = parseLimit(next);
      index += 1;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }

    if (!command) {
      command = arg;
      continue;
    }

    paths.push(arg);
  }

  return {
    command,
    paths,
    json,
    limit,
    help
  };
}

function formatCounts(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts);

  if (entries.length === 0) {
    return "none";
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}

function formatRecord(record: InspectableLogRecord): string {
  const tags = [
    record.scope ? `[${record.scope}]` : undefined,
    record.requestId ? `[req:${record.requestId}]` : undefined,
    record.correlationId ? `[corr:${record.correlationId}]` : undefined
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const prefix = [
    record.timestamp ?? "unknown-time",
    (record.level ?? "unknown").toUpperCase(),
    tags
  ]
    .filter((value) => value.length > 0)
    .join(" ");

  return `  - ${prefix} ${record.message ?? "(no message)"} (line ${record.lineNumber})`;
}

function formatFileInspection(file: DurableSpoolFileInspection): string {
  const lines = [
    `File: ${file.filePath}`,
    `Records: ${file.recordCount}`,
    `Invalid lines: ${file.invalidLineCount}`,
    `Window: ${file.firstTimestamp ?? "n/a"} -> ${file.lastTimestamp ?? "n/a"}`,
    `Levels: ${formatCounts(file.levels)}`,
    `Scopes: ${formatCounts(file.scopes)}`,
    `Request IDs: ${file.requestIds.length > 0 ? file.requestIds.join(", ") : "none"}`
  ];

  if (file.recentRecords.length > 0) {
    lines.push("Recent records:");
    lines.push(...file.recentRecords.map((record) => formatRecord(record)));
  }

  return lines.join("\n");
}

function formatInspection(inspection: DurableSpoolInspection): string {
  const lines = [
    "BetterLogs inspection",
    `Files: ${inspection.files.length}`,
    `Total records: ${inspection.totalRecordCount}`,
    `Total invalid lines: ${inspection.totalInvalidLineCount}`
  ];

  for (const file of inspection.files) {
    lines.push("");
    lines.push(formatFileInspection(file));
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printHelp();
    return;
  }

  if (args.command !== "inspect") {
    throw new Error(`Unknown command "${args.command}".`);
  }

  if (args.paths.length === 0) {
    throw new Error("inspect requires at least one spool or archive path.");
  }

  const inspection = await inspectDurableLogPaths(args.paths, {
    limit: args.limit
  });

  console.log(args.json ? JSON.stringify(inspection, null, 2) : formatInspection(inspection));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`betterlogs: ${message}`);
  process.exitCode = 1;
});
