import { resolve } from "node:path";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
  ],

  server: {
    allowedHosts: ["*"],

    fs: {
      allow: ["../"],
    },
  },

  resolve: {
    alias: [
      { find: /^cachebay\/svelte$/, replacement: resolve("../cachebay/src/adapters/svelte/index.ts") },
      { find: /^cachebay$/, replacement: resolve("../cachebay/src/core/index.ts") },
    ],
  },

  ssr: {
    noExternal: ["cachebay"],
  },
});
