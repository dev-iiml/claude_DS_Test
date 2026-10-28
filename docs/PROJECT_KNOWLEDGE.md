# CreatorCo — Project Knowledge File

> **Purpose:** This file is the persistent project context for Claude while building the CreatorCo MVP.
> Read this file before making architectural, product, data, UX, or implementation decisions.
>
> **Project stage:** Phase 1 / Minimum Fundable Product
> **Primary geography:** India
> **Initial cohort:** Cohort A0 — individual / sole-proprietor professional creators who are not incorporated and are not currently required to register for GST.
> **Regulatory posture captured from project research through:** 14 September 2026.
> **Important:** Regulatory assumptions must be revalidated with counsel and the relevant regulated entity before any live lending, card issuance, bureau access, Account Aggregator integration, or disbursement.

---

## 1. Product Vision

CreatorCo is a premium financial and professional network for creators.

The long-term product combines:

1. creator professional identity,
2. creator-specific underwriting intelligence,
3. financial access through regulated banks/NBFCs,
4. premium status and membership,
5. PR / brand opportunities,
6. rewards and experiences,
7. creator-business financial services.

The core idea is:

> **Your influence opens doors. Your business earns the limit.**

CreatorCo should never feel like a payday-loan or generic personal-loan app.  
The product should feel like a premium creator membership and financial identity.

Long-term mental model:

> premium financial membership + creator underwriting infrastructure + creator commerce network.

---

## 2. MVP Objective

This MVP is **not** intended to issue real credit on day one.

It is a **validation-grade, investor-grade and issuer-grade product** designed to prove:

> **Can creator-professional information add useful predictive or decisioning value beyond conventional financial underwriting?**

The MVP should eventually support real users and real creator data, while financial integrations can initially use sandbox/mock adapters.

The MVP should be architected so that mock integrations can later be replaced by production vendors and regulated partners without rewriting core product logic.

### Minimum Fundable Product target

The product should be capable of supporting the path to:

- 50–200 genuine creators in early validation;
- real Creator Passport profiles;
- at least 1–2 live social-data integrations;
- a working Creator Professional Graph;
- a real explainable underwriting engine;
- a real lender-consumable credit proposal;
- an issuer/NBFC design partner or pilot;
- controlled use of real financial data once the RE architecture is approved.

---

## 3. Initial Customer — Cohort A0

### Definition

Cohort A0 is an individual professional creator who:

- is an Indian resident;
- is not incorporated as a company or LLP;
- operates personally or as a sole proprietor;
- is not currently required to register for GST;
- has a PAN and bank account;
- earns or is beginning to earn creator-related income;
- has established social/content activity;
- can provide verifiable creator-professional information;
- is willing to connect selected creator accounts;
- may opt separately into financial-product eligibility.

### GST rule

Do **not** equate “individual creator” with “GST exempt.”

GST registration status is separate from legal form.

The application data model must support:

- `gst_status = not_registered`
- `gst_status = registered`
- `gst_status = unknown / requires_review`

Do not make legal conclusions about whether the creator is required to register.  
The UX may inform the user that financial/tax status may need updating as the creator grows.

### Future cohorts

#### A1 — GST-registered sole proprietor
Same individual creator identity, now GST registered.

#### B — Incorporated creator business
LLP, private limited company, production company, studio, or other business entity.

Do not build Cohort B-specific banking architecture in Phase 1.

---

## 4. Business Strategy

CreatorCo follows six strategic principles.

### 4.1 Own professional identity, not the balance sheet

CreatorCo should own:

- Creator Passport;
- Creator Professional Graph;
- creator-specific features;
- creator underwriting IP;
- premium UX;
- status;
- rewards;
- brand network;
- creator opportunities.

Banks/NBFCs should own:

- regulated credit exposure;
- sanction;
- regulated credit ledger;
- repayment ledger;
- regulated collections;
- card transaction ledger;
- bureau reporting;
- regulated financial records.

