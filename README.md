# CreatorCo — Phase 1 MVP

A premium professional and financial network for creators in India. This repository holds the Phase 1 modular
monolith. **Read [`CLAUDE.md`](./CLAUDE.md) first.** It is the authoritative product, architecture and regulatory
context.

Current build: **Stages 00–12** (incl. 09b, 10b, 11b). Foundations, design system (mobile-first, iOS/macOS-style, dark by default), core
schema, self-managed auth and roles, Cohort A0 onboarding, the **Creator Passport** (Stage 05), **social account
connection** through a provider interface with a mock provider (Stage 06), the **Creator Professional Graph** feature
engine (Stage 07), the **consent centre** with receipts, withdrawal and erasure (Stage 08), **financial eligibility** inputs
in a separate `fin` schema (Stage 09), the **Underwriting Engine v0** comparing Traditional vs Creator-Enhanced
recommendations (Stage 10), the integration control plane (10b), the fraud layer (11), several accounts per platform
(11b), **multi-account / multi-number bank data with an explicit Review step** (09b), **credit proposals to a
(simulated) partner lender with staff review** (12), and a bearer-token **API v1** for future iOS/Android apps.

---

## Updating an existing local setup

Pull the new files, then run `npm install && npm run db:migrate`. This applies any pending migrations (currently
through 0028: lender proposals, partner API keys and webhooks) and publishes reference data (consent texts and,
outside production, a mock provider route per capability). To also reload the demo data — including the sandbox
partner and its test key — run `npm run db:reset` (recommended).

`npm run dev` checks the database first and stops with a list of pending migrations if it is behind the code
(`npm run db:check` runs the same check on its own).

## Quick start

Prerequisites: Node.js ≥ 20.9 and PostgreSQL ≥ 15. Local Postgres, Supabase, Neon and RDS all work.

```bash
npm install
cp .env.example .env.local      # app settings
cp .env.example .env            # scripts / drizzle-kit (same values)

# create the role and databases once (local Postgres example)
psql postgres -c "CREATE ROLE creatorco LOGIN PASSWORD 'creatorco' CREATEDB;"
createdb -O creatorco creatorco_dev

npm run db:migrate   # apply migrations
npm run db:seed      # reference data + fictional demo users (dev/test only)
npm run dev          # http://localhost:3000
```

To reset everything, run `npm run db:reset`. It drops and recreates the dev DB, then migrates and seeds. It refuses to
run when `APP_ENV` is staging or production.

### Demo accounts (fictional)

The password for every demo account is `SEED_DEMO_PASSWORD`, which defaults to `CreatorCo-demo-2026`.

| Email                                  | Role       | State                                   |
| -------------------------------------- | ---------- | --------------------------------------- |
| `aarohi.menon@creators.creatorco.test` | creator    | completed · beauty · not GST registered |
| `kabir.sethi@creators.creatorco.test`  | creator    | completed · travel · GST registered     |
| `ishita.rao@creators.creatorco.test`   | creator    | completed · food · GST unknown → review |
| `dev.malhotra@creators.creatorco.test` | creator    | completed · tech · not GST registered   |
| `naina.kapoor@creators.creatorco.test` | creator    | draft, resumes at Business status       |
| `risk.admin@staff.creatorco.test`      | risk_admin | risk console (`/admin`)                 |
| `risk.approver@staff.creatorco.test`   | risk_admin | second approver for lender policy       |
| `ops.admin@staff.creatorco.test`       | ops_admin  | integration control plane (`/ops`)      |
| `ops.approver@staff.creatorco.test`    | ops_admin  | second approver for `/ops` changes      |

All seed identities are invented. Emails use the reserved `.test` TLD and handles end in `.demo`. The seeded GSTIN uses
an impossible PAN holder-type character, so it cannot match a real registration.

---

## Commands

| Command                   | What it does                                                                     |
| ------------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`             | Next.js dev server                                                               |
| `npm run build` / `start` | Production build / server                                                        |
| `npm run lint`            | ESLint, including the architecture-boundary rules                                |
| `npm run typecheck`       | Route type generation + `tsc --noEmit` (strict)                                  |
| `npm run format[:check]`  | Prettier                                                                         |
| `npm test`                | Unit + integration tests (Vitest). Integration **recreates** `DATABASE_URL_TEST` |
| `npm run test:e2e`        | Playwright. Run `npm run build` first. Recreates and seeds a `_e2e` database     |
| `npm run check`           | design-system pin check + lint + typecheck + format check + tests                |
| `npm run ds:check`        | Fail if the app differs from its pinned design-system release                    |
| `npm run ds:pin -- <v> …` | Record an authorized design-system upgrade/rollback (`--authorized-by "<name>"`) |
| `npm run ds:screens`      | Dark/light × desktop/mobile screen check; screenshots in `.ds-screens/`          |
| `npm run db:generate`     | Generate a SQL migration from schema changes (`drizzle-kit`)                     |
| `npm run db:migrate`      | Apply migrations, then publish reference data (consent texts)                    |
| `npm run db:check`        | Read-only: fail if the database is behind the code (runs before `npm run dev`)   |
| `npm run db:reference`    | Publish reference data such as consent texts. Safe in every environment          |
| `npm run db:seed`         | Reference data + demo users (dev/test only)                                      |
| `npm run jobs:tick`       | One scheduler tick locally (what the cron calls): enqueue due sweeps, run them   |

For E2E tests, the database role needs `CREATEDB`. If your Playwright browsers don't match the installed version, run
`npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

---

## Environment variables

