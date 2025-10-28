import lockvoidConfig from "@lockvoid/eslint-config";

export default [
  {
    ignores: ["dist/**", "dist"],
  },

  ...lockvoidConfig({ typescript: true, vue: true }),

  {
    files: [
      "test/**",
    ],

    rules: {
      "vue/one-component-per-file": "off",
    },
  },
];