### 4.2 Start narrow and exclusive

Initial focus:

- professionally monetising or high-potential creators;
- initially strongest in beauty, fashion, lifestyle, travel, food, fitness and tech;
- invite / referral-led positioning rather than mass unsecured-credit positioning.

### 4.3 Credit is acquisition; access is retention

Credit creates a strong reason to join.

Long-term retention comes from:

- status;
- brand access;
- PR;
- rewards;
- events;
- experiences;
- creator network;
- financial utility.

### 4.4 Brands can subsidise premium benefits

Brand-supplied inventory can include:

- PR products;
- launch access;
- events;
- hospitality;
- stays;
- creator experiences;
- campaigns.

This can generate high perceived reward value at lower economic cost than traditional cash-funded rewards.

### 4.5 Build longitudinal creator intelligence

The valuable dataset is not just followers or likes.

CreatorCo should understand:

- professional longevity;
- creator income durability;
- brand recurrence;
- audience quality;
- platform concentration;
- revenue diversification;
- commercial reliability;
- creator commerce performance.

### 4.6 Grow with the creator

A0 → A1 → B → Creator Enterprise.

The Creator Passport should persist across that lifecycle.

---

## 5. Core Value Propositions

### Creator CVP

> **Be recognised for the business you have actually built.**

CreatorCo gives professional creators a premium professional identity, financial eligibility experience, access and brand opportunities designed around creator economics rather than salaried employment.

### Bank / NBFC CVP

> **Acquire and understand a high-growth customer segment that traditional underwriting may classify poorly.**

CreatorCo provides:

- creator acquisition;
- creator-specific data;
- creator feature engineering;
- explainable risk intelligence;
- underwriting recommendations;
- creator UX.

The RE provides:

- regulated lending policy;
- sanction;
- balance sheet;
- financial ledger;
- regulated servicing.

### Brand CVP

> **Reach verified creators who want your brand and measure what happens after activation.**

---

## 6. Core Competencies to Build In-House

These are strategic IP and should not be outsourced as the primary implementation.

### 6.1 Creator Passport
Verified professional creator identity.

### 6.2 Creator Professional Graph
Longitudinal creator-professional data.

### 6.3 Creator Feature Engine
Transforms creator data into structured features.

### 6.4 Creator Underwriting Engine
Combines permitted financial features and creator-professional features.

### 6.5 Fraud / Authenticity Engine
Detects suspicious creator, audience and application patterns.

### 6.6 Decision / Offer Recommendation Engine
Produces lender-consumable recommendations with explainable reason codes.

### 6.7 Lender Orchestration Layer
Abstracts multiple banks/NBFCs behind provider interfaces.

### 6.8 Premium Creator UX
Onboarding, membership, status, offers, access.

### 6.9 Brand / Creator Matching
Not required in full for Phase 1 but architecture should allow it later.

---

## 7. Competitive Advantages to Build

Do not claim these are already moats. They are target advantages.

1. **Creator Professional Graph**
2. **Creator-specific underwriting intelligence**
3. **Longitudinal creator-business data**
4. **Three-sided network: creators ↔ CreatorCo ↔ financial institutions / brands**
5. **Brand-subsidised premium rewards**
6. **Premium creator status network**
7. **Creator career lifecycle ownership**
8. **Compliance-aware creator marketplace**
9. **Multi-lender orchestration**
10. **Creator-specific model governance and explainability**

---

## 8. Phase 1 MVP Scope

### Build now

1. Authentication
2. Creator onboarding
3. Creator Passport
4. Social-account connection abstraction
5. Creator Professional Graph
6. Creator Status
7. Financial eligibility consent
8. Financial-input flow
9. Provider adapter architecture
10. Creator Feature Engine
11. Underwriting Engine v0
12. Fraud / authenticity features
13. Traditional-vs-CreatorCo comparison
14. Credit Proposal
15. Simulated RE decision
16. Creator dashboard
17. Internal Risk/Admin dashboard
18. Consent audit trail
19. Decision audit trail
20. Seed/demo data
21. Basic PR / Access preview
22. Analytics instrumentation

