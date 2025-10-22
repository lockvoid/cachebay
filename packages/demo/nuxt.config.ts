import { createResolver } from "@nuxt/kit";
import tailwindcss from "@tailwindcss/vite";

const { resolve } = createResolver(import.meta.url);

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",

  devtools: {
    enabled: false,
  },

  css: [
    "~/assets/css/tailwind.css",
  ],

  modules: [
    "@pinia/nuxt",
  ],

  alias: {
    "cachebay": resolve("../cachebay/src"),
  },

  imports: {
    // ISSUE: https://github.com/nuxt/nuxt/issues/32738

    dirs: [
      createResolver(import.meta.url).resolve("./types/**"),
    ],
  },

  app: {
    head: {
      title: "Harry Potter's Spellbook",

      link: [
        { rel: "icon", type: "image/svg+xml", href: "/icon.svg" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],

      meta: [
        { name: "theme-color", content: "#000000" },
      ],
    },
  },


  build: {
    transpile: [
      "cachebay",
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

    plugins: [
      tailwindcss(),
    ],

    ssr: {
      noExternal: [
        "cachebay",
      ],
    },

    resolve: {
      alias: {
        "cachebay": resolve("../cachebay/src"),
      },
    },
  },

  runtimeConfig: {
    graphqlServerEndpoint: '',

    public: {
      graphqlClientEndpoint: '',
    },
  },
});
