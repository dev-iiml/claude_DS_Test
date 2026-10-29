import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { rateLimitCounters } from "@/db/schema";
import { consumeRateLimit, purgeRateLimitCounters } from "@/modules/rate-limit";

import { connectTestDb } from "../support/db";

const { db } = connectTestDb();
const at = (iso: string) => new Date(iso);
const ip = () => `198.51.100.${Math.floor(Math.random() * 250)}:${Math.random().toString(36).slice(2, 8)}`;

describe("rate limiting", () => {
  it("allows up to the limit in a window, then rejects with Retry-After", async () => {
    const subject = ip();
    const now = at("2026-10-30T10:01:00Z");
    for (let i = 0; i < 30; i++) {
      expect(await consumeRateLimit(db, { bucket: "auth.sign_up", subject, now })).toEqual({ ok: true });
    }
    expect(await consumeRateLimit(db, { bucket: "auth.sign_up", subject, now })).toEqual({
      ok: false,
      retryAfterSeconds: 59 * 60,
    });
    // Another network, another bucket and the next window are unaffected.
    expect((await consumeRateLimit(db, { bucket: "auth.sign_up", subject: ip(), now })).ok).toBe(true);
    expect((await consumeRateLimit(db, { bucket: "auth.sign_in", subject, now })).ok).toBe(true);
    expect((await consumeRateLimit(db, { bucket: "auth.sign_up", subject, now: at("2026-10-30T11:00:00Z") })).ok).toBe(
      true,
    );
  });

  it("stores only a keyed hash and counts concurrent hits exactly", async () => {
    const subject = "203.0.113.99";
    const now = at("2026-10-30T12:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 70 }, () => consumeRateLimit(db, { bucket: "auth.sign_in", subject, now })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(60);
    const rows = await db.select().from(rateLimitCounters).where(eq(rateLimitCounters.bucket, "auth.sign_in"));
    expect(rows.some((r) => r.subjectKey.includes("203.0.113"))).toBe(false);
    expect(rows.find((r) => r.windowStart.getTime() === now.getTime() && r.count === 70)).toBeTruthy();
  });

  it("purges counters older than 48 hours", async () => {
    const subject = ip();
    await consumeRateLimit(db, { bucket: "otp.send", subject, now: at("2026-10-01T00:10:00Z") });
    await consumeRateLimit(db, { bucket: "otp.send", subject, now: at("2026-10-30T00:10:00Z") });
    const { deleted } = await purgeRateLimitCounters(db, at("2026-10-30T01:00:00Z"));
    expect(deleted).toBeGreaterThanOrEqual(1);
    const left = await db.select().from(rateLimitCounters);
    expect(left.every((r) => r.windowStart >= at("2026-10-28T01:00:00Z"))).toBe(true);
  });
});
