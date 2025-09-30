import lockvoidConfig from "@lockvoid/eslint-config";

export default [
  {
    ignores: [
      "**/.nuxt/**",
    ],
  },

  ...lockvoidConfig,
];
