import { CONSENT_KEYS } from "./domain";

/**
 * Canonical consent texts, published to `consent_definitions` by
 * `npm run db:reference`. To change wording, add a NEW version here — never
 * edit a published one (the database rejects edits).
 *
 * DRAFT wording for the pilot. Must be reviewed by counsel before real users.
 */
export const CONSENT_DEFINITION_SEEDS = [
  {
    id: "00000000-0000-4000-8000-00000000c001",
    key: CONSENT_KEYS.creatorProfile,
    version: 1,
    title: "Creator Profile",
    purpose: "To create and maintain your CreatorCo Creator Professional Profile and show it to you inside CreatorCo.",
    body: [
      "CreatorCo will use the details you provide during onboarding — your name, display name, location, languages, creator handle, category, platforms you use, business and GST status, and professional interests — to create your Creator Professional Profile.",
      "This consent covers your profile only. It does not cover connecting social accounts, professional analytics, brand matching, checking financial eligibility or sharing information with any financial partner. CreatorCo will ask for each of those separately.",
      "You can withdraw this consent later. Withdrawing it will pause your Creator Professional Profile.",
    ].join("\n\n"),
    activeFrom: new Date("2026-09-01T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c002",
    key: CONSENT_KEYS.identityPrefill,
    version: 1,
    title: "Identity prefill",
    purpose:
      "To fetch the name and PAN-linked details registered to your verified mobile number from a verification partner, so we can prefill your legal name and find your GST registrations.",
    body: [
      "With your permission, CreatorCo will ask a verification partner for the name and PAN linked to the mobile number you just verified. We use the result to prefill your legal name — you can still edit it — and, if you choose, to find GST registrations linked to that PAN.",
      "CreatorCo stores only a masked form of your PAN (for example XXXXX1234X) and the name returned. Your full PAN is used only while the lookup runs and is not stored.",
      "This consent does not cover checking financial eligibility or sharing information with any financial partner. You can withdraw it later.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-01T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c003",
    key: CONSENT_KEYS.socialAccountConnection,
    version: 1,
    title: "Connect a creator account",
    purpose:
      "To connect a social account you choose and read its public profile and performance metrics, so your Creator Passport can show verified activity.",
    body: [
      "When you connect an account, CreatorCo receives — through a connection partner — the account's identifier, handle, creation date and performance metrics such as followers, views, engagement and posting activity. We don't receive your password and we can't post on your behalf.",
      "We store monthly metric snapshots for connected accounts. We don't store the content of your posts or personal data about your followers.",
      "You can disconnect an account at any time. This consent doesn't cover checking financial eligibility or sharing information with financial partners.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-01T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c004",
    key: CONSENT_KEYS.professionalAnalytics,
    version: 1,
    title: "Professional analytics",
    purpose:
      "To analyse your connected-account data and profile into professional signals (such as longevity, consistency and platform mix) shown on your Creator Passport.",
    body: [
      "CreatorCo will compute professional signals from your profile and connected-account metrics — for example how long you've been creating, how consistently you post and how your audience is spread across platforms. Each signal shows where it came from.",
      "These signals describe your creator business. They are not a credit score, and sharing them with any financial partner requires a separate consent.",
      "You can turn professional analytics off at any time.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-01T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c005",
    key: CONSENT_KEYS.financialEligibility,
    version: 1,
    title: "Financial eligibility check",
    purpose:
      "To check your eligibility for creator business finance from partner banks and NBFCs, using a credit bureau summary, summarised bank cashflow you choose to share, and what you tell us.",
    body: [
      "CreatorCo will use your PAN once to request a credit bureau summary through a partner. We keep only the summary — a score band and counts of accounts, recent missed payments and recent enquiries — and a masked PAN (for example XXXXX1234X). We do not store the full report or your full PAN.",
      "If you approve it on the Account Aggregator screen, we receive monthly totals of money in and out of your bank account for up to 12 months — not individual transactions. We also use the income, income sources, existing EMIs, purpose and amount you tell us.",
      "We use this to work out your Financial Capacity and, later, a CreatorCo recommendation. CreatorCo is not a lender: any finance is offered by a regulated partner and is subject to its approval. Nothing is sent to a lender without a separate consent from you.",
      "A check that is not sent to a lender expires after 90 days and its financial inputs are erased. You can withdraw this consent at any time; once a check has been sent to a lender, erasure follows that lender's legal retention requirements.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-01T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c006",
    key: CONSENT_KEYS.financialEligibility,
    version: 2,
    title: "Financial eligibility check",
    purpose:
      "To check your eligibility for creator business finance from partner banks and NBFCs, using a credit bureau summary, summarised bank cashflow you choose to share, what you tell us, and your Creator Professional Profile.",
    body: [
      "CreatorCo will use your PAN once to request a credit bureau summary through a partner. We keep only the summary — a score band and counts of accounts, recent missed payments and recent enquiries — and a masked PAN (for example XXXXX1234X). We do not store the full report or your full PAN.",
      "If you approve it on the Account Aggregator screen, we receive monthly totals of money in and out of your bank account for up to 12 months — not individual transactions. We also use the income, income sources, existing EMIs, purpose and amount you tell us.",
      "To prepare a CreatorCo recommendation we combine these financial inputs with your Creator Professional Profile and, if you have turned them on, your professional signals (such as how long you've been creating and how consistently you post). We also prepare a recommendation from financial information alone, to understand what your creator business adds. A copy of the inputs used is kept with the check so the recommendation can be explained and reproduced.",
      "CreatorCo is not a lender: any finance is offered by a regulated partner and is subject to its approval. Nothing is sent to a lender without a separate consent from you.",
      "A check that is not sent to a lender expires after 90 days and its financial inputs and recommendation are erased. You can withdraw this consent at any time; once a check has been sent to a lender, erasure follows that lender's legal retention requirements.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-02T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c007",
    key: CONSENT_KEYS.financialEligibility,
    version: 3,
    title: "Financial eligibility check",
    purpose:
      "To check your eligibility for creator business finance from partner banks and NBFCs, using a credit bureau summary, summarised bank cashflow you choose to share, what you tell us, and your Creator Professional Profile — including checks that protect you and our partners from fraud.",
    body: [
      "CreatorCo will use your PAN once to request a credit bureau summary through a partner. We keep only the summary — a score band and counts of accounts, recent missed payments and recent enquiries — a masked PAN (for example XXXXX1234X) and a one-way, keyed fingerprint of your PAN used only for the fraud checks below. We do not store the full report or your full PAN.",
      "If you approve it on the Account Aggregator screen, we receive monthly totals of money in and out of your bank account for up to 12 months — not individual transactions. We also use the income, income sources, existing EMIs, purpose and amount you tell us.",
      "To prepare a CreatorCo recommendation we combine these financial inputs with your Creator Professional Profile and, if you have turned them on, your professional signals (such as how long you've been creating and how consistently you post). We also prepare a recommendation from financial information alone, to understand what your creator business adds. A copy of the inputs used is kept with the check so the recommendation can be explained and reproduced.",
      "To protect creators and partners from fraud, we also check the application for inconsistencies — for example whether your name matches your verified identity, whether the same PAN is used on another CreatorCo account, whether your declared income matches your bank data, and whether your connected accounts match what you declared. These checks never decide on their own: anything flagged is reviewed, and a partner lender makes any decision.",
      "CreatorCo is not a lender: any finance is offered by a regulated partner and is subject to its approval. Nothing is sent to a lender without a separate consent from you.",
      "A check that is not sent to a lender expires after 90 days and its financial inputs, fraud-check results and recommendation are erased. You can withdraw this consent at any time; once a check has been sent to a lender, erasure follows that lender's legal retention requirements.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-02T12:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c008",
    key: CONSENT_KEYS.financialEligibility,
    version: 4,
    title: "Financial eligibility check",
    purpose:
      "To check your eligibility for creator business finance from partner banks and NBFCs, using a credit bureau summary, the bank statements you choose to share through an Account Aggregator, what you tell us, and your Creator Professional Profile — including checks that protect you and our partners from fraud.",
    body: [
      "CreatorCo will use your PAN once to request a credit bureau summary through a partner. We keep only the summary — a score band and counts of accounts, recent missed payments and recent enquiries — a masked PAN (for example XXXXX1234X) and a one-way, keyed fingerprint of your PAN used only for the fraud checks below. We do not store the full report or your full PAN.",
      "You choose which bank accounts to share, and approve it on the Account Aggregator's screen — for one or more mobile numbers, each verified by the Account Aggregator with an OTP. For each account you approve we receive up to 12 months of statements: individual transactions and any analysis the Account Aggregator's partner provides. We use them to work out your income from creator work (such as platform payouts, brand payments and affiliate income), leaving out transfers between your own accounts, cash deposits and refunds. We keep the transactions encrypted, in a restricted part of CreatorCo separate from your Creator Profile, never in analytics, and delete them when the Account Aggregator consent's data-life ends or this check closes, whichever is first. We keep the monthly totals worked out from them with the check. We never store the mobile numbers you search, only their last four digits.",
      "We also use the income, income sources, existing EMIs, purposes and amount you tell us. Only income we can verify from your bank data counts towards a recommendation.",
      "To prepare a CreatorCo recommendation we combine these financial inputs with your Creator Professional Profile and, if you have turned them on, your professional signals (such as how long you've been creating and how consistently you post). We also prepare a recommendation from financial information alone, to understand what your creator business adds. A copy of the inputs used is kept with the check so the recommendation can be explained and reproduced.",
      "To protect creators and partners from fraud, we also check the application for inconsistencies — for example whether your name matches your verified identity, whether the same PAN is used on another CreatorCo account, whether your declared income matches your bank data, and whether your connected accounts match what you declared. These checks never decide on their own: anything flagged is reviewed, and a partner lender makes any decision.",
      "CreatorCo is not a lender: any finance is offered by a regulated partner and is subject to its approval. Nothing is sent to a lender without a separate consent from you.",
      "A check that is not sent to a lender expires after 90 days and its financial inputs, bank data, fraud-check results and recommendation are erased. You can withdraw this consent at any time; once a check has been sent to a lender, erasure follows that lender's legal retention requirements.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-03T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c009",
    key: CONSENT_KEYS.lenderSharing,
    version: 1,
    title: "Share with a partner lender",
    purpose:
      "To send your confirmed eligibility checks, as a credit proposal, to a regulated partner bank or NBFC so it can make a decision.",
    body: [
      "When you confirm an eligibility check, CreatorCo will send a credit proposal to a partner lender (a regulated bank or NBFC). This applies to the check you have now and to checks you confirm later, until you withdraw this consent.",
      "The proposal contains: the amount and purposes you asked for; your Financial Capacity (your credit bureau summary, the figures worked out from the bank accounts you shared, and the income, existing EMIs and income sources you told us); both CreatorCo recommendations — with and without your creator business — with their grades, reasons and proposed amounts; which of your bank accounts the figures cover; and the overall result of our fraud checks (clear, watch or review). It does not contain your bank transactions, your full PAN, your connected-account details or the individual signals from your Creator Professional Profile.",
      "Before anything is sent, CreatorCo may review a check. The partner lender decides under its own credit policy, and a CreatorCo reviewer checks the decision before we show it to you. CreatorCo is not a lender. Any offer is made by the partner lender and is subject to its final checks and documents.",
      "Once a proposal has been sent, the partner lender keeps it under its own legal retention rules. You can withdraw this consent at any time: proposals not yet sent are cancelled and future checks won't be sent.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-03T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c010",
    key: CONSENT_KEYS.lenderHandoff,
    version: 1,
    title: "Continue with the partner lender",
    purpose:
      "To pass your acceptance of an offer, and the contact details the partner lender needs, to that lender so it can complete your application.",
    body: [
      "When you accept an offer, CreatorCo tells the partner lender that made it (a regulated bank or NBFC) and shares with it your legal name, your email address and, if you have verified it, your mobile number — so it can contact you to complete your application.",
      "The partner lender then carries out its own checks (such as KYC), shows you its loan agreement and asks you to sign it. Nothing is final until you sign the lender's agreement, and you can still exit during the cooling-off period stated in its Key Fact Statement.",
      "CreatorCo is not a lender. The partner lender keeps what it receives under its own legal retention rules. You can withdraw this consent at any time: CreatorCo then stops passing your details to partner lenders — including for an offer you've accepted whose lender hasn't collected them yet. Details a lender has already received stay with that lender.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-03T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c011",
    key: CONSENT_KEYS.brandOpportunities,
    version: 1,
    title: "Brand opportunities",
    purpose:
      "To consider your requests for brand opportunities in Access, using a summary of your Creator Professional Profile.",
    body: [
      "When you request an opportunity in Access, CreatorCo's partnerships team reviews your request. To do that we use your display name, creator handles, categories, city, Creator Status and a summary of your connected accounts (platforms and total audience), plus any note you add.",
      "During the preview every opportunity and brand is a sample: nothing is sent to any brand and nothing is fulfilled. Sharing your details with a real brand will need a new version of this consent, which we'll ask you for first.",
      "This never includes your financial information, your eligibility checks or anything a partner lender sees. Creator Points used for a request are simulated membership points — not money.",
      "You can withdraw this consent at any time: pending requests are cancelled, their points are returned, and your request history — including your notes — is erased. Points already spent on approved requests aren't returned. CreatorCo keeps a minimal security log of the actions (such as the points involved), without your notes or which opportunities you requested.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-03T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c012",
    key: CONSENT_KEYS.productAnalytics,
    version: 1,
    title: "Product analytics",
    purpose:
      "To understand which CreatorCo screens and features you open, so we can improve them. Optional and off unless you turn it on.",
    body: [
      "With this on, CreatorCo records when you open certain screens — for example an offer or an Access opportunity — under a pseudonymous ID (a coded value, not your name, email or phone number).",
      "These records keep only the day, not the time, and never contain your name, contact details, PAN, handles, notes, bank or bureau information, or an offer's terms, amounts, scores or reasons. Opening an offer records only that you opened one. They stay with CreatorCo and aren't sold or shared with advertisers.",
      "This is separate from the service measurement every member is part of: CreatorCo counts key steps (such as completing your profile or starting an eligibility check) under the same kind of pseudonymous ID to run and improve the service.",
      "You can turn this off at any time in your consent centre: we stop recording screen views and erase the ones already recorded. Records about eligibility checks and offers are also erased if you withdraw your financial-eligibility consent. Raw analytics records are kept for at most 24 months; after that only daily totals (with no IDs) remain.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-28T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c013",
    key: CONSENT_KEYS.brandWorkRecords,
    version: 1,
    title: "Verified brand work",
    purpose:
      "To store the brand-work records and documents you add, have CreatorCo staff verify them, and use verified records in your Creator Professional Graph.",
    body: [
      "When you add a brand collaboration, CreatorCo stores what you enter (the brand, who you billed, platforms, deliverables, dates and, if you add it, the invoice amount) and the documents you upload — invoices, purchase orders, agreements or remittance advice. Documents are kept in private, encrypted storage under a random reference; we don't keep the file name and we don't extract text from them.",
      "A small team of CreatorCo brand-work reviewers opens your documents to check them against the record. Every time a reviewer opens a document is logged. Documents can include details such as your PAN, GSTIN or bank account — those stay inside the documents only and are never copied into CreatorCo's other systems, analytics or logs.",
      "Verified records feed your Creator Professional Graph (for example how many brands you've worked with and how often they come back) and earn Creator Points at milestones. Points are the same however a payment is confirmed, and never depend on how much you were paid.",
      "CreatorCo's partnerships team can see the brands, industries and number of collaborations from records you show on your Passport (never your private records, documents or amounts) when they review your Access requests.",
      "This is not a credit product. Verified brand work is not used to check financial eligibility, by any partner lender or for Creator Status.",
      "You can delete a draft at any time and withdraw this consent at any time: we stop processing straight away and erase your records, documents and their review history. Creator Points you've already earned stay.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-31T00:00:00.000Z"),
  },
  {
    id: "00000000-0000-4000-8000-00000000c014",
    key: CONSENT_KEYS.brandPaymentMatch,
    version: 1,
    title: "Check brand payments in shared bank data",
    purpose:
      "To check bank data you already shared for an eligibility check for a payment matching a verified brand-work record, and record only whether it was seen and in which month.",
    body: [
      "Optional. With this on, when you ask CreatorCo to check a payment, the financial-eligibility part of CreatorCo looks in the Account Aggregator data you already shared for an active eligibility check, while that data is still within its permitted period. It never asks your bank for new data.",
      "Only two things are recorded on your brand-work record: whether a matching payment was seen, and the month. No amount, payer name, narration, account or transaction is copied out of the financial data.",
      "You don't need this to confirm payments: your agency can confirm, or you can upload a remittance advice. Creator Points are the same whichever you choose.",
      "You can withdraw this consent at any time: we stop checking, and payments confirmed this way go back to unconfirmed.",
    ].join("\n\n"),
    activeFrom: new Date("2026-10-31T00:00:00.000Z"),
  },
] as const;

/** The newest seeded version of a purpose (what a creator is asked to agree to now). */
export function currentDefinitionSeed(key: string) {
  const seeds = CONSENT_DEFINITION_SEEDS.filter((d) => d.key === key);
  return [...seeds].sort((a, b) => b.version - a.version)[0];
}
