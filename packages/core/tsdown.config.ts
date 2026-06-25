import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node18",
  dts: true,
  sourcemap: false,
  clean: true,
  shims: false,
});