### Do not build yet

- real lending;
- real disbursement;
- real repayment collection;
- actual card issuance;
- actual UPI credit;
- own PPI/wallet;
- live card transaction processing;
- production collections;
- full concierge operation;
- large PR marketplace;
- native mobile apps;
- microservices;
- unvalidated black-box ML;
- securities recommendations / investment-advice functionality.

---

## 9. End-to-End MVP User Flow

```text
Landing
  ↓
Apply / Join CreatorCo
  ↓
Create account
  ↓
Basic creator profile
  ↓
Connect creator/social accounts
  ↓
Creator Passport generated
  ↓
Creator Professional Graph updated
  ↓
Creator Status calculated
  ↓
User chooses "Check Financial Eligibility"
  ↓
Separate financial consent
  ↓
Financial inputs / mock or sandbox provider data
  ↓
Creator Feature Engine
  ↓
Traditional Underwriting Model
  +
Creator-Enhanced Underwriting Model
  ↓
CreatorCo Credit Proposal
  ↓
Simulated RE Policy / Decision
  ↓
Approve / Modify / Decline
  ↓
Offer screen
  ↓
Creator dashboard
```

---

## 10. Regulatory / Role Architecture

### CreatorCo may act as

- creator platform;
- DLA;
- LSP;
- co-brand / distribution / experience partner depending on final structure;
- underwriting technology provider;
- analytics/model provider.

### LSP underwriting role

The product architecture should assume CreatorCo may:

- source customers;
- collect permitted information;
- process underwriting inputs;
- engineer risk features;
- run rules / models;
- generate a risk grade;
- recommend exposure;
- recommend pricing/tenor where agreed;
- generate reason codes;
- send a proposed offer to the RE.

The regulated bank/NBFC remains responsible for:

- approved credit policy;
- sanction;
- regulated lending compliance;
- final regulated accountability;
- balance-sheet exposure.

Do not hard-code an assumption that a bank employee manually reviews every application. Straight-through processing under an RE-approved policy may be supported later.

### Co-lending

CreatorCo is not a co-lender unless it itself becomes an eligible regulated entity.

CreatorCo can remain the LSP / underwriting engine in a co-lending structure between REs.

### Revolving credit

Project research through 14 Sep 2026 found RBI had proposed restrictions on ordinary NBFC revolving credit, but the proposal had not yet been treated by this project as final.

**Do not design the product such that an ordinary NBFC reusable revolving line is a hard dependency.**

Preferred long-term architecture:

- bank / appropriately authorised issuer for permanent revolving credit;
- bank/NBFC for term finance;
- bank/NBFC/factor for invoice/receivable finance.

This must be revalidated before production.

### Card transaction data

In a co-branded-card structure, assume CreatorCo cannot own or store the issuer's raw card transaction ledger.

Do not design the proprietary data moat around card purchases.

### Account Aggregator

Do not assume CreatorCo can be the direct FIU.

For MVP architecture, financial data adapters should be abstract.

Production AA architecture must be agreed with an eligible regulated FIU / RE.

### SEBI

SEBI is not the primary regulator for the CreatorCo credit/card product.

If the future brand marketplace includes finance / securities creators:

- classify creators by financial-content regulatory status;
- block or review prohibited unregistered securities recommendation activity;
- support disclosure / registration verification for relevant regulated campaigns.

This is not a Phase 1 implementation priority.

---

## 11. Data Architecture — Two Logical Planes

Never create one unrestricted “everything about the user” database.

### 11.1 Creator Professional Domain — CreatorCo strategic data

Potential CreatorCo-owned data, subject to consent, purpose, API/platform terms and legal review:

