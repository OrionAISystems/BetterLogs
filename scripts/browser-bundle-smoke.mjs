import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const browserArtifacts = [
  "dist/browser.js",
  "dist/browser.cjs",
  "dist/browser.js.map",
  "dist/browser.cjs.map"
];

const forbiddenSourceModules = new Set([
  "../src/adapters.ts",
  "../src/cli.ts",
  "../src/context.ts",
  "../src/durable.ts",
  "../src/file.ts",
  "../src/health.ts",
  "../src/inspect.ts",
  "../src/network.ts",
  "../src/otel.ts",
  "../src/retry.ts",
  "../src/testing.ts",
  "../src/index.ts"
]);

const nodeBuiltinSpecifiers = new Set(
  builtinModules.flatMap((moduleName) => {
    const normalized = moduleName.replace(/^node:/, "");
    return [normalized, `node:${normalized}`];
  })
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoNodeBuiltinImports(content, artifact) {
  assert(!content.includes("node:"), `${artifact} contains a node: builtin reference.`);

  for (const specifier of nodeBuiltinSpecifiers) {
    const escaped = escapeRegExp(specifier);
    const patterns = [
      new RegExp(`\\bfrom\\s+["']${escaped}["']`),
      new RegExp(`\\bimport\\s*\\(\\s*["']${escaped}["']\\s*\\)`),
      new RegExp(`\\brequire\\s*\\(\\s*["']${escaped}["']\\s*\\)`)
    ];

    for (const pattern of patterns) {
      assert(!pattern.test(content), `${artifact} imports Node builtin "${specifier}".`);
    }
  }
}

function assertNoForbiddenSources(content, artifact) {
  if (!artifact.endsWith(".map")) {
    return;
  }

  const sourceMap = JSON.parse(content);
  const sources = new Set(sourceMap.sources ?? []);

  for (const source of forbiddenSourceModules) {
    assert(!sources.has(source), `${artifact} includes Node-only source ${source}.`);
  }
}

for (const artifact of browserArtifacts) {
  const content = await readFile(join(root, artifact), "utf8");
  assertNoNodeBuiltinImports(content, artifact);
  assertNoForbiddenSources(content, artifact);
}
