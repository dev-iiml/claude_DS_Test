import { expect, test, type APIRequestContext } from "@playwright/test";

import { DEMO_PASSWORD, E2E_PASSWORD, uniqueEmail } from "./helpers";

/** `/api/v1` — the contract future iOS/Android apps use. Bearer tokens only; no cookies. */

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signInApi(request: APIRequestContext, email: string, password = DEMO_PASSWORD) {
  const res = await request.post("/api/v1/auth/sign-in", { data: { email, password, client: "ios" } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { token: string; user: { id: string; role: string } };
}

test.describe("API v1", () => {
  test("health", async ({ request }) => {
    const res = await request.get("/api/v1/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers()["cache-control"]).toContain("no-store");
  });

  test("requires a bearer token and uses one error envelope", async ({ request }) => {
    const res = await request.get("/api/v1/me");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthenticated", message: "Sign in to continue." } });
    const bad = await request.get("/api/v1/me", { headers: { Authorization: "Bearer not-a-real-token-123456" } });
    expect(bad.status()).toBe(401);
  });

  test("native sign-up → onboarding steps in order → me", async ({ request }) => {
    const email = uniqueEmail("api");
    const web = await request.post("/api/v1/auth/sign-up", {
      data: { email, password: E2E_PASSWORD, confirmPassword: E2E_PASSWORD, client: "web" },
    });
    expect(web.status()).toBe(422); // browser sessions are cookie-only
    const up = await request.post("/api/v1/auth/sign-up", {
      data: { email, password: E2E_PASSWORD, confirmPassword: E2E_PASSWORD, client: "ios" },
    });
    expect(up.status()).toBe(201);
    const { token } = (await up.json()) as { token: string };
    expect(up.headers()["set-cookie"]).toBeUndefined();

    let me = await (await request.get("/api/v1/me", { headers: bearer(token) })).json();
    expect(me).toMatchObject({
      user: { email, role: "creator" },
      onboarding: { status: "not_started", nextStep: "about" },
    });

    const locked = await request.put("/api/v1/onboarding/business", {
      headers: bearer(token),
      data: { legalForm: "individual", gstStatus: "not_registered" },
    });
    expect(locked.status()).toBe(409);
    expect((await locked.json()).error.code).toBe("profile_missing");

    const invalid = await request.put("/api/v1/onboarding/about", {
      headers: bearer(token),
      data: { displayName: "" },
    });
    expect(invalid.status()).toBe(422);
    expect((await invalid.json()).error.fields).toBeTruthy();

    const about = await request.put("/api/v1/onboarding/about", {
      headers: bearer(token),
      data: { legalName: "Api Tester", displayName: "Api Tester", state: "Goa", city: "Panaji", languages: ["en"] },
    });
    expect(about.status()).toBe(204);
    me = await (await request.get("/api/v1/me", { headers: bearer(token) })).json();
    expect(me.onboarding).toEqual({ status: "draft", nextStep: "profile" });

    const passport = await request.get("/api/v1/passport", { headers: bearer(token) });
    expect(passport.status()).toBe(409);

    const consent = await (await request.get("/api/v1/consents/creator_profile", { headers: bearer(token) })).json();
    expect(consent).toMatchObject({ definition: { key: "creator_profile", version: 1 }, granted: false });

    expect((await request.post("/api/v1/auth/sign-out", { headers: bearer(token) })).status()).toBe(204);
    expect((await request.get("/api/v1/me", { headers: bearer(token) })).status()).toBe(401);
  });

  test("passport, connection and signals for a completed creator", async ({ request }) => {
    const { token } = await signInApi(request, "ishita.rao@creators.creatorco.test");
    const passport = await (await request.get("/api/v1/passport", { headers: bearer(token) })).json();
    expect(passport.memberNumber).toMatch(/^CC [0-9A-F]{4} [0-9A-F]{4}$/);
    expect(JSON.stringify({ ...passport, consents: null })).not.toMatch(/gstin|"pan|credit|limit/i);

    const start = await request.post("/api/v1/social/connections", {
      headers: bearer(token),
      data: {
        platform: "youtube",
        connectionConsentId: passport.consents.connectionDefinition.id,
        analyticsConsentId: passport.consents.analyticsDefinition.id,
      },
    });
    expect(start.status()).toBe(201);
    const url = new URL((await start.json()).authorizationUrl, "http://localhost");
    const state = url.searchParams.get("state")!;
    // Mock provider: the code encodes what its authorisation screen would return.
    const code = Buffer.from(
      JSON.stringify({ platform: "youtube", handle: "ishita.cooks.demo", nonce: "e2e" }),
    ).toString("base64url");
    const done = await request.post("/api/v1/social/connections/complete", {
      headers: bearer(token),
      data: { state, code },
    });
    expect(done.status()).toBe(201);
    expect(await done.json()).toMatchObject({ platform: "youtube", snapshotsStored: 12, graphComputed: true });
    const again = await request.post("/api/v1/social/connections/complete", {
      headers: bearer(token),
      data: { state, code },
    });
    expect(again.status()).toBe(422);
    expect((await again.json()).error.code).toBe("already_used");

    const graph = await (await request.get("/api/v1/professional-graph", { headers: bearer(token) })).json();
    expect(graph.enabled).toBe(true);
    expect(graph.graph.features).toHaveLength(12);

    const { accountId } = (await done.json()) as { accountId: string };
    expect((await request.delete(`/api/v1/social/accounts/${accountId}`, { headers: bearer(token) })).status()).toBe(
      204,
    );
    expect((await request.delete(`/api/v1/professional-graph`, { headers: bearer(token) })).status()).toBe(204);
    const off = await (await request.get("/api/v1/professional-graph", { headers: bearer(token) })).json();
    expect(off).toEqual({ enabled: false, graph: null });
  });

  test("consent centre over the API", async ({ request }) => {
    const { token } = await signInApi(request, "aarohi.menon@creators.creatorco.test");
    const centre = await (await request.get("/api/v1/consents", { headers: bearer(token) })).json();
    expect(centre.purposes.map((p: { key: string }) => p.key)).toEqual([
      "creator_profile",
      "identity_prefill",
      "social_account_connection",
      "professional_analytics",
      "financial_eligibility",
      "lender_sharing",
      "lender_handoff",
    ]);
    const analytics = centre.purposes.find((p: { key: string }) => p.key === "professional_analytics");
    const granted = await request.post("/api/v1/consents/professional_analytics", {
      headers: bearer(token),
      data: { consentDefinitionId: analytics.current.id, agree: true },
    });
    expect(granted.status()).toBe(201);
    const { receiptId } = await granted.json();
    const receipt = await (
      await request.get(`/api/v1/consents/receipts/${receiptId}`, { headers: bearer(token) })
    ).json();
    expect(receipt).toMatchObject({ key: "professional_analytics", status: "granted" });
    expect(receipt.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const withdrawn = await request.delete("/api/v1/consents/professional_analytics", {
      headers: bearer(token),
      data: { reason: "not_using" },
    });
    expect(withdrawn.status()).toBe(200);
    expect((await withdrawn.json()).erasures).toEqual([
      { scope: "professional_graph", status: "completed", holdReasons: [] },
    ]);
    const again = await request.delete("/api/v1/consents/professional_analytics", { headers: bearer(token) });
    expect(again.status()).toBe(409);
  });

  test("financial eligibility over the API", async ({ request }) => {
    const { token } = await signInApi(request, "kabir.sethi@creators.creatorco.test");
    const consent = await (
      await request.get("/api/v1/consents/financial_eligibility", { headers: bearer(token) })
    ).json();
    const started = await request.post("/api/v1/eligibility", {
      headers: bearer(token),
      data: { consentDefinitionId: consent.definition.id, agree: true },
    });
    expect(started.status()).toBe(201);
    const app = await started.json();
    expect(app).toMatchObject({ status: "draft", steps: { details: "not_started", creditCheck: "not_started" } });

    const early = await request.post(`/api/v1/eligibility/${app.id}/credit-check`, {
      headers: bearer(token),
      data: { pan: "ABCPE1235F", confirm: true },
    });
    expect(early.status()).toBe(409);

    const saved = await request.put(`/api/v1/eligibility/${app.id}/details`, {
      headers: bearer(token),
      data: {
        purposes: ["working_capital", "team_hiring"],
        requestedAmount: 300000,
        declaredMonthlyIncome: 120000,
        declaredMonthlyEmi: 10000,
        incomeSources: ["brand_deals"],
      },
    });
    expect(saved.status()).toBe(200);
    const checked = await request.post(`/api/v1/eligibility/${app.id}/credit-check`, {
      headers: bearer(token),
      data: { pan: "ABCPE1235F", confirm: true },
    });
    expect(checked.status()).toBe(200);
    expect(await checked.json()).toMatchObject({ panMasked: "XXXXX1235F", bureauScoreBand: "medium" });
    expect(JSON.stringify(await checked.json())).not.toContain("ABCPE1235F");

    // Two numbers: the first has no accounts at the Account Aggregator, the second has three.
    const bad = await request.post(`/api/v1/eligibility/${app.id}/bank`, {
      headers: bearer(token),
      data: { mobile: "12345" },
    });
    expect(bad.status()).toBe(422);
    for (const [mobile, status] of [
      ["9876500010", "no_accounts"],
      ["9876500015", "approved"],
    ] as const) {
      const bank = await (
        await request.post(`/api/v1/eligibility/${app.id}/bank`, { headers: bearer(token), data: { mobile } })
      ).json();
      const reference = new URL(bank.redirectUrl, "http://localhost").searchParams.get("reference")!;
      const accounts = status === "approved" ? { accounts: "0015-0,0015-1,0015-2" } : {};
      const done = await request.post("/api/v1/eligibility/bank/complete", {
        headers: bearer(token),
        data: { params: { reference, status, ...accounts } },
      });
      expect(done.status()).toBe(200);
    }
    const overview = await (await request.get(`/api/v1/eligibility/${app.id}/bank`, { headers: bearer(token) })).json();
    expect(overview).toMatchObject({ accountsShared: 3, numbersSearched: 2, coverage: "partial" });
    expect(JSON.stringify(overview)).not.toContain("98765");

    // Confirming waits for the coverage answer; it's never automatic.
    expect((await request.post(`/api/v1/eligibility/${app.id}/confirm`, { headers: bearer(token) })).status()).toBe(
      409,
    );
    const covered = await request.put(`/api/v1/eligibility/${app.id}/bank/coverage`, {
      headers: bearer(token),
      data: { allShared: true },
    });
    expect(await covered.json()).toMatchObject({ status: "draft", bankCoverage: "complete" });
    const confirmed = await request.post(`/api/v1/eligibility/${app.id}/confirm`, { headers: bearer(token) });
    expect((await confirmed.json()).status).toBe("inputs_ready");

    const view = await (await request.get(`/api/v1/eligibility/${app.id}`, { headers: bearer(token) })).json();
    expect(view.financialCapacity.features).toHaveLength(18);
    expect((await request.delete(`/api/v1/eligibility/${app.id}`, { headers: bearer(token) })).status()).toBe(204);
  });

  test("staff tokens can't use creator endpoints", async ({ request }) => {
    const { token } = await signInApi(request, "risk.admin@staff.creatorco.test");
    const res = await request.get("/api/v1/passport", { headers: bearer(token) });
    expect(res.status()).toBe(403);
  });

  test("rejects non-JSON bodies", async ({ request }) => {
    const res = await request.post("/api/v1/auth/sign-in", {
      data: "email=x",
      headers: { "Content-Type": "text/plain" },
    });
    expect(res.status()).toBe(415);
  });
});