| Variable                      | Required   | Notes                                                                                                                 |
| ----------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                     | –          | `development` (default) · `test` · `staging` · `production`                                                           |
| `APP_URL`                     | –          | Public base URL                                                                                                       |
| `DATABASE_URL`                | ✓          | PostgreSQL connection string                                                                                          |
| `DATABASE_URL_TEST`           | tests      | Separate DB, **dropped** on every integration run                                                                     |
| `DATABASE_URL_E2E`            | –          | Defaults to `DATABASE_URL_TEST` with an `_e2e` suffix                                                                 |
| `DATABASE_POOL_MAX`           | –          | Default 5                                                                                                             |
| `DATABASE_PREPARE`            | –          | `false` behind transaction poolers (Supabase pooler :6543, PgBouncer)                                                 |
| `SESSION_TTL_HOURS`           | –          | Absolute session lifetime, default 168 (7 days)                                                                       |
| `SEED_DEMO_PASSWORD`          | seed       | Password for fictional demo accounts                                                                                  |
| `PAN_FINGERPRINT_SECRET`      | prod       | ≥ 32 chars. Key for PAN fingerprints (duplicate checks). Dev/test use a built-in key                                  |
| `FI_DATA_ENCRYPTION_KEY`      | prod       | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts AA line items. Dev/test key built in                           |
| `FI_LIVE_LINE_ITEM_RETENTION` | –          | `false` (default). Store **live** AA line items; mock/sandbox are always stored. Keep off until counsel + RE sign off |
| `CRON_SECRET`                 | prod       | ≥ 32 chars. Enables `GET /api/internal/cron/tick` (Bearer). Unset → 404                                               |
| `INTEGRATION_*`               | per vendor | Vendor credentials, referenced by name from `/ops`; never in the DB                                                   |

No vendor secrets are needed while every capability runs on mocks. Session tokens are random and only their SHA-256
hashes are stored.

---

## Architecture

```text
src/
  app/                    Next.js routes: thin pages + server actions (authorise → validate → call module)
    (auth)/               /login, /signup, sign-out action
    onboarding/           6-step Cohort A0 journey; _lib/step-handlers + form-props are shared with Passport editing
    dashboard/            Home tab (membership card, next steps, signal highlights)
    passport/             Creator Passport: verification, accounts, signals, edit/[section], connect, accounts/[id]
    connect/mock/         stand-in for a platform's OAuth screen (mock provider only)
    access/ account/      Access preview; Account (appearance, sign-in, consents, sign out)
    api/v1/               JSON API for native apps (bearer sessions) — see docs/API.md
    admin/                risk console placeholder (aggregates + provider health)
  design/                 design tokens (single source; `npm run tokens` regenerates src/app/tokens.css)
  components/
    ui/                   shadcn/ui-convention primitives (button, input, card, badge, alert…)
    creatorco/            CreatorCo design language: shells, headings, form fields, status, metrics, progress
  modules/                domain logic: framework-light, unit/integration tested
    identity/             roles, routing policy, self-managed auth (scrypt, DB sessions, throttling), DAL
    creator-profile/      onboarding rules, GST/legal-form model, GSTIN validation, schemas, services, read models
    consent/              versioned purpose-specific consent: rules + service
    audit/                append-only audit events + metadata sanitiser
    social-data/          OAuth-style connection service (hashed single-use state), idempotent snapshot ingest
    professional-graph/   pure versioned feature engine, input hashing, graph runs, presentation copy
    passport/             Creator Passport read model (shared by web + API)
    creator-status/       Member / Onyx / Icon. Never feeds credit
    access/               labelled sample opportunities
    risk-console/         admin overview (aggregate only)
    financial-eligibility/ underwriting/ fraud/ decisioning/
    lender-orchestration/ offers/ rewards/ analytics/   ← boundaries reserved for later stages (README each)
  providers/              interfaces + deterministic mocks: social, identity, bureau, financial-data, lender
  db/
    schema/               Drizzle schema grouped by domain (source of truth for generated SQL)
    migrations/           SQL migrations (generated + hand-written guards/reference data)
    seed/                 reference publisher + deterministic demo seed
    scripts/              migrate / reset / seed CLIs
  lib/                    env validation, logger (redacting), form-state helpers, sensitive-key classifier
```

### Key decisions

- **Modular monolith.** Domain modules never import UI or routes, UI never touches the DB, and providers are leaf
  adapters. ESLint `no-restricted-imports` enforces these boundaries.
- **Self-managed auth.** Credentials live in a separate `iam` schema (`identities`, `sessions`, `login_attempts`):
  - scrypt password hashing, with parameters stored in the hash so they can be rehashed later;
  - 256-bit opaque session tokens in an httpOnly cookie, stored only as SHA-256 hashes;
  - 7-day absolute expiry, with revocation on sign-out;
  - lockout after 5 failures per email-hash in 15 minutes, plus timing equalisation for unknown accounts.

  `users.auth_user_id` references `iam.identities`. A future IdP swap only changes how that id is minted.

- **Authorisation is server-side.** The role comes from `users.role` and is never taken from a token claim or the
  client. Every protected page and server action calls `requireCreator()` or `requireAdmin()` (`modules/identity/dal.ts`).
  `src/proxy.ts` is only an optimistic redirect. Non-admins get a 404 on `/admin`.
- **Data protection in the database itself:**
  - every table has RLS enabled with no policies, so access is deny-by-default and the app connects server-side only;
  - Supabase `anon` and `authenticated` roles are revoked if they exist;
  - `audit_events` is append-only (trigger);
  - published consent definitions are immutable;
  - consent receipts only allow the granted → withdrawn transition.
- **GST is modelled independently of legal form.** `legal_form` and `gst_status`
  (`not_registered | registered | unknown_requires_review`) are separate columns:
  - a CHECK constraint allows a GSTIN only when the status is `registered`;
  - GSTINs are format- and checksum-validated;
  - the pilot accepts individual and sole-proprietor forms, and shows incorporated forms as "not supported in current pilot";
  - nothing infers a GST obligation.
