import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node18",
  dts: true,
  alias: {
    "@clawling/clawchat-plugin-install-core": resolve(here, "../core/src/index.ts"),
  },
  deps: {
    // Bundle everything (core + cac) so the published CLI has ZERO runtime
    // dependencies. `npx` then fetches a single tarball instead of resolving
    // and downloading cac too — a meaningful cut to cold-start install time.
    alwaysBundle: [
      "@clawling/clawchat-plugin-install-core",
      "cac",
    ],
  },
  sourcemap: false,
  clean: true,
  shims: false,
});
