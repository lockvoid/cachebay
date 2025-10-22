import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/adapters/vue/index.ts"
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  outDir: "dist",
});
