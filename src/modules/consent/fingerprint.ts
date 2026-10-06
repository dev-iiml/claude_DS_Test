import { createHash } from "node:crypto";

/**
 * SHA-256 over a consent definition's exact text. Shown on receipts so a
 * creator (or auditor) can confirm which wording they agreed to.
 */
export function definitionFingerprint(def: {
  key: string;
  version: number;
  title: string;
  purpose: string;
  body: string;
}) {
  return createHash("sha256")
    .update([def.key, def.version, def.title, def.purpose, def.body].join("\u001f"))
    .digest("hex");
}
