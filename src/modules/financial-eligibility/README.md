# financial-eligibility (Stages 09, 09b)

Regulated financial domain (`fin` schema). Only this module and `modules/underwriting` read or write it.

- `application-service.ts` — the check: consent, details (up to 3 purposes + note), bureau summary, explicit
  **confirm** (`confirmApplication`) which computes Financial Capacity and pins the confirmed run; changes after confirm
  reopen to Review (`reopenIfConfirmed`).
- `cashflow-service.ts` — Account Aggregator sharing: sessions per mobile number, accounts (deduped per check),
  retries, the coverage question, skip, recompute, data-life purge, the bank-step read model.
- `cashflow-analysis.ts` — pure: own-transfer netting and creator-income classification (`cfa-*`).
- `financial-features.ts` — pure Financial Capacity engine (`fin-*`): bank-verified income only.
- `fi-data-protection.ts` — AES-256-GCM sealing for line items and the live-retention switch.
- `erasure.ts` — erases every input tied to a check (closure, expiry, withdrawal).

Never: full PAN, full mobile numbers, bureau reports, line items outside `fin`, anything financial in logs, audit
metadata or analytics. Discovery failure is never zero income.
