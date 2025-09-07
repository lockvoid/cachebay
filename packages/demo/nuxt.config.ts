import { createResolver } from "@nuxt/kit";
import tailwindcss from "@tailwindcss/vite";

const { resolve } = createResolver(import.meta.url);

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",

  devtools: {
    enabled: false
  },

  css: [
    "~/assets/css/tailwind.css",
  ],

  modules: [
    "@pinia/nuxt",
  ],

  alias: {
    "villus-cachebay": resolve("../villus-cachebay/src"),
  },

  imports: {
    // ISSUE: https://github.com/nuxt/nuxt/issues/32738

    dirs: [
      createResolver(import.meta.url).resolve("./types/**"),
    ],
  },

  app: {
    head: {
      title: "Villus Cachebay Demo",
    },
  },

  build: {
    transpile: [
      "villus-cachebay",
    ],
  },

  vite: {
    server: {
      allowedHosts: [
        "*",
      ],

      fs: {
        allow: [
          "../",
        ],
      },
    },

    nitro: {
      assetsInclude: ['~/server/db/**'], 
    },

    plugins: [
      tailwindcss(),
    ],

    ssr: {
      noExternal: [
        "villus-cachebay",
      ],
    },

    resolve: {
      alias: {
        "villus-cachebay": resolve("../villus-cachebay/src"),
      },
    },
  },

  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
    
    public: {
      graphqlEndpoint: 'https://lego.hasura.app/v1beta1/relay',
    },
  },
});
