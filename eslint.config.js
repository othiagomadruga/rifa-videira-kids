import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // public/exemplo/: a apresentação de /exemplo, gerada (o build do site com o roteador de hash e a API
  // simulada; D28). Não se edita à mão: refaz-se pelo roteiro do docs/lancamento.md.
  globalIgnores(["dist/", ".wrangler/", "coverage/", "public/exemplo/"]),
  {
    files: ["**/*.{js,ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ["src/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  // RIFA-095 (D43): o service worker do Web Push, um arquivo estático do site (sem build).
  {
    files: ["public/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },
]);
