# brand-work (Stage 18) — "Verified brand work"

Creators record brand collaborations and attach evidence; a CreatorCo reviewer verifies them against the documents.
Verified records become creator-professional evidence (Professional Graph `pg-0.3.0`, brand portfolio). They are
**not** a credit input: underwriting, eligibility, lending, fraud and Creator Status never import this module, and
`PROFESSIONAL_INPUTS` has no brand keys (unit-tested). Using them for credit would need validation and a new model
version first.

## Data and the identifier rule

Invoices can contain PAN, GSTIN, bank details and addresses. Those are **never** extracted into columns, logs, audit
metadata, analytics or form state — the stored document bytes are the only place they exist. Creator free text
(brand, billed party, description, deliverables) and staff notes are rejected if they look like an identifier
(`lib/restricted-text.ts`); flagged values are not echoed back. Documents are stored under an opaque key
(`bw/<32 hex>`), never with a filename or creator id.

Tables (`public`): `brand_work_records`, `brand_work_documents`, `brand_work_reviews` (append-only),
`brand_work_reversals`, `brand_directory`, `brand_aliases`, `brand_directory_merges`, `brand_industries`,
`brand_work_reasons`, `creator_notices`; `ops.feature_switches`.

## Lifecycle

`draft → submitted (waiting for scans) → in_review → verified | needs_info | rejected`; a verified record can be
reversed (four eyes) to `rejected`.

- Uploads go through the server: ≤ 10 MB (enforced while streaming), PDF/JPEG/PNG by magic bytes, ≤ 5 per record,
  SHA-256 dedupe (a creator's own clean copy is reused; a pending/rejected one gets its own object and scan), and the
  same file on another creator's record raises `duplicate_document`.
- `brand_work_scan_document` scans every upload (`FileScanProvider`); rejected objects are deleted by
  `brand_work_erase_documents`. A record enters review only when every document is clean.
- Flags (`rules.ts`, `bw-0.1.0`) never reject; they route to a second, different reviewer.
- Reviewers (`brand_work_reviewer`, least privilege; super admins too) can't review their own records, complete a
  second review of their own first review, approve their own reversal, or approve their own directory merge.
  "Start review" holds a record for 30 minutes; viewing never locks. Every signed document link is audited.
- Proposed review SLA: 48 hours (queue age badge). To confirm with ops.

## Payment confirmation (optional, equal options)

`agency_confirmation` and `remittance_advice` are recorded by a reviewer. `aa_match` checks AA data the creator
**already shared** for a confirmed eligibility check, inside `modules/financial-eligibility`
(`brand-payment-match.ts`, rules `pm-0.2.0`: window −7…+120 days, 85–100% of the invoice for TDS, a distinctive payer
word from the billed party's name). Only `seen | not_seen | unknown` and a month leave `fin`; `not_seen` only when the
statements cover the whole window. It never triggers an AA fetch.

`aa_match` needs the optional `brand_payment_match` consent **and** the `/ops` feature switch, which is **off by
default** and turned on only through maker-checker. **Precondition:** written confirmation from the FIU/partner RE
that this use of already-shared AA data is within the AA consent's purpose. Until then it stays off.

## Points (`rewards`, `pts-0.2.0`)

Count-based and method-neutral: 1 / 5 / 10 / 25 verified records → 250 / 500 / 750 / 1,500; 1 / 5 / 10 confirmed
payments → 200 / 400 / 600. Never for consent or an amount. Reversed only by an approved reversal, and only the
milestone that record had reached. Withdrawal keeps points. Reminders (`brand_work_consent_reminders`) are neutral and
earn nothing.

## Withdrawal

- `brand_work_records`: records, documents (rows now, stored objects by a job), reviews, notices, and the brand features
  in every earlier graph run are erased; a fresh graph run follows. Points stay.
- `brand_payment_match`: payments confirmed by the bank-data check go back to unconfirmed (other methods stay).

## Open pointers

- **Storage vendor:** Google Cloud Storage (Mumbai) is the likely choice — to be confirmed. Only a
  `DocumentStorageProvider` adapter is needed; the mock keeps bytes in memory per process (single instance only).
- **File scanning vendor:** to choose alongside storage.
- **Reviewer role ownership:** who staffs `brand_work_reviewer` (partnerships vs risk ops).
- **Directory unification:** `brand_directory` is separate from the Access `brands` sample table; decide whether to
  merge once real brands exist.
