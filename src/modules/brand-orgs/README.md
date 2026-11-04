# brand-orgs (Stage 19) — verified brand and agency organisations

Brands and agencies sign up at `/brands/signup`, CreatorCo checks them, and verified members can unlock creator
Passports the creator opened to verified brands (or with a code the creator scoped to their organisation).

- **Role** `brand_member`: not staff, not a creator. `requireBrandMember()` / `requireVerifiedBrandMember()`
  (organisation verified and current brand terms accepted). Role separation is tested both ways.
- **Sign-up**: a work-email one-time code via `NotificationProvider` (free-mail and disposable domains refused), then
  legal name, type, website, CIN or LLPIN, optional GSTIN and the brand terms. **GSTIN is restricted**: validated, then
  stored only as a keyed fingerprint (`g1:`) plus the 2-digit state code — never stored, logged, audited, echoed or
  shown (staff see "Given" and the state code).
- **Members**: owners invite colleagues on the same domain (7-day link; shown on screen only in mock mode) and can
  remove them (their account is deactivated).
- **Desk** `/partnerships/brand-orgs` (partnerships admins): company-register lookup (`BusinessVerificationProvider`,
  mock adapter; a real vendor is a decision for Aman), then **four eyes** — one admin checks, a different admin
  approves — for verification, directory claims, logos, suspension and reinstatement (enforced in the service; DB
  CHECKs also enforce it for verification, claims and logos). Reviewers see
  organisation data only; unlock history is counts per passport id and day.
- **Claims and logos**: a verified owner claims directory brands and uploads a PNG/JPEG logo (≤ 1 MB, magic bytes,
  scanned by `FileScanProvider`, stored via `DocumentStorageProvider` under `lg/<hex>`) after ticking "We own or are
  authorised to use this logo". Shown on passports only once approved (`logos.ts`). The directory page shows "Claimed
  by" read-only.
- **Unlocks**: an unlock lasts for the India day, appears in the creator's access log with the organisation's name
  (marked verified), and counts once per passport per day against the daily quota (`/ops` limit, default 50;
  partnerships can set a lower per-organisation quota). Brand members see creator-chosen bands only — never amounts.
- **Discovery** (`brand_discovery` switch, off): creators who chose to be discoverable, built from the public tier;
  filters match public values only; opening one in full is an unlock.
- **Access link**: an Access (Stage 14) brand can be linked to a verified organisation on the desk (one admin; it
  replaces any earlier link), so a creator who requested its opportunity can create a code that only that
  organisation's signed-in members can redeem (the creator passes it on; it is never sent automatically).

Tables: `brand_orgs` (restricted), `brand_org_members`, `brand_org_invites`, `brand_email_challenges`,
`brand_org_claims`, `brand_org_reviews` (append-only); `brands.brand_org_id`.