- **Reference tables instead of enums for evolving vocabularies.** `creator_categories` and `social_platforms` are
  tables. Stable state machines (role, statuses, GST) use `text` + `CHECK`, which are easier to evolve than PG enums.
- **Declared vs connected social accounts.** Onboarding stores self-declared platforms as `connection_status = 'declared'`
  with `provider = 'self_declared'`. Stage 05/06 connections will sit alongside them, which enables declared-vs-verified
  fraud signals later.
- **Consent.** Each purpose has its own key and integer version. A receipt binds to the exact definition the user saw.
  Publishing a new version invalidates earlier consent for that purpose, and grants are idempotent. Onboarding completion
  and the consent grant happen in one transaction.

### Onboarding v2: identity prefill and GST lookup

- **Password:** at least 8 characters, with upper case, lower case, a number and a special character. The browser
  ticks each rule live, and the server enforces the same rules (`modules/identity/auth/password-policy.ts`).
- **Mobile OTP, then a consented identity lookup.** The About step offers an optional prefill:
  1. verify the mobile number by OTP;
  2. give the separate `identity_prefill` consent;
  3. a "mobile → PAN-linked name" lookup prefills the legal name, which the creator can still edit.

  The legal name is labelled `verified_lookup` only if it still matches. Only a masked PAN (`XXXXX1234X`) is stored.

- **GST lookup by PAN.** On the Business step, the PAN is fetched again for that request only, never stored, and passed
  to a "PAN → GST" lookup:
  - registrations are listed with their status and constitution;
  - choosing one prefills the GSTIN and the legal form.
- **Typed GSTINs:**
  - validated per character as you type (state code, PAN part, `Z`, check digit);
  - checked against the registry, with Active, Suspended or Cancelled shown;
  - re-verified on save, which rejects cancelled, unknown or company GSTINs.
- **Location, languages and categories:**
  - the city dropdown depends on the state, with an "Other…" free-text option;
  - "Other" languages can be added;
  - up to 3 categories, one marked as main.
- **Provider calls** are logged as metadata only in the append-only `provider_requests` table.

**Mock provider behaviour (dev/test).** Mock providers are refused when `APP_ENV=production`.

- OTP is always **123456**; no SMS is sent.
- The **last digit of the mobile number** drives the mock lookups:

| Last digit | Identity lookup | GST registrations found                                  |
| ---------- | --------------- | -------------------------------------------------------- |
| 0          | not found       | —                                                        |
| 1–3        | found           | none                                                     |
| 4–6        | found           | one active Proprietorship                                |
| 7–8        | found           | active Proprietorship + a cancelled one                  |
| 9          | found           | one active Private Limited Company (not pilot-supported) |

- For a typed GSTIN, the 13th character `9` returns cancelled, `8` returns suspended, and anything else returns an
  active Proprietorship.

### Stages 05–07: Passport, social connection, Professional Graph

- **Passport** (`/passport`) shows the membership card, verification states, social accounts, professional signals and
  the profile. Sections are edited at `/passport/edit/{about,profile,business,interests}` with the onboarding forms and
  validation (`mode: "passport"`, audited as `creator_profile.updated`).
- **Connecting an account** needs the `social_account_connection` consent. Professional signals need the separate,
  optional `professional_analytics` consent (offered as a switch, never pre-ticked; can be turned off).
- The OAuth-style `state` is random, stored only as SHA-256, single-use, bound to the creator and valid for 10 minutes.
  The same external account can't be linked to two creators.
- **Mock social provider**: the authorisation screen is `/connect/mock`. The handle you confirm drives deterministic
  12-month history. A handle containing `spike` produces a sudden follower jump; `steady` produces even growth. A
  connected handle that differs from the declared one raises the `handle_mismatches` signal.
- **Disconnecting** returns a declared platform to "self-declared". Stored snapshots are retained (see limitations).
- **Professional Graph** (`modules/professional-graph`): 12 features (longevity, platform mix, growth, engagement,
  posting consistency, and authenticity signals). Each has a version, source (verified/declared/derived),
  completeness, confidence and provenance. A run stores `engine_version` and a hash of its inputs. Identical inputs
  reuse the same run, and runs/features are append-only. Signals are labelled "not a credit score". They don't feed
  Creator Status or any limit.

### Stage 08: consent centre

- `/account/consents` lists every purpose (Membership vs Optional) with its status: On, Off, Review update (a newer
  version was published), or Not given. Each purpose page shows the exact current text, receipt history and a withdraw
  flow that lists what will change before you confirm. Receipts (`/account/consents/receipts/[id]`) show the agreed
  text and its SHA-256 fingerprint.
- **Withdrawal model** (`modules/privacy`, effects defined in `purposes.ts`): processing stops at once, then data is
  erased.
  - Creator Profile → membership **paused** (`profile_status = paused`). Nothing is processed and member areas redirect
    to `/paused`. Data is kept, and re-consenting resumes membership. Account closure is a separate, future flow.
  - Social account connection → accounts disconnected; snapshots and derived signals erased (signals recomputed if
    still on).
  - Professional signals → computed runs/features erased.
  - Identity verification → lookup results (verified name, masked PAN) erased; legal name kept as self-declared.
- **Retention holds:** erasure is deferred (`data_erasure_requests.status = deferred`) when a `RetentionHoldChecker`
  reports a hold, e.g. an open credit application or facility with a partner lender. Processing still stops.
  `processDeferredErasures` completes them once holds lift. Phase 1 has no lending yet, so no holds apply; Stage 09+
  supplies the real checker.
- Every withdrawal writes an append-only `consent_withdrawals` row (counts only). Graph rows can be deleted only inside
  an erasure transaction (`SET LOCAL creatorco.erasure = 'on'`).

### Stage 09: financial eligibility

