import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { strongStagingPassword } from "@/db/scripts/_env";
import { installConsoleRedaction } from "@/lib/log-redaction";
import { logger } from "@/lib/logger";

describe("deployment guards (Stage 17)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("staging demo accounts need a strong, non-default password", () => {
    expect(strongStagingPassword("CreatorCo-demo-2026")).toBe(false);
    expect(strongStagingPassword("short-but-random")).toBe(false);
    expect(strongStagingPassword("x7Kq-staging-9vLm-2PzT-w")).toBe(true);
  });

  it("log lines carry Cloud Logging severity and message, which context can't override — even with console redaction on", () => {
    installConsoleRedaction(); // as in production (src/instrumentation.ts)
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.error("demo.failed", {
      severity: "INFO",
      message: "spoof",
      error: 'Failed query: invalid input syntax for type uuid: "kabir@example.com"',
    });
    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, string>;
    expect(line).toMatchObject({ level: "error", event: "demo.failed", severity: "ERROR", message: "demo.failed" });
    expect(line.error).toBe('Failed query: invalid input syntax for type uuid: "[redacted]"');
  });

  it("the image never contains env files and runs as a non-root user", () => {
    const ignore = readFileSync(".dockerignore", "utf8");
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
    expect(dockerfile).toContain('"--env-file-if-exists=/secrets/app.env"');
  });
});