#### Identity / profile
- CreatorCo creator ID
- name
- creator handle(s)
- niche
- language
- city/general geography
- creator bio
- creator tenure
- portfolio
- professional preferences

#### Social/account data
- connected-account IDs
- follower/subscriber counts
- reach
- views
- engagement
- posting frequency
- account age
- content metadata
- growth time series
- platform mix

#### Audience analytics
Prefer aggregated data:
- audience geography
- age bands
- category affinity
- authenticity indicators
- engagement concentration

Avoid unnecessary storage of individual follower personal data.

#### Professional / brand activity
- brand relationships
- campaign history
- repeat brands
- deliverable history
- campaign performance
- delivery reliability
- offer acceptance/rejection
- response time
- creator categories

#### CreatorCo commerce data
- CreatorCo-attributed affiliate clicks
- CreatorCo-attributed conversion
- CreatorCo-attributed GMV
- category conversion performance

#### PR / access
- opportunities
- redemptions
- returns/retention
- activity
- performance

#### Derived features
- Creator Business Stability
- Professional Longevity
- Revenue Diversification
- Platform Concentration
- Brand Recurrence
- Audience Authenticity
- Growth Stability
- Commercial Reliability
- Creator Status

### 11.2 Lending / Regulated Financial Domain

Production raw financial data should be treated more restrictively.

Do not design CreatorCo's proprietary ML lake around storing:

- raw AA feeds;
- raw bank transaction history;
- raw card transaction history;
- raw bureau reports / tradelines;
- issuer repayment ledger;
- individual DPD history;
- issuer internal score;
- issuer proprietary underwriting model;
- unnecessary KYC-document archives;
- biometrics.

CreatorCo may need to process or temporarily access selected financial inputs in an RE/LSP arrangement.  
Production retention rules must be field-level, documented and approved by counsel/RE.

### Key distinction

```text
PROCESSING ≠ PERMANENT PROPRIETARY STORAGE
```

The system must support transient or controlled processing separately from long-term CreatorCo analytics storage.

---

## 12. AI / Data Science Strategy

Do not build fake AI.

### Phase 1 model families

#### A. Creator Intelligence
- professional stability
- audience quality
- platform concentration
- growth stability
- brand recurrence

#### B. Fraud / authenticity
- audience anomalies
- identity mismatch
- suspicious account changes
- inconsistent self-reported data

#### C. Creator Business Stability
This is the financial bridge.

Possible inputs:
- creator tenure
- creator income consistency
- revenue source diversity
- brand recurrence
- platform concentration
- audience authenticity
- commercial continuity

### Credit model learning architecture

Long-term:

CreatorCo owns creator feature vectors `X`.

RE owns repayment / credit outcomes `Y`.

Model validation can eventually run using:

- RE-controlled environment;
- clean room;
- privacy-preserving / federated approach;
- another counsel-approved controlled architecture.

Do not assume raw repayment outcomes can simply be copied into CreatorCo's unrestricted ML warehouse.

---

## 13. Underwriting Engine v0

The first engine is **explainable and deterministic**, not presented as statistically validated credit AI.

### Component scores

Example initial components:

```text
Financial Strength              35%
Income Stability                20%
Creator Business Stability      15%
Revenue Diversification         10%
Professional Longevity          10%
Audience Authenticity            5%
Brand Recurrence                 5%
```

These weights are a product hypothesis, not a validated underwriting model.

### Separate fraud layer

Fraud should not simply be another weighted score.

Generate explicit fraud flags such as:

- creator identity mismatch;
- suspicious follower spike;
- anomalous engagement;
- connected-account mismatch;
- declared income inconsistency;
- duplicate identity/application.

### Required outputs

Every underwriting run must generate:

- run ID
- application ID
- model version
- timestamp
- input feature snapshot
- component scores
- financial score
- creator score
- fraud result
- overall risk grade
- recommended exposure
- maximum recommended exposure
- recommended tenor where applicable
- reason codes
- confidence / completeness indicator
- traditional-model recommendation
- creator-enhanced recommendation

