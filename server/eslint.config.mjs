import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Hardware bridge lazily requires an optional native module so the API
    // server never needs it installed — a dynamic require is intentional here.
    files: ["src/hardware/**/*.ts", "src/agent/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