- `/eligibility` (from Home): separate `financial_eligibility` consent → details → credit check → bank data →
  **Financial Capacity**. Product-agnostic: the creator says what it's for (equipment, production, working capital…)
  and roughly how much; the product type is the partner lender's call later.
- **Regulated financial domain** in its own Postgres schema, `fin`, read only by `modules/financial-eligibility`.
  Stored: what the creator declared (amount, monthly income, sources, EMIs), a bureau **summary** (band and counts), a
  masked PAN, and **monthly cashflow totals**. Never stored: the full PAN, bureau reports/tradelines or bank
  transactions.
- The PAN is personal-only (4th character `P`), used once for the bureau call and never logged or echoed. It must match
  the verified masked PAN if the creator verified their identity. Bureau checks are limited to 3 per 30 days.
- **Financial Capacity engine** (`fin-0.1.0`): 15 versioned, pure features covering the bureau summary, 6-month
  cashflow, creator-income share and months, declared vs observed income, and EMIs to income. Runs are reproducible
  (input hash) and append-only. These are inputs only; the recommendation is Stage 10.
- **Retention** (user decision): an unsent check expires after **90 days** and its inputs are erased. Closing a check
  or withdrawing the consent erases at once. A check sent to a lender (Stage 12) is held and follows the lender's
  retention rules (`lendingRetentionHolds`).
- **Mock bureau:** the PAN's four digits drive the result. Last digit: 0 no history · 1–2 thin · 3–4 developing ·
  5–7 fair · 8–9 strong. Third digit 9 adds a missed payment; the second digit (mod 4) sets recent enquiries.
  Example: `ABCPE1238F` → strong.
- **Mock Account Aggregator:** see Stage 09b.

### Stage 13: the creator's offer

- **Terms come from the partner lender** (user decision). A partner's decision carries `offer: { expiresAt, terms }`:
  the offer and its Key Fact Statement (`providers/lender/offer.ts`, `kfs-1`).
  - The terms are validated before anything is stored: they must add up and the APR can't understate the cost.
  - The partner's registered name, at most 60 days' validity and a cooling-off period of 3 days or more are also
    required.
  - The **simulated lender** prices **illustrative** terms from a grade-based grid in the simulated policy (maker-checker
    on `/admin/models`; default 16–26% p.a., 2% fee, 7 days, 3-day cooling-off). They are always labelled
    _Simulated pilot_.
- **Review:**
  - Reviewers see the lender's offer and KFS before confirming.
  - A lapsed partner offer can't be confirmed (query the partner instead).
  - A simulated override re-prices the terms at the same rate and fee.
  - A simulated offer's validity starts at review.
- **Creator:**
  - The decision and offer now lead the check page: amount, EMI, rate, APR and total repayable, plus the full KFS.
  - Accepting needs a KFS tick and the new purpose-specific consent **"Continue with the partner lender"**
    (`lender_handoff` v1), given in the same transaction as the acceptance. The creator accepts the exact terms
    shown (terms hash).
  - Decline is quiet and the reason optional.
  - Badges: Offer ready, Offer accepted, Offer declined, Offer expired, Not approved.
- **Partner:** the creator's answer is sent as signed thin webhooks, `offer.accepted` and `offer.declined`. After an
  acceptance, `GET /proposals/{id}` includes `offerResponse` and `applicant` (name, email, verified mobile) while that
  consent stands. KYC, the agreement, eSign and disbursal are the partner's.
- **Close-out** (user decision: keep everything until the creator withdraws consent):
  - Holds are per check. Checks awaiting a decision, with an open offer or with an accepted one are held.
  - Declined (by the lender or the creator) and expired offers are not held. On withdrawal, their inputs,
    underwriting runs and lender records (proposal, decisions, answers, partner events) are erased; the lender keeps
    its own copy.
  - Withdrawal now erases everything not held straight away and defers only held checks. The deferred-erasure job
    erases each check as it is released.
- **API v1:** `POST /eligibility/{id}/offer/accept` and `/offer/decline`; `lender.offer` on `GET /eligibility/{id}`.

### Stage 12b: partner API keys and signed webhooks

- **Partner API** (`/api/partner/v1`, guide: `docs/PARTNER_API.md`), with the model **pull + thin webhooks** (user
  decision):
  - CreatorCo sends HMAC-signed webhooks that carry only event ids and types.
  - The partner fetches proposals with its API key and posts decisions back (Idempotency-Key, revisions).
  - `GET /events` replays every event in commit order.
- **Partners** (`/ops → Partners`, `modules/partners`, `ops` schema, identifiers only):
  - Each partner is bound to a partner-API lender config in its own environment. Production accepts live partners
    only.
  - API keys are hashed, scoped and expiring. One ops admin issues a key and a second approves it; the key is shown
    once. The issuer can cancel a pending key, any ops admin can revoke an active one at once, and rotation has an
    overlap window.
  - A webhook URL needs a second ops admin. Its signing secret is derived from `PARTNER_WEBHOOK_ROOT_KEY` and never
    stored. Secret rotation sends both signatures for 24 hours. Ops can stop deliveries, send a test event and
    redeliver.
- **Lender adapter `partner_api`** (vendor-neutral, routed in `/ops`): submitting makes the frozen proposal available
  to the partner. Decisions are pushed, never polled (`decisionDelivery() = "push"`). The simulated lender stays the
  default route.
- **Partner decisions** (user decision: the partner's decision is the RE's sanction):
  - Risk admins **confirm**, or **raise a query** that the partner answers with a new revision
    (`fin.lender_decisions.revision`, `fin.decision_queries`).
  - If the partner can't answer, a risk admin can **withdraw** the query with a reason.
  - Overrides exist only for the simulated lender.
  - A review always names the revision it acts on, so a newer revision is never confirmed unseen.
