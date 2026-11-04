# CreatorCo partner API (Stage 12b)

This guide is for a **partner lender** (bank/NBFC) that receives CreatorCo credit proposals. The partner (the regulated
entity) decides under its own approved credit policy. CreatorCo prepares, sends and explains the proposal. It is not
the lender.

Model (user decision): **pull + thin webhooks**.

- CreatorCo sends a signed webhook that carries **only an event id, a type and identifiers**.
- The partner **fetches** the proposal with its API key.
- The partner **POSTs its decision** back.
- Nothing financial sits in webhook queues or retries.

```
CreatorCo                                      Partner
  proposal sent ── webhook proposal.submitted ──▶ (verify signature, ack 2xx)
                ◀── GET /proposals/{id} ───────── fetch the frozen payload
                ◀── POST /proposals/{id}/decision ─ decide (Idempotency-Key)
  reviewer confirms ─ webhook decision.confirmed ▶ (the creator now sees it)
  reviewer queries ── webhook decision.queried ──▶ GET the query, POST a revision
```

## Credentials

- **API key:** `Authorization: Bearer cck_<test|live>_<id>_<secret>`.
  - Issued in `/ops → Partners` by one ops admin and approved by another. The key is shown once, to the issuer.
  - Only a SHA-256 hash is stored.
  - Keys have scopes (`proposals:read`, `decisions:write`, `events:read`), expire after 90/180/365 days, and can be
    rotated: the old key keeps working for 0–168 hours after the new one is approved.
  - Any ops admin can revoke a key at once. Suspending the partner blocks every key and pauses webhooks.
  - `cck_test_` keys work only for sandbox partners, `cck_live_` keys only for live ones.
- **Partner binding:** every partner is bound to one partner-API lender config (`ops.provider_configs`, adapter
  `partner_api`) whose mode matches the partner's environment. This is checked when the partner is created and again
  on every call.
  - A key can only ever see proposals that CreatorCo sent through that config.
  - It never sees simulated-lender proposals.
  - Production accepts live partners only.
- **Webhook signing secret** (`whsec_…`):
  - Shown once when a webhook URL is proposed. The URL needs a second ops admin's approval.
  - Derived from `PARTNER_WEBHOOK_ROOT_KEY`; nothing secret is stored.
  - Rotating it signs every webhook with both the new and the previous secret for 24 hours.

## Endpoints (`/api/partner/v1`)

Every response is JSON with `Cache-Control: no-store`. Errors are `{ "error": { "code", "message", "fields"? } }`.

| Method & path                   | Scope             | Purpose                                                                                                                                                                   |
| ------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /ping`                     | any               | `{ partner, environment, key, scopes }`                                                                                                                                   |
| `GET /proposals`                | `proposals:read`  | `{ data: [{ id, status, submittedAt, payloadHash }], nextCursor }`, oldest first. `?status=awaiting_decision\|query_open\|decided\|confirmed`, `?cursor`, `?limit` (≤100) |
| `GET /proposals/{id}`           | `proposals:read`  | The frozen `payload` (schema 1) and its `payloadHash`, plus `decisions[]`, `queries[]` and `confirmation`. 404 unless it was sent to this partner. Audited                |
| `POST /proposals/{id}/decision` | `decisions:write` | Decide (below). `201` the first time, `200` for an idempotent replay                                                                                                      |
| `GET /events?after=<seq>`       | `events:read`     | The same thin events as the webhooks, oldest first: `{ data: [{ id, type, createdAt, data, seq }], nextAfter }`                                                           |

### Decision body

```json
{
  "outcome": "approved | modified | declined",
  "approvedExposure": 120000,
  "approvedTenorMonths": 12,
  "decisionBasis": "traditional | creator_enhanced",
  "reasonCodes": ["UPPER_SNAKE_CASE"],
  "decidedAt": "2026-10-03T10:00:00Z",
  "lenderReference": "BANK-REF-123",
  "offer": {
    "expiresAt": "2026-10-10T10:00:00Z",
    "terms": {
      "lenderName": "Your registered partner name",
      "sanctionedAmount": 120000,
      "tenorMonths": 12,
      "interestRateType": "fixed | floating",
      "annualInterestRatePct": 18,
      "processingFee": 2400,
      "otherCharges": [{ "label": "Stamp duty", "amount": 100 }],
      "aprPct": 22.15,
      "emiAmount": 11002,
      "emiCount": 12,
      "totalInterest": 12024,
      "totalRepayable": 134524,
      "coolingOffDays": 3,
      "grievanceOfficer": { "name": "…", "email": "…", "phone": "…" },
      "kfsReference": "YOUR-KFS-ID",
      "termsUrl": "https://…"
    }
  }
}
```

**Header:** `Idempotency-Key` is required (8–100 characters of `[A-Za-z0-9_.:-]`).

**Validation:**

- Amount (₹10,000–₹25,00,000) and tenor (3–60 months) are required unless declined, and must be left out for a decline.
- `decidedAt` can't be in the future or before the proposal was sent.
- **Offer (Stage 13): required unless declined, and left out for a decline.** This is your offer and Key Fact
  Statement as the creator will see it. CreatorCo shows it as provided and never computes your terms. The rules:
  - `sanctionedAmount` and `tenorMonths` must equal `approvedExposure` and `approvedTenorMonths`.
  - `lenderName` must be your registered partner name.
  - `expiresAt` must be in the future and at most 60 days ahead.
  - The statement must add up: `totalRepayable` = instalments + every charge, and `totalInterest` = instalments −
    amount (±₹1 per instalment).
  - `aprPct` can't be below the interest rate, and can't understate the all-in cost of the instalments and charges.
  - `coolingOffDays` must be at least 3, matching our reading of the RBI digital lending rules; to be confirmed with
    your compliance team.

**Idempotency:** the same key with the same body returns the recorded decision. The same key with a different body
returns `409 idempotency_conflict`.

**Revisions:** the first decision is revision 1. A later revision is accepted only while a CreatorCo query is open,
and it resolves the query. Otherwise the call returns `409 already_decided`. Once CreatorCo confirms a decision, it
is final.

### Statuses (partner view)

| Status              | Meaning                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `awaiting_decision` | Sent; no decision yet.                                                                       |
| `query_open`        | A CreatorCo reviewer asked the partner to look again (`queries[].message`); post a revision. |
| `decided`           | Decision received; awaiting CreatorCo's review.                                              |
| `confirmed`         | A CreatorCo reviewer confirmed it; the creator sees it.                                      |

**Creator's answer (Stage 13):**

- `GET /proposals/{id}` includes `offerResponse` (`accepted` or `declined`, with `respondedAt`, the `termsHash` of
  the terms the creator saw, and `declineReason`). `confirmation.offerExpiresAt` is when the offer lapses.
- After an acceptance, the same call includes `applicant` (`legalName`, `email`, and `mobile` only if OTP-verified),
  but only while the creator's "Continue with the partner lender" consent stands. Reads that return it are audited.
- KYC, your loan agreement, eSign, mandate and disbursal are yours.

## What CreatorCo staff may do with a partner decision

User decision: a partner's decision is the regulated entity's sanction.

- CreatorCo reviewers **confirm** it, or **raise a query** that the partner answers with a revision. They never change
  it.
- If the partner can't answer, a reviewer can **withdraw** the query, with an internal reason. The decision then stands
  as posted. The partner sees `queries[].withdrawnAt` and a `decision.query_withdrawn` event.
- Overrides (never more favourable than the lender's decision) exist only for the pilot's simulated lender.

## Webhooks

Delivery is `POST <your URL>` with:

```
Content-Type: application/json
CreatorCo-Event-Id: evt_<uuid>
CreatorCo-Event-Type: proposal.submitted
CreatorCo-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>[,v1=<previous secret>]

