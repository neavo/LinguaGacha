import js from "@eslint/js";
import ts_eslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import { defineConfig } from "eslint/config";
import { reactRefresh } from "eslint-plugin-react-refresh";
import react_hooks from "eslint-plugin-react-hooks";

const TYPESCRIPT_FILES = ["**/*.{ts,tsx}"];
const TSX_FILES = ["**/*.tsx"];

const typescript_recommended_configs = ts_eslint.configs["flat/recommended"].map(
  (config) => ({
    ...config,
    files: TYPESCRIPT_FILES,
  }),
);

const react_refresh_vite_config = reactRefresh.configs.vite();

export default defineConfig([
  {
    ignores: ["dist", "node_modules", "eslint.config.js"],
  },
  {
    files: TYPESCRIPT_FILES,
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
  },
  ...typescript_recommended_configs,
  {
    files: TYPESCRIPT_FILES,
    plugins: {
      "react-hooks": react_hooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    ...react_refresh_vite_config,
    files: TSX_FILES,
    rules: {
      ...react_refresh_vite_config.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ["src/renderer/ui/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);