- **Delivery:**
  - Job `deliver_partner_webhooks` runs every minute; staff actions also deliver right after the response.
  - Rows are claimed one at a time under a lease, and each send is signed at send time.
  - Retries use backoff (8 attempts, about 4 hours). Redirects are never followed and bodies are never read.
  - In staging and production, resolved addresses are checked against private ranges (SSRF guard).
- **Sandbox:**
  - The demo seed adds the `partner_sandbox` config (not routed), the "Sandbox Partner Lender" and a public test key.
  - `npm run partner:sandbox ping|decide|events|listen` plays the partner side.
- Audit actor type `partner` (the API key's id): proposal fetches and decisions are attributed to the key.

### Stage 12: credit proposals, simulated partner lender, staff review

- **Consent:** a separate, versioned **"Share with a partner lender"** consent (`lender_sharing` v1), given from the
  confirmed check (or `POST /api/v1/consents/lender_sharing`). Once given, every confirmed check becomes a proposal
  and is sent automatically (user decision) — except **fraud-review cases, which are held** until a risk admin
  releases them with a reason. Withdrawing cancels unsent proposals; sent ones stay with the lender.
- **Proposal** (`fin.credit_proposals`): frozen at creation (DB trigger), SHA-256 of its canonical JSON, the consent
  receipt it relies on. **Data groups** come from the lender config's `proposalProfile` (partnership terms; edited
  in `/ops` with maker-checker); default = minimum: request, Financial Capacity, both model results, bank coverage,
  fraud summary. A group the creator's consent version doesn't cover is never sent (blocked + audited). No PII,
  line items, handles or raw Professional Graph values in the minimum; fraud reason codes are stripped when the
  fraud summary isn't shared.
- **Sending** locks the check (`submitted`) in the same transaction that re-checks consents and that the check is
  exactly what was confirmed; the proposal is `sending` while the lender call is in flight, so an edit or a
  withdrawal can't race it. Failures retry with backoff (5 attempts → `failed`, staff retry); interrupted sends are
  requeued by the sweep; one proposal per underwriting run.
- **Simulated partner lender** (`mock_re`): applies the **simulated lender policy** — versioned in
  `ops.simulated_lender_policies`, maker-checker (a different risk admin approves; DB-enforced), default v1:
  decision basis **Traditional** (user decision), worst grade D, ₹2,00,000 cap, 12 months, no missed payments,
  at least partial bank coverage, ≥ 50% completeness. Decisions: approved / approved with changes / not approved,
  with `RE_*` reasons. Real lenders apply their own policy — the policy is only sent to simulated adapters.
- **Staff review** (`/admin/proposals`): queues for release, review, failed; a proposal page shows exactly what the
  lender receives, the decision and the review. A risk admin **confirms or overrides** (reason required); an
  override can never be more favourable than the lender's decision. Creators see a decision only after review.
- **Creator view:** "Preparing to send" (held cases look the same — fraud review is never shown) → "With a partner
  lender" → **"Partner-lender decision"** with outcome, amount and tenor, labelled **Simulated pilot**, "subject to the
  lender's final checks and documents. CreatorCo is not a lender."
- **Models & rules** (`/admin/models`): read-only underwriting weights and affordability policy, Financial Capacity
  features, cashflow-analysis rules, fraud checks and thresholds; the simulated lender policy (active version,
  proposals, history, propose form).
- Job `process_lender_proposals` (every 5 min): interrupted sends, due sends, pending decisions, and proposals for
  checks shared through the API.

### Stage 09b: several bank accounts, several numbers, explicit Review

- **Flow:** consent → details → credit check → bank accounts → **Review** → check complete. Every step has a back
  link; completed steps can be revisited. Nothing is computed until the creator presses **Confirm and prepare
  recommendation** on Review. Any change afterwards (details, bank accounts, coverage answer) sends the check back to
  Review; confirming again computes a new Financial Capacity run (identical inputs reuse — and pin — the earlier run).
  "Close this check" is now a quiet **Discard this check** disclosure.
- **Purposes:** up to three (main one first) from a richer list, plus a ≤140-character note when "Something else" is
  picked. The note is never logged or audited and is erased with the inputs.
- **Bank accounts via the Account Aggregator** (`cashflow-service.ts`): one AA journey per mobile number
  (`fin.cashflow_sessions`, last four digits + keyed fingerprint only — never the number), several accounts per
  journey (`fin.cashflow_accounts`, one row per account per check — the same account found through two numbers is
  kept once). Numbers the AA verifies _inside_ its journey are supported where the AA allows it. Up to 3 numbers and 8
  attempts per check. **Try again** re-runs a number (missing/timed-out accounts, declined, unfinished);
  **Share more accounts** re-runs a completed number to add accounts left out.
- **Recovery, never zero income:** "no accounts found" or every account failing makes the step `unavailable` with
  recovery steps (try the bank-registered number, bank not on AA, continue without). No months are recorded as ₹0.
- **Coverage:** after data arrives the creator answers "Have you shared every account where you receive creator
  income?" (no → reason). Coverage = `none` / `partial` (creator said some are missing, or an account didn't arrive) /
  `complete`. New accounts reset the answer.
- **Analysis** (`cashflow-analysis.ts`, `cfa-0.1.0`, pure): own-account transfers netted (equal amount across shared
  accounts within 2 days, or self/own-account narration); creator income = platform payouts, brand/agency payments,
  affiliate commissions only; refunds, reversals and cash deposits excluded. Per-account months → the check's monthly
  totals (`own_transfers_excluded`, `accounts_contributing`).
- **Line items inside guardrails** (user decision): `fin.fi_transactions` and `fin.fi_vendor_analytics`, narration /
  counterparty / analytics AES-256-GCM-encrypted (bound to the check), deleted when the AA consent's data-life ends
  (`purge_expired_fi_data` job) or the check is erased. Mock/sandbox data is stored; live data only with
  `FI_LIVE_LINE_ITEM_RETENTION=true`. Derived per-account and monthly totals stay with the check until it is erased.
