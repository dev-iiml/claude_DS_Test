#!/usr/bin/env node
/**
 * `npm run ds:check` — fails if the app no longer matches its pinned
 * design-system release. Runs before `dev` and `build` and in `npm run check`.
 * DS_PIN_MODE=candidate (disposable copies validating a candidate) or =warn
 * (local experiments, never for builds) reports without failing.
 */
import { checkPin } from "./lib.mjs";

const mode =
  process.env.DS_PIN_MODE === "candidate" || process.env.DS_PIN_MODE === "warn" ? process.env.DS_PIN_MODE : "enforce";
const { errors, warnings, info, lock } = await checkPin(process.cwd(), { mode });
for (const w of warnings) console.warn(`⚠ ${w}`);
for (const i of info) console.log(`· ${i}`);
if (errors.length) {
  console.error(`✗ Design system: the app must run the pinned release${lock ? ` v${lock.release}` : ""}.`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "  Design changes reach the app only through a published release and an authorized upgrade (docs/DESIGN_SYSTEM.md).",
  );
  process.exit(1);
}
console.log(
  `✓ Design system v${lock.release} (${Object.keys(lock.modules).length} modules, ${Object.keys(lock.files).length} files)${mode === "enforce" ? "" : ` — ${mode} mode`}`,
);
