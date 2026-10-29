# Data classification and inventory

Stage 16. Every table CreatorCo stores, how sensitive it is, and how its data leaves the system. The table below is
generated from `src/modules/privacy/data-inventory.ts` (`npx tsx scripts/render-data-inventory.ts`); a test fails
when a table exists without an entry, or when this file is out of date.

## Sensitivity levels

| Level | Meaning | Handling |
| --- | --- | --- |
| **restricted** | Identity or financial data whose exposure causes real harm: PAN-derived values (masked PAN, keyed fingerprint, GSTIN), mobile numbers, bank/bureau-derived figures, AA line items, credentials and key hashes. | Only the owning module reads it (`fin` only via `financial-eligibility`, `underwriting`, `lending`). Hashed, masked or sealed where possible (AA narrations: AES-256-GCM). Never logged, audited as values, sent to analytics or shown in staff views beyond need. |
| **confidential** | Personal and creator-professional data, consent and audit records, pseudonymous analytics. | Purpose-bound by consent; erased on withdrawal where a scope applies; ids only in logs. |
| **internal** | Operational data with no personal data, or opaque ids only. | Staff roles only. |
| **public** | Reference content shown to members (categories, consent texts, sample brands). | — |

## What is never stored

Full PAN, Aadhaar, bureau reports or tradelines, card transactions, raw provider payloads, OTP codes (hash only),
passwords (scrypt hash only), session or API tokens (SHA-256 only), raw client IP addresses (keyed hash, 48 hours),
secrets (environment only; the database holds env var names).

## Cookies

| Cookie | Purpose | Contents | Lifetime |
| --- | --- | --- | --- |
| `__Host-cc_session` / `cc_session` | Signed-in session | Opaque token (only its SHA-256 is stored) | Session TTL |
| `cc_appearance` | Light/dark preference | `light`, `dark` or `system` | 1 year |
| `cc_attr` | Sign-up attribution | Reviewed source/medium tags, a registered campaign or `other`, referrer kind — no identifier | 24 hours; cleared at sign-up |

## Where data must not go

- **Logs:** event names, opaque ids and counts only (`logger`; sensitive keys redacted). Database errors are redacted
  before they reach any log, including the framework's own error output (`src/lib/log-redaction.ts`).
- **Audit metadata:** small scalars; sensitive keys rejected (`sanitiseAuditMetadata`).
- **Analytics:** declared events with small enum/boolean props, keyed pseudonym, India-time day only.
- **API responses:** creators see their own records; staff views omit GSTIN and financial raw values.

## Inventory

<!-- inventory:start -->