- **Income policy** (user decision): `fin-0.2.0` measures EMIs against **bank-verified creator income only** and
  compares declared vs observed income only with complete coverage; adds `bank_accounts_shared`,
  `bank_accounts_not_received`, `bank_coverage`. `uw-0.3.0` drops the declared-income haircut: no verified income →
  `refer` with no amount (`NO_VERIFIED_INCOME`); partial coverage → `PARTIAL_BANK_COVERAGE`, confidence ≤ medium.
- Consent **financial_eligibility v4** describes statements, multiple numbers, encryption and data-life.
- **Mock AA** (`/connect/aa-mock`): accounts depend on the number's last digit — 0 none · 5 three (savings, current,
  savings) · 9 two, the second times out until retried · otherwise one or two. Account checkboxes, and "Add another
  mobile number" with a simulated OTP (any 6 digits). Synthetic transactions include AdSense payouts, brand payments,
  affiliate income, cash deposits, refunds, gifts and transfers between the creator's own accounts.
- **Live integration needs** (AA/FIU vendor via the RE): a vendor adapter implementing `capabilities()`,
  `interpretReturn()`, `requestConsent({ mobile | retryOf })`, `fetchData()` — multi-account selection
  (`accountSelectionMode: multi`), the AA's additional-number option where offered, per-account FI status
  (READY/DELIVERED/TIMEOUT/DENIED), a fresh data session for retries under the same consent, consent data-life ≤ 90
  days, a separate consent artefact per purpose, and the RE as FIU of record. Joint accounts and banks not on the AA
  network show up only as "missing" — the creator's coverage answer is the only signal.

### Stage 10: Underwriting Engine v0

- `modules/underwriting/model.ts` (`uw-0.2.0` since Stage 11, pure): seven components scored 0–100 — Financial Strength,
  Income Stability, Creator Business Stability, Revenue Diversification, Professional Longevity, Audience
  Authenticity, Brand Recurrence — with the CLAUDE.md hypothesis weights (35/20/15/10/10/5/5).
  **Traditional** uses only the first two (re-normalised); **Creator-Enhanced** uses all seven. Missing components
  are dropped and lower completeness/confidence; Brand Recurrence is always missing until brand data exists.
- Grades A ≥ 80 · B ≥ 65 · C ≥ 50 · D ≥ 35 · E. No bureau summary or < 50% completeness → `refer`. Grade E →
  `not_recommended`.
- **Exposure (affordability-based, user decision):** total EMIs ≤ 40% of monthly income (verified creator income from
  bank data, else declared × 0.7). The affordable EMI is converted to a principal over 12 months at a **20% p.a.
  reference rate** (an assumption for sizing only — pricing is the lender's), capped by grade (A 3× · B 2× · C 1.25× ·
  D 0.6× monthly income) and by the amount requested, rounded down to ₹5,000.
- Each run freezes its inputs into `fin.underwriting_inputs` (financial, application and — only with professional
  analytics consent — Professional Graph values), stores both results with component scores and reason codes, and is
  reproducible from the stored snapshot (`verifyUnderwritingReproducible`). Identical inputs reuse the run; runs are
  append-only.
- Runs are prepared automatically when a check's inputs are ready. Creators see only that a recommendation is
  **prepared** — no figures until a partner lender has reviewed it (Stages 12–13). Staff compare both models at
  `/admin/underwriting`; opening a run is audited.
- The `financial_eligibility` consent is now **v2**, which explicitly covers combining financial inputs with the Creator
  Professional Profile and signals. Erasing a check, or withdrawing professional analytics, also erases unsent
  recommendations.

### Stage 11b: several accounts per platform

- A creator can connect up to **3 accounts per platform** (assumption, `MAX_ACCOUNTS_PER_PLATFORM`): Passport shows
  "Add another {platform} account" once one is connected. Each extra account is its own verified row with **no
  declared handle** (so it never triggers a false "handle differs" signal); only the account that upgraded the
  self-declared row keeps the declaration.
- Exactly one **primary** account per platform (partial unique index; backfilled by migration 0017). The first
  connected account is primary; the creator can switch it, and disconnecting the primary promotes the next one.
- Professional Graph `pg-0.2.0`: `connected_platforms` counts distinct platforms (accounts in provenance) and
  `platform_concentration` sums audience per platform before the HHI, so two accounts on one platform don't look
  diversified. `total_audience` still sums all accounts (may double-count shared audiences).
- API: `additional` on `POST /social/connections`; `POST /social/accounts/{id}/primary`.

### Stage 11: fraud / authenticity engine

- `modules/fraud/rules.ts` (`fraud-0.1.0`, pure): nine deterministic checks producing explicit flags with a severity —
  never a weighted score (CLAUDE.md §13). Thresholds are hypotheses:

  | Check                                                                    | Severity      | Consent it runs under       |
  | ------------------------------------------------------------------------ | ------------- | --------------------------- |
  | Name differs from identity lookup (token match < 0.5 / < 0.8)            | high / medium | financial eligibility       |
  | Same PAN on another account (keyed fingerprint)                          | high          | financial eligibility       |
  | PAN changed between this creator's checks                                | medium        | financial eligibility       |
  | Declared income > 2.5× / > 1.5× creator income seen in bank data         | high / medium | financial eligibility       |
  | Connected handle differs from declared handle                            | medium        | financial eligibility       |
  | Declared “creator since” > 24 months before the oldest connected account | low           | financial eligibility       |
  | Follower spike (Professional Graph)                                      | medium        | professional analytics only |
  | Engagement > 20% at ≥ 10k audience, or < 0.2% at ≥ 50k                   | medium        | professional analytics only |
  | 3+ eligibility checks in 90 days                                         | low           | financial eligibility       |