Every run must be reproducible.

### Important wording

Do not claim:

> creator data lowers default risk

until validated by outcome data.

Instead:

> creator-enhanced recommendation / hypothesis.

---

## 14. Traditional vs CreatorCo Experiment

This is one of the most important MVP features.

For every application:

### Model A
Traditional financial underwriting.

### Model B
Traditional financial inputs + creator-professional features.

Risk dashboard should show:

- eligibility difference;
- recommended limit difference;
- feature contribution;
- reason codes;
- data completeness;
- no unvalidated claims about future default.

Example:

```text
Traditional recommendation: ₹1.50L
Creator-enhanced proposal:   ₹2.75L

Incremental proposal:        +₹1.25L

Creator signals:
+ 48 months professional history
+ stable creator-income pattern
+ 6 repeat brands
+ diversified creator revenue
- high platform concentration
```

---

## 15. Creator Status

Status is **not creditworthiness**.

MVP statuses:

- Member
- Onyx
- Icon

Status may use:

- professional reach;
- engagement quality;
- professional longevity;
- brand activity;
- platform quality;
- participation.

Never automatically increase credit because status increases.

---

## 16. Premium UX Principles

The product should feel:

- premium;
- calm;
- minimal;
- credible;
- editorial;
- high-trust;
- creator-native.

Avoid:

- loan-app visual language;
- aggressive APR banners;
- gambling/game-like lending UX;
- excessive gradients;
- gamifying debt;
- follower-count vanity overload.

Financial disclosures must remain clear.

### Creator dashboard priority

1. identity / status;
2. Creator Passport;
3. financial eligibility;
4. access;
5. opportunities;
6. rewards.

Debt should not dominate the entire experience.

---

## 17. Internal Risk Console

Required capabilities:

- application list
- filters/search
- creator profile
- creator-professional features
- financial features
- source/completeness flags
- traditional underwriting
- creator-enhanced underwriting
- fraud flags
- reason codes
- model version
- proposed exposure
- simulated RE decision
- approve / modify / decline simulation
- decision reason
- audit trail
- consent record
- provider status
- underwriting rerun

The risk console is a core MVP deliverable, not a secondary admin screen.

---

## 18. Lightweight PR / Access Preview

Phase 1 may include demo opportunities only.

Examples:

- Luxury Beauty Drop
- Camera Creator Program
- Creator Hotel Weekend
- Fashion Preview
- Music / Event Access

Creator may:

- request access;
- redeem simulated Creator Points.

No real marketplace settlement is required.

### Creator Points MVP rules

- not cash;
- not transferable;
- cannot be withdrawn;
- not denominated as stored rupee value;
- no P2P transfer.

---

## 19. Build vs Buy

### Build in-house

- Creator web app
- Creator Passport
- Creator Professional Graph
- Feature Store
- Creator feature engineering
- Creator Status
- Risk Engine
- Fraud Engine
- Decision / Recommendation Engine
- traditional-vs-creator experiment
- lender adapter/orchestration layer
- workflow orchestration
- risk/admin console
- model registry
- decision audit
- consent audit
- premium UX
- analytics event taxonomy

### Buy / integrate

- social-data connectivity initially;
- KYC / V-CIP;
- bureau;
- AA gateway / infrastructure;
- eSign;
- communications;
- mandate infrastructure;
- observability infrastructure;
- cloud/database hosting.

### Regulated partner / never recreate as MVP

- bank/NBFC licence;
- regulated loan ledger;
- card ledger;
- card network;
- payment settlement;
- CIC;
- AA entity / eligible FIU role;
- regulated collections;
- regulated sanction accountability.

---

## 20. External Provider Interfaces

Business logic must depend on interfaces, not vendor SDKs.

Suggested abstractions:

