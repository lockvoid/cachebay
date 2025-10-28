import { defineConfig } from "tsdown";

export default defineConfig({
  outDir: "dist",
  dts: true,
  sourcemap: true,

  entry: [
    "src/core/index.ts",
    "src/compiler/index.ts",
    "src/adapters/vue/index.ts",
  ],

  format: [
    "esm",
  ],

  external: (id, importer) => {
    if (importer?.includes("adapters/vue")) {
      if (id.startsWith("../../core")) {
        return true;
      }
    }

    if (importer?.includes("core")) {

      if (id.startsWith("../compiler")) {
        console.log(id);

        return true;
      }
    }

    return ["vue", "graphql", "graphql-tag"].includes(id);
  },
});
