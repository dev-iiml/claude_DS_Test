import path from "node:path";

/**
 * Tailwind scans only `src/` for class names. Without `base`, its automatic
 * source detection also reads `design-system/` (experiments, previews,
 * archived proposals), so design-system work in progress could change the
 * app's generated CSS. Enforced by `npm run ds:check`. (Next, Vitest and the
 * scripts all run from the project root; `new URL(…, import.meta.url)` isn't
 * used because Turbopack treats it as an asset import.)
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": { base: path.join(process.cwd(), "src") },
  },
};

export default config;
