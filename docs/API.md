# CreatorCo API v1

JSON API for future iOS and Android apps (and partner tooling). It exposes the same domain services as the web app;
routes are thin (authenticate → validate with the module's Zod schema → call the module service).

## Conventions

- Base path: `/api/v1`. Request bodies are `application/json` (max 16 KB).
- **Authentication: bearer tokens only.** `Authorization: Bearer <token>`. Cookies are ignored, so there is no CSRF
  surface. Tokens come from sign-up/sign-in with `client` = `ios` | `android` | `api`.
- Session channels are separated: a browser (`web`) session works only as a cookie; a native/API session works only
  as a bearer token.
- Success returns the resource (no wrapper). Errors return `{ "error": { "code", "message", "fields"? } }`.
- Every response is `Cache-Control: no-store`. Request/response bodies are never logged.

| Status | Meaning                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| 401    | `unauthenticated` — missing/expired/revoked token                                                                 |
| 403    | `forbidden` (wrong role) · `inactive`                                                                             |
| 409    | state conflict: `step_locked`, `profile_incomplete`, `membership_paused`, `consent_outdated`, `provider_changed`… |
| 415    | body is not JSON                                                                                                  |
| 422    | `validation_failed` (with `fields`) or a domain rule                                                              |
| 429    | `locked` — too many sign-in attempts                                                                              |
| 503    | `service_unavailable` — a provider capability is paused (kill switch) or has no healthy route; retry later        |

`provider_changed` means ops switched the provider while a social or Account Aggregator flow was in progress: start
that flow again. Staff consoles (`/admin`, `/ops`) have no API; the only non-v1 route is the scheduler tick
`GET /api/internal/cron/tick` (`Authorization: Bearer $CRON_SECRET`, disabled when unset), which returns job counts.

## Endpoints

| Method & path                                           | Purpose                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                           | Liveness + DB reachability                                                                                                                                                                                              |
| `POST /auth/sign-up`                                    | `{ email, password, confirmPassword, client }` → `201 { token, expiresAt, user }`                                                                                                                                       |
| `POST /auth/sign-in`                                    | `{ email, password, client }` → `{ token, expiresAt, user }`                                                                                                                                                            |
| `POST /auth/sign-out`                                   | Revokes the current token → `204`                                                                                                                                                                                       |
| `GET /me`                                               | `{ user, onboarding: { status, nextStep } }`                                                                                                                                                                            |
| `PUT /onboarding/{about\|profile\|business\|interests}` | Saves a section → `204`. Draft profiles follow step order; completed profiles edit the Passport                                                                                                                         |
| `POST /onboarding/complete`                             | `{ consentDefinitionId, agree: true }` → `204`                                                                                                                                                                          |
| `GET /consents/{key}`                                   | Current versioned text for a purpose + whether the user holds it                                                                                                                                                        |
| `GET /passport`                                         | Creator Passport read model (no GSTIN/PAN/full mobile; no credit figures)                                                                                                                                               |
| `POST /social/connections`                              | `{ platform, connectionConsentId, analyticsConsentId?, additional? }` → `201 { authorizationUrl }`. `additional: true` adds another account on a platform that already has a connected one (max 3; `422 account_limit`) |
| `POST /social/connections/complete`                     | `{ state, code }` from the provider redirect → `201 { accountId, platform, handle, snapshotsStored, graphComputed }`                                                                                                    |
| `DELETE /social/accounts/{id}`                          | Disconnect → `204`                                                                                                                                                                                                      |
| `POST /social/accounts/{id}/primary`                    | Make a connected account the primary one on its platform → `204`                                                                                                                                                        |
| `POST /social/refresh`                                  | Re-fetch connected accounts, recompute signals                                                                                                                                                                          |
| `GET /professional-graph`                               | `{ enabled, graph }` — signals only while the analytics consent is on                                                                                                                                                   |
| `POST /professional-graph`                              | `{ consentDefinitionId }` → turn signals on (separate consent)                                                                                                                                                          |
| `DELETE /professional-graph`                            | Turn signals off (withdraws the consent) → `204`                                                                                                                                                                        |

### Financial eligibility

| Method & path                         | Purpose                                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /eligibility`                    | `{ open, past }`                                                                                                                                                                               |
| `POST /eligibility`                   | `{ consentDefinitionId, agree: true }` → `201` the check (idempotent while one is open)                                                                                                        |
| `GET /eligibility/{id}`               | `{ application, financialCapacity, recommendation: { prepared } }` — never recommendation figures                                                                                              |
| `PUT /eligibility/{id}/details`       | `{ purposes: [..≤3], purposeNote?, requestedAmount, declaredMonthlyIncome, declaredMonthlyEmi, incomeSources }` (`purposeNote` required with `"other"`, ≤140 chars). Reopens a confirmed check |
| `POST /eligibility/{id}/credit-check` | `{ pan, confirm: true }` — PAN used once, never returned                                                                                                                                       |
| `GET /eligibility/{id}/bank`          | Numbers searched (last four digits, opaque `key`), accounts + status, coverage, `attemptsLeft`, `maxNumbers`, aggregator `capabilities`, `mode`                                                |
| `POST /eligibility/{id}/bank`         | `{ mobile }` (10-digit Indian; the AA verifies it by OTP) or `{ retrySessionId }` → `201 { redirectUrl, sessionId }`. `409 number_limit` / `duplicate_number`                                  |
| `POST /eligibility/bank/complete`     | `{ params }` — the AA redirect's query parameters, passed through to the adapter                                                                                                               |
| `PUT /eligibility/{id}/bank/coverage` | `{ allShared: true }` or `{ allShared: false, missingReason: other_number_unavailable \| bank_not_on_aa \| chose_not_to_share }`                                                               |
| `POST /eligibility/{id}/bank/skip`    | Continue without bank data (not allowed once data has arrived)                                                                                                                                 |
| `POST /eligibility/{id}/confirm`      | Review → confirm: computes Financial Capacity, prepares the recommendation. `409` until every step is settled                                                                                  |
| `DELETE /eligibility/{id}`            | Discard the check; its inputs are erased → `204`                                                                                                                                               |

`GET /eligibility/{id}` → `lender` takes one of these shapes:

- `{ stage: "not_shared" | "preparing" | "with_lender" | "closed" }`. `closed` means the lender records of a sent
  check were erased after its lender relationship ended.
- `{ stage: "decided", outcome: approved|modified|declined, amount, tenorMonths, simulated, adjusted, decidedAt, offer }`.
  A decision appears only after a CreatorCo reviewer has confirmed or adjusted it.

`offer` (Stage 13) is `null` for a decline. Otherwise it is
`{ state: open|accepted|declined|expired, terms, expiresAt, termsHash, respondedAt, declineReason }`. `terms` holds
the lender's offer and Key Fact Statement fields, illustrative for the simulated lender.

| Method & path                          | Purpose                                                                                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /eligibility/{id}/offer/accept`  | `{ termsHash, kfsAcknowledged: true, consentDefinitionId, agree: true }`, using the active `lender_handoff` definition. The consent is given in the same step as the acceptance. Returns the `lender` view. `409 conflict` if the terms changed |
| `POST /eligibility/{id}/offer/decline` | `{ reason?: no_longer_needed \| terms \| other_lender \| other }` → the `lender` view                                                                                                                                                           |

`steps.bank` is `not_started` · `pending` · `completed` · `declined` · `unavailable` (sharing tried, no data — never
"no income") · `skipped`; `bankCoverage` is `none` · `partial` · `complete`. With the mock AA, tests complete a journey
with `params: { reference, status: "approved", accounts: "<last4>-<n>,…" }` (see `e2e/api.spec.ts`).

## Partner API

Partner lenders use a separate API, `/api/partner/v1`, with API keys only (no sessions or cookies). The endpoints,
webhooks, signatures and sandbox are described in [PARTNER_API.md](./PARTNER_API.md). Creator bearer tokens are never
accepted there, and partner keys are never accepted here.

Section bodies use the same shapes as the module schemas in `src/modules/creator-profile/schemas.ts`, e.g.
`PUT /onboarding/about` → `{ legalName, displayName, state, city, cityOther?, languages: ["en"], languagesOther? }` and
`PUT /onboarding/profile` → `{ primaryCreatorHandle, categories, primaryCategory, creatorSince: "YYYY-MM", platforms:
["instagram"], platformHandles: { "instagram": "handle" } }`.

Mobile OTP, identity prefill and GST lookup endpoints are not exposed yet (they remain web server actions).

## Social connection from a native app

1. `GET /consents/social_account_connection` (and `professional_analytics` if offering signals) and show the text.
2. `POST /social/connections` → open `authorizationUrl` in `ASWebAuthenticationSession` / Custom Tabs.
3. The provider redirects to the registered callback with `state` and `code`; call
   `POST /social/connections/complete`.

With the **mock** provider, the authorisation screen (`/connect/mock`) needs a browser session, so tests build the
code directly: `base64url(JSON.stringify({ platform, handle, nonce }))` (see `e2e/api.spec.ts`). The redirect URI is
fixed to `${APP_URL}/passport/connect/callback` until native universal links are registered.