{ "id": "evt_…", "type": "proposal.submitted", "createdAt": "…", "data": { "proposalId": "…" } }
```

Event types:

- `proposal.submitted`
- `decision.queried` (`data.queryId`)
- `decision.query_withdrawn` (`data.queryId`)
- `decision.confirmed`
- `offer.accepted`: fetch the proposal for `offerResponse` and `applicant`
- `offer.declined`
- `ping` (a test sent from `/ops`)

**Verifying a delivery:**

- Compute the HMAC over the **raw** body and compare it in constant time against every `v1=`.
- Reject timestamps more than 300 seconds old.
- Answer `2xx` fast, then do the work.
- Deliveries are **at least once**, so de-duplicate on the event id.

**Delivery behaviour:**

- Anything other than `2xx` is a failure, and redirects are not followed.
- A failed delivery is retried with backoff: 8 attempts over about 4 hours. Ops can then send it again.
- Events missed for any reason are always available from `GET /events`. The feed is ordered by commit, so a cursor
  never skips an event.

**URLs:**

- Staging and production require HTTPS to a public DNS name, with no IP literals and no internal names. Each delivery
  re-resolves the host and refuses non-public addresses.
- Outside staging and production, `http://localhost` is allowed for testing.

## Sandbox

The demo seed creates:

- a `partner_sandbox` lender config (adapter `partner_api`, sandbox, **not routed**);
- the "Sandbox Partner Lender";
- a public test key: `cck_test_sandbox1_DemoOnlySandboxPartnerKey_NotASecretxxxxxxx`.

1. Route the lender capability to `partner_sandbox` in `/ops → Integrations → Partner lender`. This needs a second ops
   admin.
2. Share a confirmed check as a creator.
3. Run `npm run partner:sandbox decide` (or `ping`, `events`). The script approves the Traditional recommendation and
   declines otherwise. A real partner applies its own policy.
4. To try webhooks:
   1. Propose `http://localhost:4010/` as the webhook URL and have it approved.
   2. Run `WEBHOOK_SECRET=whsec_… npm run partner:sandbox listen 4010`.
   3. Proposals are then decided as their events arrive.

## Limits and open items

- **Partner network controls:** mTLS or an IP allowlist for partner calls belongs at the edge or a gateway and isn't
  built yet. Since Stage 16 each partner is limited to 600 calls a minute (`429 rate_limited` with `Retry-After`);
  keys are 256-bit, so brute force isn't a concern.
- **Webhook SSRF:** the in-app guard checks the resolved addresses before connecting. A DNS-rebinding window remains
  until delivery goes through an egress proxy that pins the address.
- **Retention:** events and delivery logs (identifiers and HTTP statuses only) are kept until the proposal is erased.
  A retention period for them is an open item.
- **Contract terms:** the partner's decision codes, SLAs and the exact proposal profile are partnership terms. The
  data groups a proposal carries are set per lender config (`proposalProfile`) and are never wider than the
  creator's "Share with a partner lender" consent version.
