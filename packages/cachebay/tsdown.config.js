import { defineConfig } from "tsdown";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export default defineConfig({
  outDir: "dist",
  dts: true,
  sourcemap: true,

  entry: [
    "src/core/index.ts",
    "src/compiler/index.ts",
    "src/adapters/vue/index.ts",
  ],

  format: ["esm"],

  external: (id, importer) => {
    if (importer?.includes("adapters/vue")) {
      if (id.startsWith("../../core")) {
        return true;
      }
    }

    if (importer?.includes("core")) {
      if (id.startsWith("../compiler")) {
        return true;
      }
    }

    return ["vue", "graphql", "graphql-tag"].includes(id);
  },

  onSuccess: async () => {
    const rewriteImports = (filePath) => {
      const sourcePath = join(process.cwd(), "dist");

      const content = readFileSync(sourcePath, "utf-8").replace(/\/(core|compiler)"/g, '/$1/index.js"').replace(/\/(core|compiler)'/g, "/$1/index.js'");

      writeFileSync(sourcePath, content, "utf-8");
    };

    ["adapters/vue/index.js", "core/index.js"].forEach((filePath) => {
      rewriteImports(filePath);
    });
  },
});