- Every underwriting run stores a `fin.fraud_checks` row (inputs as numbers/booleans only, which checks ran or didn't,
  outcome `clear` / `watch` / `review`) plus `fin.fraud_flags` with evidence values. Names, PAN fingerprints and handles
  are compared in `underwriting/fraud-inputs.ts` and never stored with the run. The run hash covers both input sets;
  `verifyUnderwritingReproducible` replays both. Append-only; erased with the check.
- **Effect (user decision):** a high-severity flag routes `recommend` → `refer` with `FRAUD_REVIEW`; scores, grades
  and exposures are untouched, and CreatorCo never auto-declines. Lower flags add `FRAUD_WATCH`. Creators never see
  fraud results.
- **Duplicate identity (user decision):** `credit_applications.pan_fingerprint` = `v1:` + HMAC-SHA256(PAN,
  `PAN_FINGERPRINT_SECRET`), set at the credit check and erased with the check's inputs. The secret is required
  outside development/test.
- Financial eligibility consent is now **v3**, which discloses the fraud checks and the PAN fingerprint. A check opened
  under v2 asks for the new consent once (the start page shows the updated text) and then carries on unchanged.
- Name matching compares exact tokens first, then initials, in any order; names without comparable Latin tokens (e.g.
  Devanagari) report the check as not run rather than as a mismatch.
- Withdrawing identity-prefill or social-connection consent also erases unsent recommendations, because their fraud
  checks hold values derived from that data.
- Risk console: fraud section on each run, a review-rate tile, review badges in the run list and flag counts.

### Stage 10b: integration control plane (`/ops`)

- **Routing is configuration.** `ops.provider_configs` (adapter, mode mock/sandbox/live, enabled, strict non-secret
  settings, secret _references_) and `ops.provider_routes` (primary, fallback, kill switch) decide which adapter serves
  each capability. Business code calls `await getProviders()` (`modules/integrations/registry.ts`); adapters are listed
  in the code catalog `src/providers/catalog.ts`. Mock configs never serve production traffic.
