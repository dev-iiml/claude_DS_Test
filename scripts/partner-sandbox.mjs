#!/usr/bin/env node
/**
 * Sandbox partner lender (Stage 12b) — plays the bank/NBFC side of the
 * CreatorCo partner API against a local or staging app. Plain Node 20+, no
 * dependencies, so it also documents what a real partner integration does.
 *
 *   node scripts/partner-sandbox.mjs ping
 *   node scripts/partner-sandbox.mjs decide            # decide every proposal awaiting a decision / with an open query
 *   node scripts/partner-sandbox.mjs events [after]    # read the event feed
 *   node scripts/partner-sandbox.mjs listen [port]     # receive webhooks, verify signatures, decide automatically
 *
 * Env: CREATORCO_URL (default http://localhost:3000), PARTNER_API_KEY (default: the seeded public sandbox key),
 *      WEBHOOK_SECRET (for `listen`: the signing secret shown in /ops when the webhook URL was proposed).
 *
 * Its "credit policy" is a toy: approve the CreatorCo Traditional recommendation when there is one, otherwise
 * decline. A real partner applies its own approved policy.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const BASE = (process.env.CREATORCO_URL ?? "http://localhost:3000").replace(/\/$/, "");
const KEY =
  process.env.PARTNER_API_KEY ?? `cck_test_sandbox1_${"DemoOnlySandboxPartnerKey_NotASecret".padEnd(43, "x")}`;
const TOLERANCE_SECONDS = 300;

async function api(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}/api/partner/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${KEY}`,
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json?.error ?? json)}`);
  return { status: res.status, json };
}

/** Illustrative terms + KFS (a real partner sends its own). Reducing-balance EMI; APR on the net amount received. */
function offerFor(amount, tenorMonths, annualRatePct = 18, feePct = 2) {
  const r = annualRatePct / 1200;
  const f = (1 + r) ** tenorMonths;
  const emi = Math.ceil((amount * r * f) / (f - 1));
  const fee = Math.round((amount * feePct) / 100);
  const pv = (m) => (emi * (1 - (1 + m) ** -tenorMonths)) / m;
  let lo = 1e-9;
  let hi = 1;
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > amount - fee) lo = mid;
    else hi = mid;
  }
  const apr = Math.max(Math.round(((lo + hi) / 2) * 1200 * 100) / 100, annualRatePct);
  return {
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    terms: {
      lenderName: "Sandbox Partner Lender",
      sanctionedAmount: amount,
      tenorMonths,
      interestRateType: "fixed",
      annualInterestRatePct: annualRatePct,
      processingFee: fee,
      otherCharges: [],
      aprPct: apr,
      emiAmount: emi,
      emiCount: tenorMonths,
      totalInterest: emi * tenorMonths - amount,
      totalRepayable: emi * tenorMonths + fee,
      coolingOffDays: 3,
      grievanceOfficer: { name: "Sandbox Grievance Desk", email: "grievance@sandbox-lender.test" },
      kfsReference: `SANDBOX-KFS-${Date.now().toString(36)}`,
    },
  };
}

/** Toy policy: the Traditional model's recommendation, else decline. */
function decisionFor(proposal) {
  const latest = proposal.decisions.at(-1);
  const openQuery = proposal.queries.find((q) => q.answeredByRevision === null);
  if (openQuery && latest) {
    // Reaffirm the previous decision (a real partner would re-review).
    return {
      outcome: latest.outcome,
      approvedExposure: latest.approvedExposure,
      approvedTenorMonths: latest.approvedTenorMonths,
      decisionBasis: latest.decisionBasis ?? undefined,
      reasonCodes: ["SANDBOX_REAFFIRMED"],
      ...(latest.outcome === "declined"
        ? {}
        : { offer: offerFor(latest.approvedExposure, latest.approvedTenorMonths) }),
    };
  }
  const t = proposal.payload.models?.traditional;
  const requested = proposal.payload.request.requestedAmount ?? 0;
  if (t && t.outcome === "recommend" && t.recommendedExposure) {
    const amount = Math.max(10_000, Math.min(t.recommendedExposure, requested || t.recommendedExposure));
    const tenor = t.recommendedTenorMonths ?? 12;
    return {
      outcome: amount < requested ? "modified" : "approved",
      approvedExposure: amount,
      approvedTenorMonths: tenor,
      decisionBasis: "traditional",
      reasonCodes: amount < requested ? ["SANDBOX_AMOUNT_REDUCED"] : [],
      offer: offerFor(amount, tenor),
    };
  }
  return { outcome: "declined", decisionBasis: "traditional", reasonCodes: ["SANDBOX_POLICY_DECLINE"] };
}

async function decideOne(id) {
  const { json: proposal } = await api("GET", `/proposals/${id}`);
  if (!["awaiting_decision", "query_open"].includes(proposal.status))
    return console.log(`· ${id} is ${proposal.status}`);
  const decision = decisionFor(proposal);
  const { status, json } = await api("POST", `/proposals/${id}/decision`, decision, {
    "idempotency-key": `sandbox-${id}-${proposal.decisions.length + 1}`,
  });
  console.log(`✓ ${id} → ${json.outcome} (revision ${json.revision}${status === 200 ? ", replayed" : ""})`);
}

async function decideAll() {
  for (const status of ["awaiting_decision", "query_open"]) {
    let cursor;
    do {
      const { json } = await api("GET", `/proposals?status=${status}${cursor ? `&cursor=${cursor}` : ""}`);
      for (const p of json.data) await decideOne(p.id);
      cursor = json.nextCursor;
    } while (cursor);
  }
}

function verify(header, body, secret) {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return parts
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const given = Buffer.from(p.slice(3), "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

function listen(port) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) throw new Error("Set WEBHOOK_SECRET to the signing secret shown in /ops.");
  const seen = new Set();
  createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      if (!verify(req.headers["creatorco-signature"], body, secret)) {
        res.writeHead(401).end();
        return console.log("✗ rejected: bad or stale signature");
      }
      res.writeHead(204).end(); // acknowledge fast; work afterwards
      const event = JSON.parse(body);
      if (seen.has(event.id)) return; // at-least-once delivery: de-duplicate on the event id
      seen.add(event.id);
      console.log(`← ${event.type} ${event.id} ${JSON.stringify(event.data)}`);
      if (event.type === "offer.accepted" && event.data.proposalId) {
        const { json } = await api("GET", `/proposals/${event.data.proposalId}`).catch(() => ({ json: null }));
        if (json?.applicant) console.log(`  applicant: ${json.applicant.legalName} <${json.applicant.email}>`);
        return;
      }
      if (["proposal.submitted", "decision.queried"].includes(event.type) && event.data.proposalId) {
        await decideOne(event.data.proposalId).catch((e) => console.error(`✗ ${e.message}`));
      }
    });
  }).listen(port, () => console.log(`Listening for CreatorCo webhooks on http://localhost:${port}/`));
}

const [cmd = "ping", arg] = process.argv.slice(2);
try {
  if (cmd === "ping") console.log((await api("GET", "/ping")).json);
  else if (cmd === "decide") await decideAll();
  else if (cmd === "events") console.log(JSON.stringify((await api("GET", `/events?after=${arg ?? 0}`)).json, null, 2));
  else if (cmd === "listen") listen(Number(arg ?? 4010));
  else throw new Error(`Unknown command ${cmd}`);
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}
