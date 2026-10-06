import { isSensitiveKey } from "./sensitive-keys";

/**
 * Minimal structured logger. Never pass form payloads, financial data or
 * identifiers like email/GSTIN — log event names and opaque ids only.
 * Known-sensitive keys are redacted defensively.
 */
type Level = "debug" | "info" | "warn" | "error";

function redact(context: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(context).map(([k, v]) => [k, isSensitiveKey(k) ? "[redacted]" : v]));
}

function emit(level: Level, event: string, context: Record<string, unknown> = {}) {
  if (process.env.APP_ENV === "test" && level !== "error") return;
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...redact(context) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  // eslint-disable-next-line no-console -- the logger is the one sanctioned console sink
  else console.log(line);
}

export const logger = {
  debug: (event: string, ctx?: Record<string, unknown>) => emit("debug", event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => emit("info", event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => emit("warn", event, ctx),
  error: (event: string, ctx?: Record<string, unknown>) => emit("error", event, ctx),
};

/** Error summary safe to log: name + message, no stack payloads or causes with data. */
export function describeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 300) };
  return { name: "UnknownError", message: "non-error thrown" };
}
