import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  DEFAULT_RETENTION_PRUNE_INTERVAL_MS,
  DEFAULT_ROTATION_FILE_COUNT
} from "./constants";
import { createJsonFormatter } from "./format";
import type { FileRetentionOptions, FileTransportOptions, LogTransport } from "./types";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function archiveFile(path: string, retention: FileRetentionOptions): Promise<void> {
  if (!retention.archiveDirectory) {
    await rm(path, { force: true });
    return;
  }

  await mkdir(retention.archiveDirectory, { recursive: true });
  const archivedName = `${basename(path)}.${Date.now()}.archive`;
  await rename(path, join(retention.archiveDirectory, archivedName));
}

async function rotateFiles(
  filePath: string,
  maxFiles: number,
  retention: FileRetentionOptions | undefined
): Promise<void> {
  const oldest = `${filePath}.${maxFiles}`;

  if (await pathExists(oldest)) {
    if (retention) {
      await archiveFile(oldest, retention);
    } else {
      await rm(oldest, { force: true });
    }
  }

  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const from = `${filePath}.${index}`;
    const to = `${filePath}.${index + 1}`;

    if (await pathExists(from)) {
      await rename(from, to);
    }
  }

  if (await pathExists(filePath)) {
    await rename(filePath, `${filePath}.1`);
  }
}

async function pruneRetention(
  filePath: string,
  retention: FileRetentionOptions
): Promise<void> {
  if (!retention.maxAgeMs || retention.maxAgeMs <= 0) {
    return;
  }

  const directory = dirname(filePath);
  const base = basename(filePath);
  const entries = await readdir(directory).catch(() => [] as string[]);
  const threshold = Date.now() - retention.maxAgeMs;

  for (const entry of entries) {
    if (!entry.startsWith(base)) {
      continue;
    }

    const fullPath = join(directory, entry);
    const metadata = await stat(fullPath).catch(() => undefined);
    if (!metadata || metadata.mtimeMs > threshold) {
      continue;
    }

    await archiveFile(fullPath, retention);
  }
}

export function createFileTransport(
  options: FileTransportOptions
): LogTransport {
  const formatter =
    options.formatter ??
    createJsonFormatter({
      timestamps: true,
      prettyPrintObjects: false
    });
  const ensureDirectory = options.ensureDirectory ?? true;
  const maxFiles = options.rotate?.maxFiles ?? DEFAULT_ROTATION_FILE_COUNT;
  const pruneIntervalMs =
    options.retention?.pruneIntervalMs ?? DEFAULT_RETENTION_PRUNE_INTERVAL_MS;
  let queue = Promise.resolve();
  let lastPrunedAt = 0;

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task, task);
    return queue;
  };

  const maybePruneRetention = async (): Promise<void> => {
    if (!options.retention) {
      return;
    }

    const now = Date.now();
    if (now - lastPrunedAt < pruneIntervalMs) {
      return;
    }

    lastPrunedAt = now;
    await pruneRetention(options.filePath, options.retention);
  };

  return {
    write(record) {
      return enqueue(async () => {
        if (ensureDirectory) {
          await mkdir(dirname(options.filePath), { recursive: true });
          if (options.retention?.archiveDirectory) {
            await mkdir(options.retention.archiveDirectory, { recursive: true });
          }
        }

        await maybePruneRetention();

        const output = formatter.format(record);
        const line = `${output.message}\n`;

        if (options.rotate) {
          const size = await stat(options.filePath).then((result) => result.size).catch(() => 0);
          const nextSize = size + Buffer.byteLength(line);

          if (nextSize > options.rotate.maxBytes) {
            await rotateFiles(options.filePath, Math.max(1, maxFiles), options.retention);
          }
        }

        await appendFile(options.filePath, line, "utf8");
      });
    },
    flush() {
      return queue.then(() => maybePruneRetention());
    }
  };
}
