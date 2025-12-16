// @ts-check

import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig([
  {
    ignores: ["node_modules/", "dist/"],
  },
  {
    files: ["**/*.ts", "**/*.js", "**/*.tsx", "**/*.jsx"],
  },
  reactHooks.configs.flat.recommended,
  tseslint.configs.base,
]);
