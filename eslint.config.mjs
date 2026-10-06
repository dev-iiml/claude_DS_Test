import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Architecture boundaries are enforced here, not just documented:
 * - domain modules never import UI or route code;
 * - UI components never touch the database directly;
 * - provider adapters never depend on domain modules or the database.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["@/app/*", "@/components/*"], message: "Domain modules must not depend on UI/routes." }],
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/db", "@/db/*"], message: "UI components must not access the database." },
            { group: ["@/modules/*/*-service"], message: "UI components must not call domain services." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/providers/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/modules/*", "@/db", "@/db/*"], message: "Providers are leaf adapters." }] },
      ],
    },
  },
  {
    files: ["src/db/scripts/**/*.ts", "scripts/**/*.{ts,mjs}", "tests/**/*.ts", "e2e/**/*.ts"],
    rules: { "no-console": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
    // Design-system docs and the dev-only preview viewer (built by design-system/viewer/build.mjs).
    "design-system/**",
  ]),
]);

export default eslintConfig;