```ts
interface SocialDataProvider {}
interface IdentityVerificationProvider {}
interface CreditBureauProvider {}
interface FinancialDataProvider {}
interface LenderProvider {}
interface EsignProvider {}
interface NotificationProvider {}
interface CardProvider {}
```

Initial implementations:

```text
MockSocialDataProvider
MockIdentityVerificationProvider
MockCreditBureauProvider
MockFinancialDataProvider
MockLenderProvider
```

Future implementations may include vendors/REs without changing core business logic.

Do not name database columns after vendors.

Bad:
`phyllo_profile_id`

Better:
`provider_external_profile_id`
with provider metadata.

---

## 21. Recommended Technology Stack

### Frontend / app
- Next.js
- TypeScript
- React
- Tailwind CSS
- shadcn/ui

### Backend
Phase 1:
- Next.js server-side backend / route handlers / server actions
- modular monolith

Do not introduce microservices in Phase 1.

### Database / auth
- PostgreSQL
- Supabase acceptable for MVP
- Supabase Auth acceptable for MVP

### Deployment
- Vercel-compatible
- managed PostgreSQL/Supabase

### Analytics
Use an event abstraction so analytics vendor can be replaced.

### Testing
- unit tests
- integration tests
- critical E2E flows
- deterministic underwriting tests

---

## 22. Suggested Domain Modules

```text
src/
  app/
  components/

  modules/
    identity/
    creator-profile/
    social-data/
    professional-graph/
    creator-status/
    consent/
    financial-eligibility/
    underwriting/
    fraud/
    decisioning/
    lender-orchestration/
    offers/
    risk-console/
    access/
    rewards/
    audit/
    analytics/

  providers/
    social/
    identity/
    bureau/
    financial-data/
    lender/
    notifications/

  lib/
  db/
```

Prefer domain boundaries over generic folders such as `utils/` containing business logic.

---

## 23. Core Data Model

Do not implement as one giant `users` table.

### Identity
- users
- creator_profiles
- creator_addresses
- creator_preferences

### Creator professional domain
- creator_social_accounts
- creator_social_snapshots
- creator_audience_snapshots
- creator_brand_relationships
- creator_campaign_history
- creator_income_sources
- creator_professional_features
- creator_status_runs

### Consent
- consent_definitions
- consent_receipts
- consent_withdrawals

### Lending
- credit_applications
- financial_input_snapshots
- underwriting_runs
- underwriting_feature_snapshots
- fraud_checks
- risk_scores
- credit_recommendations
- recommendation_reason_codes
- lender_decisions
- financial_offers

### Audit
- audit_events
- provider_requests
- provider_responses_metadata

### Access / marketplace preview
- brands
- opportunities
- opportunity_applications
- creator_points_ledger

Never store secrets or sensitive raw payloads in general-purpose audit logs.

---

## 24. Consent Model

Do not use a single “I agree to everything” checkbox.

Separate consent / permissions for:

1. Creator Profile
2. Professional analytics
3. Social account connection
4. Brand matching
5. Financial eligibility
6. Sharing selected creator attributes with financial partner
7. Optional product analytics / improvement where appropriate

Every consent receipt should capture:

- consent ID
- user
- purpose
- version
- timestamp
- status
- source
- withdrawal state

---

## 25. Security Baseline

Even for MVP:

- least-privilege access
- environment-based secrets
- no secrets in repo
- encryption in transit
- managed encryption at rest
- sensitive-field classification
- role-based admin access
- audit of risk-user actions
- input validation
- rate limiting on sensitive endpoints
- no raw financial payloads in logs
- no PAN/Aadhaar data in analytics tools
- no production user data in seed fixtures
- separation of demo/sandbox/prod environments

Before live financial pilot, add formal security review.

---

## 26. Analytics

Instrument the funnel:

```text
landing_viewed
application_started
account_created
creator_profile_completed
social_connection_started
social_connection_completed
passport_generated
status_generated
financial_eligibility_started
financial_consent_granted
financial_inputs_completed
underwriting_started
underwriting_completed
offer_generated
offer_viewed
simulated_offer_accepted
access_opportunity_viewed
access_requested
```

