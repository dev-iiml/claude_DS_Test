/**
 * Rewrites the inventory table in docs/DATA_CLASSIFICATION.md from
 * `src/modules/privacy/data-inventory.ts` (between the inventory markers).
 * Run: npx tsx scripts/render-data-inventory.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

import { renderDataInventory } from "../src/modules/privacy/data-inventory";

const path = "docs/DATA_CLASSIFICATION.md";
const START = "<!-- inventory:start -->";
const END = "<!-- inventory:end -->";
const doc = readFileSync(path, "utf8");
const from = doc.indexOf(START);
const to = doc.indexOf(END);
if (from < 0 || to < from) throw new Error(`${path} needs ${START} … ${END}`);
writeFileSync(path, `${doc.slice(0, from + START.length)}\n\n${renderDataInventory()}\n\n${doc.slice(to)}`);
console.log(`✓ ${path} updated`);
