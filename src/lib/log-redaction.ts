/**
 * Log redaction (Stage 16). Database errors echo data: Drizzle's "Failed query"
 * errors carry the bound parameters (in the message and as properties), and
 * Postgres puts row values in some messages and details ("Key (email)=(…)",
 * "invalid input syntax for type uuid: "…""). Anything that reaches a log —
 * our logger or the framework's own console output — goes through here.
 */
/** Everything from a "params:" line to the end: parameter values can span lines. */
const PARAMS_TAIL = /^(\s*params:)[\s\S]*$/m;
/** `Key (email)=(…) already exists` / `… is not present in table` — key expressions may contain parentheses. */
const KEY_VALUE = /(Key \(.*?\)=\().*?(\) (?:already exists|is not present|conflicts with))/g;
const KEY_VALUE_FALLBACK = /(Key \(.*?\)=\()[^\n]*/g;
/** Values Postgres quotes back: `invalid input syntax for type uuid: "…"`, `value "…" is out of range`, `literal: "…"`. */
const QUOTED_AFTER_COLON = /(:\s*)"[^"\n]*"/g;
const QUOTED_VALUE = /(\bvalue\s+)"[^"\n]*"/gi;
const FAILED_ROW = /(Failing row contains \().*$/gm;

export function redactLogText(text: string): string {
  return text
    .replace(PARAMS_TAIL, "$1 [redacted]")
    .replace(KEY_VALUE, "$1[redacted]$2")
    .replace(KEY_VALUE_FALLBACK, (m, head: string) => (m.includes("[redacted]") ? m : `${head}[redacted])`))
    .replace(QUOTED_AFTER_COLON, '$1"[redacted]"')
    .replace(QUOTED_VALUE, '$1"[redacted]"')
    .replace(FAILED_ROW, "$1[redacted])");
}

/** Stack frames only ("    at …" lines): file paths and functions, no data. */
function framesOf(stack: string | undefined): string {
  return (stack ?? "")
    .split("\n")
    .filter((l) => /^\s+at /.test(l))
    .join("\n");
}

/** A failed Drizzle query is reported by its database cause (the query text and parameters are dropped). */
function messageOf(error: Error): string {
  const failedQuery = error.message.startsWith("Failed query") || "params" in error || "query" in error;
  if (failedQuery) {
    return error.cause instanceof Error ? `Failed query: ${error.cause.message}` : "Failed query";
  }
  return error.message;
}

/**
 * A log-safe copy of a console argument: errors are rebuilt with only a
 * redacted name, message and stack (dropping properties such as `params`,
 * `query`, `parameters` and `detail`), keeping `digest` (Next.js) and a
 * redacted `cause`.
 */
export function redactLogArg(arg: unknown, depth = 0): unknown {
  if (typeof arg === "string") return redactLogText(arg);
  if (!(arg instanceof Error)) return arg;
  const message = redactLogText(messageOf(arg));
  const copy = new Error(message);
  copy.name = arg.name;
  const frames = framesOf(arg.stack);
  copy.stack = frames ? `${arg.name}: ${message}\n${frames}` : `${arg.name}: ${message}`;
  const digest = (arg as { digest?: unknown }).digest;
  if (typeof digest === "string") Object.assign(copy, { digest });
  const code = (arg as { code?: unknown }).code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) Object.assign(copy, { code });
  if (arg.cause instanceof Error && depth < 3) copy.cause = redactLogArg(arg.cause, depth + 1);
  return copy;
}

const INSTALLED = Symbol.for("creatorco.consoleRedaction");

/** Wraps console.error/warn so framework-printed errors are redacted too. Idempotent. */
export function installConsoleRedaction(target: Console = console): void {
  const flagged = target as Console & { [INSTALLED]?: boolean };
  if (flagged[INSTALLED]) return;
  for (const level of ["error", "warn"] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) => original(...args.map((a) => redactLogArg(a)));
  }
  flagged[INSTALLED] = true;
}
