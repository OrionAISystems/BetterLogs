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
}

const browserLogger = browserEsm.createBrowserLogger({
  transports: []
});

browserLogger.info("export smoke check");
await browserLogger.flush();
