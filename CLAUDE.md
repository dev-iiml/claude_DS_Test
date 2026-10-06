# CreatorCo — repository notes for Claude

The authoritative product, architecture and regulatory context is the **CreatorCo Project Knowledge File**. It is kept
in the claude.ai Project "DS_Test" as `CLAUDE.md`. Place a copy at `docs/PROJECT_KNOWLEDGE.md` so the import below
loads it. Read it before any product, architecture, data, underwriting, regulatory or UX decision.

@docs/PROJECT_KNOWLEDGE.md
@AGENTS.md

## Build status

Stages 00–13 are complete: foundations, design system (mobile-first, iOS/macOS patterns, dark default), core schema,
self-managed auth and roles, Cohort A0 onboarding, Creator Passport, social connection (mock provider), the
Professional Graph feature engine, the consent centre (receipts, withdrawal, hold-aware erasure, paused membership),
financial eligibility (separate `fin` schema, Financial Capacity features), Underwriting Engine v0 (Traditional vs
Creator-Enhanced, reproducible runs), the integration control plane (`/ops`: config-driven provider routing,
circuit breaker/failover, kill switch, maker-checker approvals, Postgres job queue), the fraud/authenticity layer
(`fraud-0.1.0`, explicit flags, high → refer), several accounts per platform (11b), multi-account / multi-number
Account Aggregator sharing with an explicit Review → confirm step and bank-verified-income-only underwriting (09b:
`fin-0.2.0`, `uw-0.3.0`, `cfa-0.1.0`), credit proposals to a simulated partner lender with staff confirm/override,
a "Share with a partner lender" consent, the Models & rules page and a maker-checker simulated lender policy (12),
the partner API with hashed maker-checker API keys, thin HMAC-signed webhooks, a vendor-neutral `partner_api` lender
adapter and confirm-or-query review of partner decisions (12b), the creator's offer screen with partner-provided terms
and KFS, accept/decline with a purpose-specific handoff consent and per-check retention holds (13), plus API v1 for
future native apps.

## Implementation conventions (established in Stages 00–04)

- Domain logic lives in `src/modules/<domain>`. Routes in `src/app` are thin: authorise (`requireCreator` /
  `requireAdmin`), validate (Zod schema from the module), call the module service, then redirect.
- Services take a `db`/`tx` argument (`DbExecutor`), so tests can run them against a real database.
- Never trust a role from the client. Read it from `users.role` via `modules/identity/dal.ts`.
- Schema changes go in `src/db/schema/*` → `npm run db:generate` → review the SQL.
  - Triggers, grants and reference data go in a `drizzle-kit generate --custom` migration.
  - Never edit an applied migration.
- Evolving vocabularies use reference tables. Stable state sets use `text` + `CHECK`.
- Consent text changes mean a **new version** in `src/modules/consent/definitions.ts`. Published versions are immutable
  in the DB.
- Audit events go through `recordAuditEvent`. Metadata holds small scalars only, and sensitive keys are rejected.
- GSTIN is a restricted field (it embeds PAN). Never log it, audit it, echo it in form state or show it in admin views.
- Providers: depend on interfaces in `src/providers/*/types.ts` and obtain instances with `await getProviders()` from
  `@/modules/integrations/registry` (or `resolveProvider(deps, kind)` when you hold a `db`). Do not use vendor names
  in DB columns. A vendor adapter is added to `src/providers/catalog.ts` with its secret names and a **strict**
  settings schema; adapters throw `ProviderError("rejected" | "unavailable" | "timeout")` so the circuit breaker can
  tell a refused request from an outage. Which adapter serves traffic is configuration in `/ops`, never code.
- The `ops` schema holds control-plane config, runtime state, approvals and jobs — no creator or financial data and
  no secrets (env var names only, `INTEGRATION_*`). Config changes go through `proposeChange` (maker-checker).