Risk/model analytics:

- feature missingness
- underwriting run count
- traditional eligibility rate
- enhanced eligibility rate
- recommended-limit delta
- fraud flag rate
- RE accept/modify/reject rate when real partner exists
- model-version distribution

---

## 27. Phase 1 Success Criteria

Phase 1 should not be judged by how attractive the landing page looks.

### Product
- creator can complete onboarding end to end;
- real Creator Passport generated;
- at least one real creator-data integration;
- underwriting run works reproducibly;
- risk console works;
- provider adapters work;
- audit / consent are visible.

### Market
- real creators use it;
- measurable completion rate;
- creators show real interest in financial eligibility.

### Underwriting
- Model A vs Model B can be compared;
- selected creator features show enough differentiation to justify lender testing;
- no false claim that this proves lower default.

### Partnership
Target:
- one credible bank/NBFC design/pilot partner;
- explicit feedback on CreatorCo feature set;
- path to controlled funded pilot.

### Decision gate

GO if:
- creator data is operationally obtainable;
- creator attributes create useful underwriting information;
- an RE is willing to test;
- creators show real unmet need.

REVISE if:
- creators value membership but not credit;
- creator data helps acquisition more than risk;
- RE prefers term finance first;
- card path is slow but term-finance path works.

STOP/PIVOT if:
- no credible lender appetite;
- creator signals add no useful information;
- target customers already have adequate financial access;
- economics require CreatorCo to take unacceptable balance-sheet/regulatory risk.

---

## 28. Implementation Sequence

Claude should work in small, reviewable stages.

### Stage 00 — Repository / foundations
- project scaffolding
- environment handling
- lint/format/test
- database setup
- architecture README

### Stage 01 — Design system
- tokens
- typography
- forms
- cards
- tables
- premium component language

### Stage 02 — Core schema
- migrations
- domain tables
- seed data
- repository/data-access patterns

### Stage 03 — Authentication
- signup
- login
- route protection
- roles: creator / risk_admin / super_admin

### Stage 04 — Creator onboarding
- cohort A0 profile
- GST status
- category
- creator experience

### Stage 05 — Creator Passport
- profile display
- connected accounts
- social metrics
- professional history

### Stage 06 — Provider architecture
- provider interfaces
- deterministic mocks
- provider health/status

### Stage 07 — Professional Graph
- snapshots
- derived creator features
- feature provenance

### Stage 08 — Consent
- purpose-specific consents
- versioning
- receipts
- withdrawal model

### Stage 09 — Financial eligibility
- application
- financial input abstraction
- mock bureau / financial provider

### Stage 10 — Underwriting Engine v0
- deterministic scoring
- reason codes
- traditional model
- creator-enhanced model
- reproducible run

### Stage 11 — Fraud
- rule-based signals
- flags
- risk-console display

### Stage 12 — Risk console
- applications
- comparison
- recommendation
- simulated RE decision
- audit

### Stage 13 — Creator offer / dashboard
- eligibility result
- premium presentation
- status
- access preview

### Stage 14 — PR / access preview
- seeded opportunities
- Creator Points simulation

### Stage 15 — Analytics / instrumentation

### Stage 16 — QA / security pass

### Stage 17 — deployment

Do not jump directly to Stage 13 before building Stages 02–12 correctly.

---

## 29. Claude Coding Rules

When implementing:

1. Read this file first.
2. Do not silently change business architecture.
3. Before each major module, state:
   - objective;
   - data model;
   - interfaces;
   - dependencies;
   - acceptance criteria.
