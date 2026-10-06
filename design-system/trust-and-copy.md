# Trust, status and copy

## Status is not credit (adopted — in the code today)

- **Creator Status** (Member → Onyx → Icon) reflects professional standing. It is never an input to a financial recommendation or limit (`modules/creator-status/status.ts`). Every member is `member` until the Professional Graph computes status.
- Status and finance are **visually and verbally separate**:
  - Status: `CreatorStatusBadge`, the membership card, gold tier accents.
  - Finance: the Financial eligibility card (info "Coming soon" badge, plain text), consent texts, the compliance note. No gold, no tier marks, no figures.
- Both appear side by side on Home as separate cards. The Status card always says: _"Status reflects your creator career and participation. It never sets financial limits."_
- **Professional signals** are about the creator business: every signals group carries _"About your creator business — not a credit score."_ and each signal shows its provenance (Verified / Self-declared / Derived) and confidence.
- The **membership card** is a status object: it shows name, handle, tier, member-since and member number — never a credit limit, card number, expiry, CVV or network mark.

The stricter attribute-level verification and membership-card wording rules are **proposed** (P-01, P-02).

## Verification today

`VerificationMark` has four states, each a glyph plus a screen-reader word: **verified** (`circle-check`, success), **declared** (`circle-dot`, "Self-declared"), **attention** (`circle-alert`, warning, "Needs attention"), **missing** (`circle-dashed`, "Not provided"). Rows pair the mark with a label and a detail line ("Self-declared — connect an account to verify").

## Consent

- One purpose per consent; the exact text is shown with its **version** (`ConsentText`), and the agreement is a separate unchecked `CheckboxRow` ("I agree to …"). Changing text means a new version.
- Optional consents are separate and say so ("Also turn on professional signals — Optional and separate. You can turn this on or off later.").
- Account › Consents lists each consent with version, date and On/Off.

## Copy guardrails

**Use:** Check financial eligibility · CreatorCo recommendation · Proposed eligibility · Subject to partner-lender approval · Creator Status · Creator Professional Profile · Financial Capacity · and the compliance line:

> CreatorCo is not a bank or lender. Any financial product will be offered by a regulated partner bank or NBFC and is subject to its approval.

(`ComplianceNote` renders the full version: "CreatorCo is a creator membership and technology platform, not a bank or lender. … Pilot build — some information is sample data." It sits at the end of every app and onboarding page.)

**Never:** "CreatorCo approved your loan" · "Guaranteed credit" · "Instant loan" · "Followers determine your credit" · "AI says you deserve ₹X" · "Increase your status to get more debt" · "bank" in the CreatorCo brand · "Verified Passport/creator" when only some attributes are verified.

**Voice:** short, plain, second person, sentence case. Name what happens and what the creator controls ("CreatorCo never posts for you", "You can disconnect any time"). Unavailable things are labelled honestly ("Coming soon", "Not yet supported", "Sample preview — not live opportunities").

## Restricted data

GSTIN embeds PAN: never echo it in form state, logs, audit metadata or admin views. PAN is shown masked (`XXXXX1234X`); the legal name is "private to CreatorCo" and says so.
