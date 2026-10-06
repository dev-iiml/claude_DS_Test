import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditEvents,
  integrationChangeRequests,
  providerCallStats,
  providerConfigs,
  providerRoutes,
  users,
} from "@/db/schema";
import {
  IntegrationChangeError,
  approveChange,
  proposeChange,
  rejectChange,
  resolveProvider,
  runHealthChecks,
  getIntegrationsOverview,
  type ChangeInput,
} from "@/modules/integrations";
import { signUpCreator } from "@/modules/identity/auth/auth-service";
import { recordCallOutcome } from "@/modules/integrations/runtime";
import { ProviderError, ProviderRoutingError } from "@/providers/errors";

import { authDepsFor, connectTestDb, testEmail } from "../support/db";

const { db } = connectTestDb();
const auth = authDepsFor(db);
const T0 = new Date("2026-10-03T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

async function opsAdmin(label: string) {
  const r = await signUpCreator(auth, { email: testEmail(label), password: "a long enough passphrase" });
  if (!r.ok) throw new Error("signup failed");
  await db.update(users).set({ role: "ops_admin" }).where(eq(users.id, r.user.userId));
  return r.user.userId;
}

const changeDeps = (now = T0) => ({ db, now, production: false });
const routing = (now = T0, production = false) => ({ db, production, cacheTtlMs: 0, now: () => now });
const propose = (actorId: string, change: ChangeInput, now = T0) =>
  proposeChange(changeDeps(now), { actorId, change, reason: "integration test" });

async function bureauConfig(key: string) {
  const [c] = await db
    .select()
    .from(providerConfigs)
    .where(and(eq(providerConfigs.kind, "bureau"), eq(providerConfigs.key, key)));
  return c!;
}

const PAN_REF = "ABCPE1236F";

describe("Integration control plane", () => {
  it("routes every capability to its default mock config and counts calls", async () => {
    const { provider, selection } = await resolveProvider(routing(), "bureau");
    expect(selection).toMatchObject({ status: "ok", via: "primary" });
    expect(provider.descriptor).toEqual({ key: "mock", kind: "bureau", mode: "mock" });
    await provider.fetchSummary({ subjectRef: PAN_REF, consentReceiptId: "r1" });
    const mock = await bureauConfig("mock");
    const [stat] = await db.select().from(providerCallStats).where(eq(providerCallStats.configId, mock.id));
    expect(stat).toMatchObject({ operation: "fetchSummary", successes: 1, failures: 0 });
  });

  it("enforces maker-checker: risky changes wait, the requester can't approve, the database agrees", async () => {
    const maker = await opsAdmin("maker");
    const checker = await opsAdmin("checker");

    // An unrouted mock config carries no traffic, so it applies at once.
    const created = await propose(maker, {
      action: "create_config",
      kind: "bureau",
      key: "bureau_b",
      adapter: "mock",
      mode: "mock",
      enabled: true,
      settings: {},
      secretRefs: {},
    });
    expect(created.status).toBe("applied");
    const b = await bureauConfig("bureau_b");
    const mock = await bureauConfig("mock");

    const route = await propose(maker, {
      action: "set_route",
      kind: "bureau",
      primaryConfigId: mock.id,
      fallbackConfigId: b.id,
    });
    expect(route.status).toBe("pending");
    await expect(approveChange(changeDeps(), { actorId: maker, requestId: route.id })).rejects.toMatchObject({
      code: "self_approval",
    });
    await expect(
      db
        .update(integrationChangeRequests)
        .set({ status: "applied", appliedAt: T0, decidedBy: maker, decidedAt: T0 })
        .where(eq(integrationChangeRequests.id, route.id)),
    ).rejects.toThrow();

    await approveChange(changeDeps(), { actorId: checker, requestId: route.id, note: "ok" });
    const [r] = await db.select().from(providerRoutes).where(eq(providerRoutes.kind, "bureau"));
    expect(r!.fallbackConfigId).toBe(b.id);

    // Decided requests are immutable.
    await expect(
      db.update(integrationChangeRequests).set({ reason: "edited" }).where(eq(integrationChangeRequests.id, route.id)),
    ).rejects.toThrow();
    // Configs can't be deleted or re-keyed.
    await expect(db.delete(providerConfigs).where(eq(providerConfigs.id, b.id))).rejects.toThrow();
    await expect(
      db
        .update(providerConfigs)
        .set({ key: "renamed", version: b.version + 1 })
        .where(eq(providerConfigs.id, b.id)),
    ).rejects.toThrow();
  });

  it("opens the primary's circuit after repeated outages, switches to the fallback, and recovers", async () => {
    const maker = await opsAdmin("maker2");
    const checker = await opsAdmin("checker2");
    const mock = await bureauConfig("mock");

    const outage = await propose(maker, {
      action: "update_config",
      configId: mock.id,
      settings: { simulateOutage: true },
    });
    expect(outage.status).toBe("pending"); // the config is routed
    await approveChange(changeDeps(), { actorId: checker, requestId: outage.id });

    for (let i = 0; i < 5; i++) {
      const { provider, selection } = await resolveProvider(routing(at(i)), "bureau");
      expect(selection).toMatchObject({ via: "primary" });
      await expect(provider.fetchSummary({ subjectRef: PAN_REF, consentReceiptId: "r" })).rejects.toBeInstanceOf(
        ProviderError,
      );
    }
    const switched = await resolveProvider(routing(at(10_000)), "bureau");
    expect(switched.selection).toMatchObject({ status: "ok", via: "fallback" });
    expect(switched.provider.descriptor.key).toBe("bureau_b");
    await expect(switched.provider.fetchSummary({ subjectRef: PAN_REF, consentReceiptId: "r" })).resolves.toMatchObject(
      { scoreBand: "medium" },
    );

    const [opened] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.eventType, "integrations.circuit_opened"), eq(auditEvents.entityId, mock.id)));
    expect(opened!.metadata).toMatchObject({ kind: "bureau", config_key: "mock" });

    // A success from a call that started before the circuit opened doesn't close it.
    const late = await recordCallOutcome(db, {
      configId: mock.id,
      configKey: "mock",
      kind: "bureau",
      operation: "fetchSummary",
      outcome: "success",
      durationMs: 1,
      startedAt: at(-1),
      now: at(20_000),
    });
    expect(late).toBeNull();

    // After the cooldown exactly one call may probe the primary; the rest fail fast, then use the fallback.
    const p1 = await resolveProvider(routing(at(70_000)), "bureau");
    const p2 = await resolveProvider(routing(at(70_000)), "bureau");
    expect(p1.selection).toMatchObject({ via: "primary" });
    await expect(p1.provider.fetchSummary({ subjectRef: PAN_REF, consentReceiptId: "r" })).rejects.toBeInstanceOf(
      ProviderError,
    );
    await expect(p2.provider.fetchSummary({ subjectRef: PAN_REF, consentReceiptId: "r" })).rejects.toBeInstanceOf(
      ProviderRoutingError,
    );
    expect((await resolveProvider(routing(at(75_000)), "bureau")).selection).toMatchObject({ via: "fallback" });

    // Fixing the config (approved, it's routed) resets the circuit.
    const fix = await propose(maker, { action: "update_config", configId: mock.id, settings: {} });
    await approveChange(changeDeps(), { actorId: checker, requestId: fix.id });
    const healed = await resolveProvider(routing(at(80_000)), "bureau");
    expect(healed.selection).toMatchObject({ via: "primary" });
    await healed.provider.fetchSummary({ subjectRef: PAN_REF, consentReceiptId: "r" });
  });

  it("doesn't count rejected requests against provider health", async () => {
    for (let i = 0; i < 6; i++) {
      const { provider } = await resolveProvider(routing(), "bureau");
      await expect(provider.fetchSummary({ subjectRef: "bad", consentReceiptId: "r" })).rejects.toMatchObject({
        errorClass: "rejected",
      });
    }
    expect((await resolveProvider(routing(), "bureau")).selection).toMatchObject({ via: "primary" });
  });

  it("the kill switch is instant; lifting it needs a second person", async () => {
    const maker = await opsAdmin("maker3");
    const checker = await opsAdmin("checker3");
    const pause = await propose(maker, { action: "pause_kind", kind: "bureau" });
    expect(pause.status).toBe("applied");
    const paused = await resolveProvider(routing(), "bureau");
    expect(paused.selection.status).toBe("paused");
    await expect(paused.provider.fetchSummary({ subjectRef: PAN_REF, consentReceiptId: "r" })).rejects.toBeInstanceOf(
      ProviderRoutingError,
    );
    expect(paused.provider.descriptor.key).toBe("mock");

    const resume = await propose(maker, { action: "resume_kind", kind: "bureau" });
    expect(resume.status).toBe("pending");
    expect((await resolveProvider(routing(), "bureau")).selection.status).toBe("paused");
    await approveChange(changeDeps(), { actorId: checker, requestId: resume.id });
    expect((await resolveProvider(routing(), "bureau")).selection.status).toBe("ok");
  });

  it("a route approval is superseded if a config it names changed after the request", async () => {
    const a = await opsAdmin("maker6");
    const b = await opsAdmin("checker6");
    await propose(a, {
      action: "create_config",
      kind: "lender",
      key: "lender_b",
      adapter: "mock",
      mode: "mock",
      enabled: true,
      settings: {},
      secretRefs: {},
    });
    const [lenderB] = await db
      .select()
      .from(providerConfigs)
      .where(and(eq(providerConfigs.kind, "lender"), eq(providerConfigs.key, "lender_b")));
    const [route] = await db.select().from(providerRoutes).where(eq(providerRoutes.kind, "lender"));
    const req = await propose(a, {
      action: "set_route",
      kind: "lender",
      primaryConfigId: route!.primaryConfigId,
      fallbackConfigId: lenderB!.id,
    });
    // Unrouted, so this edit is instant — and changes what the approver would be routing to.
    expect(
      (await propose(a, { action: "update_config", configId: lenderB!.id, settings: { simulateOutage: true } })).status,
    ).toBe("applied");
    await expect(approveChange(changeDeps(), { actorId: b, requestId: req.id })).rejects.toMatchObject({
      code: "superseded",
    });
    // The kill switch still engages regardless of route versions.
    expect((await propose(a, { action: "pause_kind", kind: "lender" })).status).toBe("applied");
    const resume = await propose(a, { action: "resume_kind", kind: "lender" });
    await approveChange(changeDeps(), { actorId: b, requestId: resume.id });
  });

  it("marks stale requests superseded, expires old ones, and lets the requester cancel", async () => {
    const a = await opsAdmin("maker4");
    const b = await opsAdmin("checker4");
    const fallback = await bureauConfig("bureau_b");

    const first = await propose(a, { action: "update_config", configId: fallback.id, settings: { timeoutMs: 2000 } });
    const second = await propose(b, { action: "update_config", configId: fallback.id, settings: { timeoutMs: 3000 } });
    await approveChange(changeDeps(), { actorId: a, requestId: second.id });
    await expect(approveChange(changeDeps(), { actorId: b, requestId: first.id })).rejects.toMatchObject({
      code: "superseded",
    });
    const [row] = await db.select().from(integrationChangeRequests).where(eq(integrationChangeRequests.id, first.id));
    expect(row!.status).toBe("superseded");

    const old = await propose(a, { action: "resume_kind", kind: "bureau" }, at(-3 * 86_400_000)).catch(
      (e: unknown) => e,
    );
    expect(old).toBeInstanceOf(IntegrationChangeError); // not paused → invalid
    const stale = await propose(
      a,
      { action: "update_config", configId: fallback.id, settings: { timeoutMs: 4000 } },
      at(-3 * 86_400_000),
    );
    await expect(approveChange(changeDeps(), { actorId: b, requestId: stale.id })).rejects.toMatchObject({
      code: "expired",
    });

    const mine = await propose(a, { action: "update_config", configId: fallback.id, settings: { timeoutMs: 5000 } });
    expect(await rejectChange(changeDeps(), { actorId: a, requestId: mine.id })).toEqual({ status: "cancelled" });
    const theirs = await propose(a, { action: "update_config", configId: fallback.id, settings: { timeoutMs: 6000 } });
    expect(await rejectChange(changeDeps(), { actorId: b, requestId: theirs.id, note: "no" })).toEqual({
      status: "rejected",
    });
  });

  it("validates changes: strict settings, secret references and production rules", async () => {
    const a = await opsAdmin("maker5");
    const base = {
      action: "create_config" as const,
      kind: "notification" as const,
      adapter: "mock",
      mode: "mock" as const,
      enabled: false,
    };
    await expect(
      propose(a, { ...base, key: "sms_b", settings: { apiKey: "sk_live_x" }, secretRefs: {} }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      propose(a, { ...base, key: "sms_b", settings: {}, secretRefs: { apiKey: "INTEGRATION_SMS_KEY" } }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      propose(a, { ...base, key: "sms_b", mode: "live", settings: {}, secretRefs: {} }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      proposeChange(
        { db, now: T0, production: true },
        { actorId: a, change: { ...base, key: "sms_c", settings: {}, secretRefs: {} }, reason: "prod" },
      ),
    ).rejects.toMatchObject({ code: "invalid" });

    // Mock configs never serve production traffic, and aren't even exposed by descriptor.
    const prod = await resolveProvider(routing(T0, true), "notification");
    expect(prod.selection).toEqual({ status: "unavailable", reason: "mock_in_production" });
    expect(prod.provider.descriptor).toMatchObject({ key: "unconfigured", mode: "live" });
  });

  it("records health checks and exposes an ops overview without secret values", async () => {
    const result = await runHealthChecks({ db, now: T0, production: false });
    expect(result.checked).toBeGreaterThanOrEqual(9);
    const overview = await getIntegrationsOverview(db, { now: T0, production: false });
    const bureau = overview.find((k) => k.kind === "bureau")!;
    expect(bureau.serving).toBe("mock");
    expect(bureau.configs.map((c) => [c.key, c.role])).toEqual([
      ["mock", "primary"],
      ["bureau_b", "fallback"],
    ]);
    expect(bureau.configs[0]!.health).toBe("ok");
    expect(JSON.stringify(overview)).not.toMatch(/sk_|password/i);
  });
});
