import { URL, fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],

  test: {
    environment: "happy-dom",

    globals: true,

    coverage: {
      provider: "v8",

      reporter: [
        "text",
        "lcov",
      ],

      include: [
        "src/**/*",
      ],
    },
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