| Table | Sensitivity | Domain | Personal | Holds | Lifecycle |
| --- | --- | --- | --- | --- | --- |
| `fin.bureau_summaries` | restricted | regulated financial | yes | score band and tradeline counts (never the report) | erased on withdrawal: financial_inputs |
| `fin.cashflow_account_months` | restricted | regulated financial | yes | monthly inflow/outflow/creator income per account | erased on withdrawal: financial_inputs |
| `fin.cashflow_accounts` | restricted | regulated financial | yes | masked account numbers, institution, type | erased on withdrawal: financial_inputs; purged line items at AA data-life end (purge_expired_fi_data) |
| `fin.cashflow_months` | restricted | regulated financial | yes | monthly totals across accounts | erased on withdrawal: financial_inputs |
| `fin.cashflow_sessions` | restricted | regulated financial | yes | AA session, mobile last 4 + fingerprint | erased on withdrawal: financial_inputs |
| `fin.credit_applications` | restricted | regulated financial | yes | request, declared figures, masked PAN, keyed PAN fingerprint | erased on withdrawal: financial_inputs; purged inputs erased when a check expires (90 days unsent) |
| `fin.credit_proposals` | restricted | regulated financial | yes | frozen proposal payload sent to a lender | erased on withdrawal: financial_inputs; held while the lender relationship is open (retention hold) |
| `fin.decision_queries` | restricted | regulated financial | yes | staff queries to the lender | erased on withdrawal: financial_inputs; held while the lender relationship is open |
| `fin.decision_reviews` | restricted | regulated financial | yes | staff confirm/override with reason | erased on withdrawal: financial_inputs; held while the lender relationship is open |
| `fin.fi_transactions` | restricted | regulated financial | yes | AA line items, narration/counterparty sealed (AES-256-GCM) | erased on withdrawal: financial_inputs; purged at AA data-life end (purge_expired_fi_data) |
| `fin.fi_vendor_analytics` | restricted | regulated financial | yes | vendor analytics payload, sealed | erased on withdrawal: financial_inputs; purged at AA data-life end (purge_expired_fi_data) |
| `fin.financial_feature_runs` | restricted | regulated financial | yes | Financial Capacity run metadata | erased on withdrawal: financial_inputs |
| `fin.financial_features` | restricted | regulated financial | yes | Financial Capacity features | erased on withdrawal: financial_inputs |
| `fin.fraud_checks` | restricted | regulated financial | yes | fraud rule inputs and results | erased on withdrawal: financial_inputs, identity_lookup, social_account_data, professional_graph |
| `fin.fraud_flags` | restricted | regulated financial | yes | fraud flags with evidence | erased on withdrawal: financial_inputs, identity_lookup, social_account_data, professional_graph |
| `fin.lender_decisions` | restricted | regulated financial | yes | lender outcome, exposure, terms | erased on withdrawal: financial_inputs; held while the lender relationship is open |
| `fin.offer_responses` | restricted | regulated financial | yes | accept/decline, terms hash, KFS acknowledgement | erased on withdrawal: financial_inputs; held while the lender relationship is open |
| `fin.underwriting_inputs` | restricted | regulated financial | yes | frozen feature values per run | erased on withdrawal: financial_inputs, identity_lookup, social_account_data, professional_graph |
| `fin.underwriting_results` | restricted | regulated financial | yes | scores, grades, recommendations, reason codes | erased on withdrawal: financial_inputs, identity_lookup, social_account_data, professional_graph |
| `fin.underwriting_runs` | restricted | regulated financial | yes | run metadata, model version, input hashes | erased on withdrawal: financial_inputs, identity_lookup, social_account_data, professional_graph |
| `iam.identities` | restricted | identity | yes | email, password hash (scrypt) | kept while the account exists (account closure: open item) |
| `iam.sessions` | restricted | identity | yes | session token hash, client, expiry | purged 180 days after the session ends (purge_auth_records) |
| `ops.partner_api_keys` | restricted | control plane | no | API key SHA-256 hashes and prefixes | no personal data |
| `public.creator_gst_registrations` | restricted | creator professional | yes | GSTIN (embeds PAN), registered names, state | kept while the account exists (account closure: open item) |
| `public.creator_profiles` | restricted | creator professional | yes | legal/display name, location, legal form, GST status, GSTIN | kept while the account exists (account closure: open item); withdrawing Creator Profile pauses membership |
| `public.identity_lookup_results` | restricted | identity | yes | verified name, masked PAN, mobile | erased on withdrawal: identity_lookup |
| `public.mobile_verifications` | restricted | identity | yes | mobile number, code hash, attempts | purged after 30 days (purge_auth_records) |
| `public.users` | restricted | identity | yes | email, verified mobile, role, status | kept while the account exists (account closure: open item) |
| `analytics.events` | confidential | analytics | yes | event, keyed pseudonym, enum props (incl. reviewed sign-up campaign tags), India-time day | erased on withdrawal: product_analytics_events, financial_funnel_events; purged after 24 months, once rolled up (analytics_maintenance) |
| `iam.login_attempts` | confidential | identity | yes | hashed email, success flag | purged after 180 days (purge_auth_records) |
| `ops.rate_limit_counters` | confidential | control plane | yes | keyed hash of IP/user/partner, window counts | purged after 48 hours (rate_limit_purge) |
| `public.access_requests` | confidential | access | yes | requests, notes, points held | erased on withdrawal: access_requests |
| `public.audit_events` | confidential | audit | yes | actor and entity ids, event type, small scalar metadata | append-only audit trail (period: counsel/RE) |
| `public.consent_receipts` | confidential | consent | yes | who agreed to which version, when | proof of consent (counsel to confirm the period) |
| `public.consent_withdrawals` | confidential | consent | yes | withdrawals, reason code, effects | proof of withdrawal (counsel to confirm the period) |
| `public.creator_additional_categories` | confidential | creator professional | yes | category codes | kept while the account exists (account closure: open item) |
| `public.creator_points_ledger` | confidential | creator professional | yes | Creator Points earn/hold/release entries | kept while the account exists (account closure: open item) |
| `public.creator_preferences` | confidential | creator professional | yes | category, brand, travel and PR interests | kept while the account exists (account closure: open item) |
| `public.creator_professional_features` | confidential | creator professional | yes | derived professional features with provenance | erased on withdrawal: professional_graph |
| `public.creator_social_accounts` | confidential | creator professional | yes | platform, handle, provider account id | erased on withdrawal: social_account_data |
| `public.creator_social_snapshots` | confidential | creator professional | yes | follower, view, reach and engagement figures | erased on withdrawal: social_account_data |
| `public.creator_status_runs` | confidential | creator professional | yes | Creator Status tier and criteria | erased on withdrawal: professional_graph |
| `public.professional_graph_runs` | confidential | creator professional | yes | graph run metadata | erased on withdrawal: professional_graph |
| `public.social_connection_requests` | confidential | creator professional | yes | hashed OAuth state, platform | erased on withdrawal: social_account_data |
| `analytics.daily_counts` | internal | analytics | no | daily event and subject counts (no ids) | no personal data |
| `ops.integration_change_requests` | internal | control plane | no | maker-checker changes (staff ids) | no personal data |
| `ops.jobs` | internal | control plane | no | job queue (ids and counts only) | no personal data |
| `ops.partner_events` | internal | control plane | no | event feed (ids only) | no personal data |
| `ops.partner_webhook_deliveries` | internal | control plane | no | delivery attempts (ids, HTTP status) | no personal data |
| `ops.partner_webhook_endpoints` | internal | control plane | no | webhook URLs, secret versions (no secrets) | no personal data |
| `ops.partners` | internal | control plane | no | partner lenders and environments | no personal data |
| `ops.provider_call_stats` | internal | control plane | no | call counts and durations | no personal data |
| `ops.provider_configs` | internal | control plane | no | adapter settings, env var names (no secrets) | no personal data |
| `ops.provider_routes` | internal | control plane | no | routing, kill switch | no personal data |
| `ops.provider_runtime` | internal | control plane | no | circuit breaker and health state | no personal data |
| `ops.simulated_lender_policies` | internal | control plane | no | simulated lender policy versions | no personal data |
| `public.data_erasure_requests` | internal | consent | yes | erasure scope, status, hold reasons, counts | proof of erasure |
| `public.provider_requests` | internal | audit | yes | provider call metadata (no payloads) | audit of third-party data access (period: counsel/RE) |
| `public.access_opportunities` | public | reference | no | sample opportunities | no personal data |
| `public.brands` | public | reference | no | sample brand names and descriptions | no personal data |
| `public.consent_definitions` | public | reference | no | versioned consent texts | no personal data |
| `public.creator_categories` | public | reference | no | category vocabulary | no personal data |
| `public.social_platforms` | public | reference | no | platform vocabulary | no personal data |

<!-- inventory:end -->

## Open items (counsel / RE)

- **Account closure.** There is no self-serve account deletion yet. Withdrawing the Creator Profile consent pauses
  membership; identity, profile, GST and points records stay while the account exists.
- **Retention periods** for consent receipts and withdrawals, audit events, provider-request metadata and lender
  records after a relationship closes.
- **Security-record periods** (`purge_auth_records`: sign-in attempts and ended sessions 180 days, in line with
  CERT-In's 2022 direction on ICT logs; verification codes 30 days) — confirm in the retention schedule.
- **Sign-up attribution** is recorded as essential service measurement and disclosed on the sign-up page and in the
  consent centre. Counsel to confirm it fits that basis (vs. an optional marketing purpose).