- **Secrets stay in the hosting secret store.** A config maps each secret the adapter declares to an env var whose name
  must start with `INTEGRATION_` (so a config can't point at `DATABASE_URL` etc.). `/ops` shows only set/missing.
  Going live = set the env vars, add a config for the vendor adapter, get it approved, route to it.
- **Circuit breaker + failover.** Every routed call is timed out (default 10 s) and counted hourly
  (`ops.provider_call_stats`, outcomes and timings only). 5 consecutive failures open the primary's circuit; new calls
  then go to the fallback. After 60 s one probe call goes back to the primary and a success closes the circuit.
  Rejections (bad code, unknown reference) never count. A failed call is **not** retried on another provider (OTP and
  bureau enquiries aren't idempotent, and stored data names the provider that produced it). A social or Account
  Aggregator flow interrupted by a switch asks the creator to start again (`provider_changed`).
- **Maker-checker (approved policy: risky changes only).** Every change is an `ops.integration_change_requests` row.
  Route changes, sandbox/live configs, edits to a routed config and lifting a kill switch wait for a second ops admin
  (requester ≠ approver, also a DB CHECK). Engaging the kill switch and adding/editing unrouted mock configs apply at
  once. Approval re-checks the versions the request was based on (stale → `superseded`); requests expire after 48 h;
  decided requests are immutable. Everything is audited.
- **Jobs.** `ops.jobs` is a Postgres queue (`FOR UPDATE SKIP LOCKED`) with backoff (30 s doubling, max 1 h), a dead
  state and stuck-job recovery. Schedules: expire stale eligibility checks (hourly), complete deferred erasures
  (hourly), provider health checks (5 min). A cron calls `GET /api/internal/cron/tick` with
  `Authorization: Bearer $CRON_SECRET` (e.g. Vercel Cron `*/5 * * * *` — Pro plan; Hobby allows daily only). Locally:
  `npm run jobs:tick`, or **Run now** in `/ops/jobs`.
- **Access.** New `ops_admin` role: `/ops` only (404 elsewhere). `risk_admin` can't see `/ops`; `super_admin` sees both.
  The risk console's provider list is now a read-only summary of the routing.

### Design system: pinned release

The app runs **design-system v2.0.0**, pinned in `design-system.lock.json`. `npm run ds:check` (run before `dev`,
`build` and in `npm run check`) fails if a release-owned file changed, a new design-system file appeared, app code
imports from `design-system/`, or Tailwind's scan isn't limited to `src/`. Upgrades only on authorization:
`ds.mjs adopt` → `npm run ds:pin -- <version> --authorized-by "…"` → checks and `npm run ds:screens`. Full runbook,
guards and rollback: [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md).

### Native apps

The API and shared pure modules are documented in [`docs/API.md`](./docs/API.md) and
[`docs/MOBILE.md`](./docs/MOBILE.md). Web sessions are cookie-only; native/API sessions are bearer-only.

### Data-security notes

- No full PAN, Aadhaar, bureau or card data is stored. Identity lookups keep only a masked PAN. AA bank line items
  are stored only inside the 09b guardrails (encrypted, `fin` only, data-life-bound; live behind a switch).
- Mobile numbers searched at the AA are never stored (last four digits + a keyed fingerprint per check).
- **GSTIN embeds the holder's PAN.** It is treated as a restricted field:
  - it is never logged, never written to audit metadata and never shown in admin views;
  - its retention should be confirmed by counsel.
- Audit metadata goes through `sanitiseAuditMetadata`, which rejects sensitive-looking keys and non-scalar values. A DB
  CHECK caps its size.
- The logger redacts sensitive keys, form payloads are never logged, and DB query logging is off.

---

## Testing

- **Unit** (`tests/unit`): GSTIN checksum, GST/legal-form rules, cohort classification, step navigation, profile
  completion, step schemas, consent version rules, audit sanitiser, role policy and safe redirects, password hashing,
  and provider mocks.
- **Integration** (`tests/integration`, real Postgres rebuilt from migrations on every run):
  - schema, RLS and constraint guards;
  - auth: signup, duplicate, login, lockout, suspension, expiry, revocation;
  - the full onboarding service flow, including GST capture and clearing;
  - consent versioning and withdrawal;
  - seed idempotency.
- **Stages 05–07**: engine unit tests (determinism, each formula, nulls/completeness, hash stability) and integration
  tests for connection (state misuse, expiry, single use, linked elsewhere, idempotent ingest, run reuse and
  reproducibility, append-only runs, consent gating, disconnect/reconnect, Passport editing, session channels).
- **E2E for Stages 05–07** covers the Passport connect/cancel/disconnect/edit flows,
  appearance switching, the iPhone tab-bar layout and the API v1 contract (`e2e/api.spec.ts`).
- **E2E** (`e2e`, Playwright against a production build):
  - the full sign-up → six-step onboarding → dashboard journey on desktop and mobile;
  - the GST conditional field and GSTIN validation;
  - persisted DB state;
  - route protection, creator → `/admin` 404, risk_admin access, auth-page bounce and open-redirect protection.

---

## Known limitations (this stage)

- No email verification or password reset yet. `NotificationProvider` exists but only supports SMS OTP so far. Sign-up
  reveals whether an email is registered.
- Identity, GST and SMS providers are **mocks**. Choosing vendors and the data-rights and DPDP review of "mobile → PAN"
  lookups are open items for counsel.
- Login throttling is per account (email hash). There is no IP or global rate limit yet.
- No Content-Security-Policy header yet. Other security headers are set in `next.config.ts`.
- Consent withdrawal exists as an audited service primitive only. The creator-facing journey is Stage 08.
- Consent text is **draft** and pending counsel review.
- Social data is **mock only**. A vendor adapter (and each platform's API terms) is still to be chosen.
- Withdrawing consent now erases data (see Stage 08). Disconnecting a single account still keeps its snapshots; that
  retention period should be set with counsel.
- Which data a partner lender's retention rules actually cover (and for how long) must be confirmed with the RE and
  counsel before the real `RetentionHoldChecker` is built.
- Underwriting weights, bands, the 40% EMI ceiling and the 20% reference rate are hypotheses to be replaced by the
  partner lender's policy; nothing claims creator signals reduce default risk.
- Stale-check expiry and deferred erasures now run as scheduled jobs, but only once a cron is pointed at
  `/api/internal/cron/tick` (or `npm run jobs:tick` is run).
- Account closure/deletion isn't built yet.
- Only mock adapters exist in the catalog. Each real vendor adapter (KYC, bureau, AA, SMS, social) still needs building,
  plus its contract terms. Quotas, % rollouts, partner API keys and signed inbound webhooks are deferred (10c).
- Fraud thresholds are untested hypotheses (e.g. two names sharing only a surname score 0.5 → medium, not high).
  Duplicate-PAN detection only sees checks whose inputs haven't been erased (closed/expired checks drop their
  fingerprint), so "PAN changed between checks" mostly compares against checks sent to a lender. No device or network
  fingerprinting yet. Rotating `PAN_FINGERPRINT_SECRET` stops matching across key versions until a `v2` is introduced.
- Whether fraud prevention is a legitimate use that may run without professional-analytics consent, and how long a PAN
  fingerprint may be kept for fraud purposes, are open counsel items.
- Health checks are informational; routing reacts to real call failures. Circuit state is shared through Postgres
  (routing snapshots are cached for 5 s per instance).
- The mock authorisation screen needs a browser session, so native apps can't complete a mock connection through it.
  The API test passes the mock `code` directly (see docs/API.md).
- No native apps yet (per CLAUDE.md). The API and design tokens are ready for them.
- **Stage 12 limits:** the retention hold is per creator and doesn't end yet (a reviewed decision doesn't close the
  check); a held fraud-review check stays "Preparing to send" until staff act (set an SLA); the lender adapter
  must be idempotent on `proposalId` (a late success after a timeout can be retried); admin nav reuses existing
  icons (new icons would be a design-system release).
- **Stage 13 open items:**
  - **Counsel / RE:**
    - Whether the 3-day cooling-off minimum and the KFS fields match the partner's obligations.
    - Retention for accepted offers. They are held without end, and there is no partner "closed / not disbursed"
      event yet.
    - The DPDP storage limitation for declined or expired data kept until withdrawal (user decision).
    - CreatorCo's own grievance contact as the lending service provider isn't shown yet (needs the real details).
  - Creators aren't notified when a decision or offer arrives (notification templates come later).
  - Only one partner name per lender config, so a partner's offers must use exactly that name.
- **Stage 12b limits:**
  - mTLS, IP allowlists and rate limiting for partner calls belong at the edge and aren't built.
  - A DNS-rebinding window remains for webhooks until delivery goes through an egress proxy that pins addresses.
  - Partner events and delivery logs (ids and HTTP statuses) have no retention period yet (open item).
  - A single ops admin can rotate a webhook signing secret (webhooks are thin).
  - `PARTNER_WEBHOOK_ROOT_KEY` is now required in staging and production.
- **09b open items for counsel / the RE:** storing live AA line items (switch off until sign-off); whether derived
  monthly totals may outlive a shorter AA data-life (today they follow the check's 90-day life); the creator-income
  keyword rules (`cfa-0.1.0`) are untuned hypotheses.
- With live line items **not** retained, transfers between accounts shared through _different_ journeys can only be
  netted for the accounts analysed together; earlier accounts keep the totals computed when they arrived. Creator
  income is unaffected (it needs positive classification), but inflow totals can include such transfers.
- Averages use months with activity; a month with no transactions in any shared account has no row.
