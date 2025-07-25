// @ts-check
import globals from "globals";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import eslintConfigPrettier from "eslint-config-prettier";
//import reactCompiler from "eslint-plugin-react-compiler";
//import reactHooks from "eslint-plugin-react-hooks";
//import reactRefresh from "eslint-plugin-react-refresh";
//import pluginQuery from "@tanstack/eslint-plugin-query";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  //...pluginQuery.configs["flat/recommended"],
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.app.json", "./tsconfig.node.json"],
        sourceType: "module",
      },
      globals: globals.browser,
    },
    plugins: {
      //reactCompiler,
      tsPlugin,
      //reactHooks,
      //reactRefresh,
    },
    extends: [eslintConfigPrettier],
  },
  {
    ignores: ["dist/", "build/", "src/core/client/", "src/common/shadcn/"],
  },
);
