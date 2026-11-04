# public-passport (Stage 19) — Verified Creator Passport

A creator can publish a public page at `/p/<slug>` showing the verified creator-professional information they choose.
Each field has a tier: **public** (anyone with the link), **unlocked** (people with an access code from the creator,
and verified brand organisations if the creator allows them) or **hidden**. Brand organisations are in
`modules/brand-orgs`.

## Non-negotiables

1. **"Blur" is server-side redaction, not CSS.** `view.ts` builds the view model and is the redaction boundary. The
   page, the JSON API, the share image and discovery render only what it returns. A locked section carries its key, a
   fixed title and a fixed number of placeholder rows (`PLACEHOLDER_ROWS`) — never a value, a brand name, a logo id, a
   count or whether it is empty. Locked values never reach HTML, JSON, RSC payloads, OG images or alt/aria text.
   Unit tests check the serialised locked view; E2E checks the locked HTML.
2. **Never from the financial domain.** This module and `brand-orgs` never import `financial-eligibility`,
   `underwriting`, `lending`, `offers` or `rewards`, and never read `fin` (unit-tested). Credit modules and Creator
   Status never import them either.
3. **No exact money.** Amounts appear only as bands (`bands.ts`, `PASSPORT_BANDS_VERSION` = `ppb-0.1.0`), only in
   the unlocked tier, only with the creator's "Deal-size bands" field on (hidden by default). Deal bands:
   `<₹25k`, `₹25k–50k`, `₹50k–1L`, `₹1–2.5L`, `₹2.5–5L`, `₹5L+`. Followers and engagement are banded too.
   Any band change bumps the version.
4. **Private brand work never appears by name.** It counts in brand-work numbers and bands only if the creator turns
   on "Count private work in totals" (off by default).
5. **No points, perks or nudges** for publishing, unlocking, sharing or giving these consents (unit-tested against
   `rewards/rules.ts`).
6. **No brand logos without permission.** A logo shows only when a VERIFIED organisation claimed the directory entry
   and uploaded a logo that scanned clean and two admins approved (`brand-orgs/logos.ts`). Otherwise a monogram.
   Never scraped.

## Fields (spec §1)

| Field            | Allowed                    | Default  |
| ---------------- | -------------------------- | -------- |
| profile          | public / unlocked          | public   |
| handles          | public / unlocked          | public   |
| follower_bands   | public / unlocked / hidden | public   |
| categories       | public / unlocked / hidden | public   |
| city             | public / unlocked / hidden | hidden   |
| longevity        | public / unlocked          | public   |
| badges           | public only                | public   |
| industries       | public / unlocked / hidden | public   |
| creator_status   | public / unlocked / hidden | hidden   |
| brands           | unlocked / hidden          | unlocked |
| brand_numbers    | unlocked / hidden          | unlocked |
| audience_signals | unlocked / hidden          | unlocked |
| deal_bands       | unlocked / hidden          | hidden   |

Every shown section has a source label ("Verified" / "Calculated") and an as-of month where it comes from the
Professional Graph. Graph values appear only while the creator's professional-analytics consent is on. The footer says
"Verified by CreatorCo" and that the page is not a credit assessment or an endorsement. "No verified brand work yet"
where there is none. Wording never uses "rank", "score" or "worth".

## Consents and withdrawal

- `public_passport` (c015 v1): publishing. Off → the page answers **410 Gone** at once (`stopPublicPassport`),
  indexing off, the locked cache is invalidated by `cache_version`; erasure scope `public_passport_content` removes
  the bio, the photo (object deleted by the `public_passport_purge` job) and old-link redirects.
- `passport_unlock` (c016 v1): codes, verified brands, discoverability. Off → every code revoked, audience back to
  code holders only, discoverability off. The access log is kept until account erasure.
- Prompts: Passport home "Get your public link", a verified brand-work record, the Access request flow (a code scoped
  to the brand's verified organisation, when the Access brand is linked to one) and the consent centre. Never in
  onboarding.

## Public page

- `/p/[slug]`; slugs are unique, suggested from the main handle, reserved words and number-like runs blocked, and a
  changed link forwards (308) for 30 days. Unknown, unpublished, withdrawn and taken-down links all get the **same**
  410 page from the proxy gate (`gate.ts`), so links can't be probed. No public index.
- The locked view is cached in-process for ≤ 5 minutes keyed by `cache_version`; unlocked responses are
  `private, no-store`. `passport.public_view` rate limit per IP. Publishing needs one connected, verified social account.
- "Report this page" creates a report with the passport id and a reason code only.

## Codes

16 Crockford base32 characters (80 bits), shown once, stored as a SHA-256 hash with a 4-character hint; expiry 7/30/90
days, optional max uses, optional organisation scope; revocable. Redeeming sets a signed httpOnly SameSite=Lax cookie
for that passport only (`cc_pu_<id>`, path `/p`, ≤ 24 h or the code's expiry). Brute force: per-IP
rate limits — a network is locked out for 15 minutes after 20 attempts — the creator is told (an access-log entry) when
10 wrong codes hit their page within 15 minutes, and comparison is constant-time. Wrong guesses never block people
holding a real code. Codes scoped to an organisation work only for signed-in members of that organisation while it is
verified (also re-checked on every request while the unlock lasts).
The access log holds the code label, India day + hour, the typed (unverified) name/company, and a keyed IP pseudonym
(`ip1:`) — never the address.

## Keys

`PASSPORT_SHARING_KEY` (secret, required outside dev/test) derives separate keys for unlock cookies, IP pseudonyms and
brand-org GSTIN fingerprints.

## Decisions (defaults until Aman confirms)

1. Deal bands are allowed but off by default.
2. Unlock audience defaults to code holders only.
3. Brand discovery `/ops` switch is off.
4. Daily unlock quota 50 per organisation (`/ops` platform limit; partnerships can set lower per org).
5. No verified brand-work record is required to publish.
6. Brand members see creator-chosen bands only (written into PROJECT_KNOWLEDGE.md and CLAUDE.md).
