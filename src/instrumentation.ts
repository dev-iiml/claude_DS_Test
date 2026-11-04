/**
 * Runs once per server instance (Stage 16): redact framework-printed errors so
 * database parameters and row values never reach the logs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installConsoleRedaction } = await import("@/lib/log-redaction");
    installConsoleRedaction();
  }
}
