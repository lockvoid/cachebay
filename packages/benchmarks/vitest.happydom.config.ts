import relay from "vite-plugin-relay";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  mode: mode || "production",

  globals: true,

  plugins: [
    relay,
  ],

  esbuild: {
    minify: true,
    treeShaking: true,
  },

  build: {
    minify: "esbuild",
    target: "esnext",
  },

  define: {
    "process.env.NODE_ENV": '"production"',
    "__DEV__": false,
  },

  resolve: {
    conditions: ["production", "default"],
  },

  test: {
    environment: "happy-dom",
    globals: true,

    include: [
      "bench/api/**/*.vitest.bench.ts",
    ],

    benchmark: {
      warmupTime: 150,
      concurrent: false,
    },

    reporters: process.env.DEBUG === "true" ? ["verbose"] : ["default"],
  },
}));
