import { describe, expect, it, vi } from "vitest";

import { installConsoleRedaction, redactLogArg, redactLogText } from "@/lib/log-redaction";
import { describeError } from "@/lib/logger";
import { describeJobError } from "@/modules/jobs/domain";

class FakeQueryError extends Error {
  params = ["kabir@example.com", "ABCDE1234F", 250000];
  query = "insert into users (email) values ($1)";
  constructor(cause: Error) {
    super(`Failed query: insert into users (email) values ($1)\nparams: kabir@example.com,ABCDE1234F,250000`);
    this.cause = cause;
  }
}

const pgError = (message: string, detail?: string) => Object.assign(new Error(message), { code: "23505", detail });

describe("log redaction", () => {
  it("drops query parameters and row values from text", () => {
    const text = [
      "Key (email)=(kabir@example.com) already exists.",
      'invalid input syntax for type uuid: "kabir@example.com"',
      "Failing row contains (1, kabir@example.com, 250000).",
      "Failed query: select 1\nparams: kabir@example.com,250000",
    ].join("\n");
    const out = redactLogText(text);
    expect(out).not.toMatch(/kabir|250000/);
    expect(out).toContain("Key (email)=([redacted])");
  });

  it("rebuilds errors without data-bearing properties", () => {
    const err = new FakeQueryError(pgError('duplicate key value violates unique constraint "users_email_key"'));
    const safe = redactLogArg(err) as Error & Record<string, unknown>;
    expect(safe.params).toBeUndefined();
    expect(safe.query).toBeUndefined();
    expect(`${safe.message}\n${safe.stack}`).not.toMatch(/kabir|ABCDE1234F|250000/);
    expect((safe.cause as Error & { code?: string }).code).toBe("23505");
    expect((safe.cause as Error & { detail?: string }).detail).toBeUndefined();
  });

  it("describeError and job errors keep only the database's own message", () => {
    const err = new FakeQueryError(pgError('duplicate key value violates unique constraint "users_email_key"'));
    expect(describeError(err)).toEqual({
      name: "Error",
      message: 'Failed query: duplicate key value violates unique constraint "users_email_key"',
    });
    expect(describeJobError(new Error("Key (pan_fingerprint)=(abc) already exists"))).not.toContain("abc)");
  });

  it("console redaction wraps error and warn once", () => {
    const error = vi.fn();
    const sink = { error, warn: vi.fn(), log: vi.fn() } as unknown as Console;
    installConsoleRedaction(sink);
    installConsoleRedaction(sink);
    sink.error("boom", new FakeQueryError(new Error("x")));
    expect(error).toHaveBeenCalledTimes(1);
    const [, logged] = error.mock.calls[0]!;
    expect(String((logged as Error).stack)).not.toContain("kabir");
  });
});

describe("log redaction edge cases (review)", () => {
  it("drops multi-line parameter values entirely", () => {
    const text = "Failed query: insert into x values ($1)\nparams: first line\nSECRET second line 12 MG Road";
    expect(redactLogText(text)).toBe("Failed query: insert into x values ($1)\nparams: [redacted]");
    const safe = redactLogArg(
      Object.assign(new Error(text), { params: ["first line\nSECRET second line"], query: "insert" }),
    ) as Error;
    expect(`${safe.message}\n${safe.stack}`).not.toMatch(/SECRET|MG Road|insert into/);
  });

  it("redacts expression keys and other values Postgres quotes back", () => {
    const out = redactLogText(
      [
        "Key (lower(name))=(Acme (India) Brand) already exists.",
        'value "98765432109" is out of range for type integer',
        'malformed array literal: "{kabir"',
        'date/time field value out of range: "31-31-2026"',
        'duplicate key value violates unique constraint "users_email_key"',
      ].join("\n"),
    );
    expect(out).not.toMatch(/Acme|98765432109|kabir|31-31-2026/);
    expect(out).toContain('unique constraint "users_email_key"');
  });
});