- Background work is a job type in `modules/jobs` (idempotent handler returning counts; payloads hold ids only).
- The app is **pinned to design-system release v2.0.0** (`design-system.lock.json`, docs/DESIGN_SYSTEM.md). Files the
  release owns (`src/design`, `src/components/ui`, `src/components/creatorco`, `globals.css`, `tokens.css`, …) are not
  edited directly and no files are added there; `npm run ds:check` (pre-dev, pre-build, `npm run check`) enforces it.
  Never import from `design-system/`. Upgrades/rollbacks happen only when Aman authorizes them: review the release,
  `ds.mjs adopt|rollback`, `npm run ds:pin`, full checks incl. the dark/light × mobile/desktop screen spec. Never
  adopt "latest", candidates, drafts or experiments; selected modules go through a compatible release first.
- Pure modules (engine, presentation, rules, schemas, tokens) must not import Node/DOM/Next APIs, so native apps can
  reuse them. Hashing etc. lives in separate files.
- Every new user-facing capability gets a JSON route under `src/app/api/v1` (bearer sessions only) alongside the web UI.
- Choice controls stretch the native input over the row; in E2E use role-based `check()`, not text clicks.
- Withdrawal effects live in `modules/privacy/purposes.ts`; domain modules own their own erasure functions. New data
  tied to a consent purpose must be added to that purpose's erasure scope.
- Credit-related retention is expressed as a `RetentionHoldChecker`: holds defer erasure only; processing
  always stops at once.
- The `fin` schema is the regulated financial domain: only `modules/financial-eligibility`, `modules/underwriting`
  and `modules/lending` read or write it (partner API routes reach it only through `modules/lending`). It holds
  derived summaries, a keyed PAN fingerprint, and — user decision, Stage 09b — AA line items and vendor analytics
  **inside guardrails** (`fi_*` tables: sealed with `fi-data-protection.ts`, bound to the AA data-life, erased with
  the check; live data only when `FI_LIVE_LINE_ITEM_RETENTION=true`). Never a full PAN, full mobile number or bureau
  report. Never join it into professional tables.
- Eligibility computes nothing until the creator confirms on Review; any change afterwards calls
  `reopenIfConfirmed`. Income for affordability is bank-verified creator income only (never declared income), and
  "no accounts found" is never treated as zero income.
- Underwriting weights/policy live in `modules/underwriting/model.ts`; any change bumps `UNDERWRITING_MODEL_VERSION`.
  Creators never see recommendation figures before a partner-lender review.
- Fraud rules live in `modules/fraud/rules.ts` (pure, numbers/booleans in, flags out); any change bumps
  `FRAUD_RULES_VERSION`. Fraud is never a weighted score; it only routes to `refer`. Fraud results and the keyed PAN
  fingerprint are stored by `modules/underwriting` / `modules/financial-eligibility` in `fin` and are never shown to
  creators.
- Lender proposals (`modules/lending`): frozen payloads built from the lender config's `proposalProfile`, never
  beyond `LENDER_SHARING_SCOPES` for the creator's consent version (a broader profile needs a new consent version).
  Sending locks the check; fraud-review cases are held for staff release; creators see a decision only after a
  staff review, and an override is never more favourable than the lender's decision. The simulated lender policy
  changes only through `proposePolicy`/`decidePolicy` (four eyes) and is sent only to mock lenders.
- Partner access (`modules/partners`, `ops` schema, ids only): a partner is bound to one `partner_api` lender config
  in its own environment (checked at creation and on every call). API keys are SHA-256 hashed, shown once, issued
  by one ops admin and approved by another; webhook URLs need a second ops admin; signing secrets are derived from
  `PARTNER_WEBHOOK_ROOT_KEY`, never stored. Webhooks carry identifiers only — partners fetch through
  `/api/partner/v1` (docs/PARTNER_API.md). Record events with `recordPartnerEvent(tx, …)` inside the transaction
  that makes the change (it locks the partner row so the feed is commit-ordered). Partner reads/writes never touch
  simulated-lender proposals. Staff confirm or query a partner's decision (never change it); reviews name the
  revision they act on.
- Offers (Stage 13): terms and KFS are the lender's (`offerTermsSchema`, validated to add up); the simulated lender's
  are illustrative (policy pricing). Creators accept the exact terms shown (`termsHash`); the `lender_handoff`
  consent is granted inside `acceptOffer`. Retention holds are per check (`heldLenderCheckIds`); declined/expired
  offers are kept until withdrawal and then erased via the hold checker's `releasedApplications`.
- Before handing off, run `npm run check`, then `npm run build && npm run test:e2e`.
