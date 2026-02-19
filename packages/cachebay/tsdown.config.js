import { defineConfig } from "tsdown";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import ts from "typescript";
import { compileModule } from "svelte/compiler";

/**
 * Rolldown plugin that compiles .svelte.ts files using the Svelte compiler.
 * Strips TypeScript with tsc first, then runs compileModule to transform runes.
 */
const svelteModulePlugin = () => ({
  name: "svelte-module",

  transform(code, id) {
    if (!id.endsWith(".svelte.ts")) return null;

    // Strip TypeScript types first (compileModule only accepts JS)
    const stripped = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        verbatimModuleSyntax: true,
      },
    });

    // Compile runes ($state, $effect, etc.) into Svelte runtime calls
    const result = compileModule(stripped.outputText, {
      filename: id,
      generate: "client",
    });

    return { code: result.js.code, map: result.js.map };
  },
});

export default defineConfig({
  outDir: "dist",
  dts: true,
  sourcemap: true,

  entry: [
    "src/core/index.ts",
    "src/compiler/index.ts",
    "src/adapters/vue/index.ts",
    "src/adapters/svelte/index.ts",
    "src/storage/idb.ts",
  ],

  format: ["esm"],

  plugins: [svelteModulePlugin()],

  external: (id, importer) => {
    if (importer?.includes("adapters/vue") || importer?.includes("adapters/svelte")) {
      if (id.startsWith("../../core")) {
        return true;
      }
    }

    if (importer?.includes("core")) {
      if (id.startsWith("../compiler") || id.startsWith("../storage")) {
        return true;
      }
    }

    return ["vue", "svelte", "svelte/internal/client", "graphql", "graphql-tag"].includes(id);
  },

  onSuccess: async () => {
    const rewriteImports = (filePath) => {
      const sourcePath = join(process.cwd(), "dist", filePath);

      const content = readFileSync(sourcePath, "utf-8").replace(/\/(core|compiler)"/g, '/$1/index.mjs"').replace(/\/(core|compiler)'/g, "/$1/index.mjs'").replace(/\/storage\/idb"/g, '/storage/idb.mjs"').replace(/\/storage\/idb'/g, "/storage/idb.mjs'");

      writeFileSync(sourcePath, content, "utf-8");
    };

    ["adapters/vue/index.mjs", "adapters/svelte/index.mjs", "core/index.mjs"].forEach(rewriteImports);
  },
});