4. Prefer boring, maintainable technology.
5. Do not add microservices.
6. Do not add AI merely because the product mentions AI.
7. Keep domain logic out of React UI components.
8. Keep provider-specific logic behind adapters.
9. Keep underwriting deterministic and testable.
10. Every decision run must be reproducible.
11. Never log sensitive raw payloads.
12. Use migrations for schema changes.
13. Add tests for underwriting formulas.
14. Add tests for consent/version behaviour.
15. Use idempotent provider workflows.
16. Use enums carefully; prefer tables/config where business categories will evolve.
17. Do not hard-code one lender into core business logic.
18. Do not imply CreatorCo is a regulated lender in UI copy.
19. Label simulated/demo financial offers clearly until live RE integration exists.
20. Do not implement a real-money wallet or PPI.
21. Do not implement securities recommendation features.
22. If a requested change conflicts with this file, stop and explain the conflict before coding.

---

## 30. UX Copy Guardrails

Good:

- “Check financial eligibility”
- “CreatorCo recommendation”
- “Estimated / proposed eligibility”
- “Subject to partner-lender approval”
- “Creator Status”
- “Creator Professional Profile”

Avoid in mock/sandbox product:

- “CreatorCo approved your loan”
- “Guaranteed limit”
- “Instant credit from CreatorCo”
- “AI says you deserve ₹5 lakh”
- “Followers determine your credit”
- “Higher status automatically increases your limit”

---

## 31. Product Language

Preferred terms:

- Creator Passport
- Creator Professional Graph
- Creator Status
- Creator Business Stability
- Creator Financial Eligibility
- CreatorCo Risk Engine
- CreatorCo Recommendation
- Creator Limit (only when an actual issuer structure supports it)
- Financial Capacity / Available Facilities
- Onyx
- Icon

Avoid generic “influencer loan” positioning.

---

## 32. Open Decisions / Counsel Items

Keep these explicitly unresolved until confirmed:

1. Final role split between CreatorCo platform / LSP / DLA / co-brand partner.
2. Exact borrower-level data an LSP may retain for CreatorCo analytics/model development.
3. Whether independent Creator Professional data remains freely retainable when the same entity also acts as LSP for that user.
4. Whether separate Creator Network and Fintech/LSP legal entities are desirable.
5. Production Account Aggregator data flow.
6. Final bank/card co-brand structure.
7. Whether one issuer facility can support both card and UPI access.
8. Current RBI status of ordinary-NBFC revolving-credit restrictions.
9. DLG availability and scope for any specific term-finance pilot.
10. Production creator-data API rights / platform terms.
11. GST/tax workflow for growing creators.
12. Future PR/ASCI/194R workflow.
13. Future SEBI/finfluencer classification in brand marketplace.

Do not resolve these by assumption in code.

---

## 33. What Success Looks Like

The MVP should make this demo credible:

```text
REAL CREATOR
      ↓
CREATOR PASSPORT
      ↓
REAL CREATOR-PROFESSIONAL DATA
      ↓
CREATOR PROFESSIONAL GRAPH
      ↓
CREATORCO FEATURE ENGINE
      ↓
TRADITIONAL UNDERWRITING
          VS
CREATOR-ENHANCED UNDERWRITING
      ↓
CREATORCO CREDIT PROPOSAL
      ↓
RE / MOCK RE POLICY
      ↓
APPROVE / MODIFY / DECLINE
      ↓
PREMIUM CREATOR EXPERIENCE
```

The investor/issuer should leave understanding that:

1. CreatorCo has a real product;
2. CreatorCo owns differentiated creator data;
3. CreatorCo has underwriting technology;
4. CreatorCo does not need to own a lending licence to prove the thesis;
5. the architecture can integrate real banks/NBFCs later;
6. the moat is creator-professional intelligence + decisioning + distribution, not commodity payments infrastructure.

---

## 34. Primary Phase 1 Question

Every feature should ultimately support answering:

> **Do longitudinal creator-professional signals improve our ability to understand the durability of creator income, and can that information improve a regulated lender's credit decision?**

If a feature does not help prove that thesis, enable the premium creator experience, or establish necessary platform foundations, it is probably not Phase 1.
