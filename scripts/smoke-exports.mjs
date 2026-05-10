import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

const browserBundlePath = join(root, "dist", "browser.js");
const browserBundle = await readFile(browserBundlePath, "utf8");

if (browserBundle.includes("node:")) {
  throw new Error("Browser subpath bundle must not contain Node.js builtin imports.");
}

const rootEsm = await import("../dist/index.js");
const browserEsm = await import("../dist/browser.js");
const rootCjs = require("../dist/index.cjs");
const browserCjs = require("../dist/browser.cjs");

for (const [label, moduleExports] of [
  ["root ESM", rootEsm],
  ["browser ESM", browserEsm],
  ["root CJS", rootCjs],
  ["browser CJS", browserCjs]
]) {
  if (typeof moduleExports.createLogger !== "function" && label.startsWith("root")) {
    throw new Error(`${label} did not expose createLogger.`);
  }

  if (
    typeof moduleExports.createBrowserLogger !== "function" &&
    label.startsWith("browser")
  ) {
    throw new Error(`${label} did not expose createBrowserLogger.`);
  }

  if (
    typeof moduleExports.inspectDurableLogPaths !== "function" &&
    label.startsWith("root")
  ) {
    throw new Error(`${label} did not expose inspectDurableLogPaths.`);
  }
}

const browserLogger = browserEsm.createBrowserLogger({
  transports: []
});

browserLogger.info("export smoke check");
await browserLogger.flush();

const { logger: sampledLogger, transport } = rootEsm.createTestLogger({
  sample: [
    rootEsm.createBurstRateLimitSampler({
      maxRecords: 2,
      intervalMs: 60_000
    })
  ]
});

sampledLogger.info("sampled one");
sampledLogger.info("sampled two");
sampledLogger.info("sampled three");
await sampledLogger.flush();

if (transport.records.length !== 2) {
  throw new Error("Burst rate limit sampler did not drop records after the configured limit.");
}

const browserSampler = browserEsm.createPercentageSampler({
  rate: 0,
  levels: "debug"
});

if (!browserSampler({ level: "info" }) || browserSampler({ level: "debug" })) {
  throw new Error("Browser percentage sampler level filtering behaved unexpectedly.");
}
