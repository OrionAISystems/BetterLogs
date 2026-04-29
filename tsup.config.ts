import { defineConfig } from "tsup";
import type { Options } from "tsup";

const shared: Pick<
  Options,
  | "format"
  | "dts"
  | "sourcemap"
  | "splitting"
  | "treeshake"
  | "target"
  | "outDir"
> = {
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  outDir: "dist"
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts"],
    clean: true,
    platform: "node"
  },
  {
    ...shared,
    entry: ["src/browser.ts"],
    clean: false,
    platform: "browser"
  }
]);
