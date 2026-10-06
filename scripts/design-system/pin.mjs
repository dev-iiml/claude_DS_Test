#!/usr/bin/env node
/**
 * `npm run ds:pin -- <version> --authorized-by "<name>" [--reason "…"]`
 *
 * Records an authorized upgrade or rollback in design-system.lock.json, after
 * `ds.mjs adopt|rollback` has put that published release's files in place.
 * Refuses candidates, drafts, "latest", tampered releases and partial adoption.
 */
import fs from "node:fs";
import path from "node:path";

import { buildLock, LOCK_FILE } from "./lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const version = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
try {
  const lock = buildLock(process.cwd(), version, { authorizedBy: flag("--authorized-by"), reason: flag("--reason") });
  fs.writeFileSync(path.join(process.cwd(), LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
  const last = lock.history.at(-1);
  console.log(`✓ ${last.action}: design system v${lock.release} pinned (authorized by ${lock.authorizedBy}).`);
  if (lock.previous) console.log(`  Rollback path: v${lock.previous.release} — see docs/DESIGN_SYSTEM.md.`);
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}
