import { createHash } from "node:crypto";

import { ENGINE_VERSION, type EngineInput } from "./engine";

/** Canonical JSON (sorted keys) so the hash is independent of property order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 over the engine version and canonicalised inputs. */
export function hashInputs(input: EngineInput): string {
  const normalised: EngineInput = {
    ...input,
    declaredPlatforms: [...input.declaredPlatforms].sort(),
    accounts: [...input.accounts]
      .sort((a, b) => a.platform.localeCompare(b.platform) || a.handle.localeCompare(b.handle))
      .map((a) => ({ ...a, snapshots: [...a.snapshots].sort((x, y) => x.capturedAt.localeCompare(y.capturedAt)) })),
  };
  return createHash("sha256")
    .update(`${ENGINE_VERSION}|${canonical(normalised)}`)
    .digest("hex");
}
