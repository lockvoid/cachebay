import { URL, fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import vue from '@vitejs/plugin-vue'
import codspeed from "@codspeed/vitest-plugin";

export default defineConfig({
  plugins: [vue(), codspeed()],

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
