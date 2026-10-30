# Product & design QA — fixes (after Stage 17)

A pass over every creator, onboarding, public and staff screen (dark and light, desktop and iPhone width). Each item
below was fixed; deferred items and why are at the end.

## Points raised by Aman

| Screen                  | Issue                                                     | Fix                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| /passport/connect       | Professional signals toggle should be on by default       | **Kept off** (a pre-ticked consent isn't valid consent under DPDP and CLAUDE.md §24). Instead the row explains the benefit, and the account page and Passport prompt the creator to turn signals on. |
| /passport/accounts/[id] | "Connected" badge sits far from the content on desktop    | New `PageTitle` keeps the badge next to the title column (inline on desktop, under the title on mobile). Disconnect is now two-step.                                                                 |
| /passport/status        | "Onyx"/tier badge sits far from the content               | Same `PageTitle` fix.                                                                                                                                                                                |
| /passport/status        | Points CTA not evident; sentence starts "Rules cs-0.1.0." | Internal rule version removed from creator copy. Creator Points is now a "Rewards" row with a chevron to /access/points.                                                                             |
| /access/[id]            | "Cancel request" sits in a row labelled "Cancel"          | Duplicate label removed; the button stands on its own under "Your request".                                                                                                                          |

## Creator app

- **Passport:** "Connect an account" / "Connect another account" by state; Status row says signals help. Signals page:
  "Calculated" instead of "Derived", engine version removed from the footer, "What you'll see" preview before the
  consent, plainer checkbox label.
- **Status:** "How to be considered", neutral info alert, "You: Not measured yet" no longer repeated next to a "Not
  measured" badge.
- **Dashboard:** no duplicate "80% complete"; a confirmed check shows "Ready to share" with "Review and share"
  (straight to the check); a simulated offer says "Simulated pilot — illustrative terms only"; Access carousel snaps with
  the page gutter; points line links to Creator Points.
- **Access list:** "Your requests" moved above the grid; tier-locked badges read "Onyx+ only" / "Icon only"; closing
  dates include the year; long titles clamp to two lines; "Points history".
- **Access detail:** badge beside the title; request shows its date and your note; zero-cost requests say "No points
  needed."; the tier notice names your Status and links to how Status works; "Other" decline reason no longer shown as
  "— other".
- **Eligibility:** list badge "Ready to share"; step 3 mentions accounts on different mobile numbers; number circles
  visible in light mode; disclaimer aligned with the list text.
  - Details: "What would you use the funds for?", "Choose all that apply." for income sources, narrower rupee fields.
  - Credit check: discloses that the bureau records an enquiry before you submit; no realistic-looking PAN placeholder.
  - Bank: "Continue without bank data" is a visible secondary button; searching another number is secondary once one is
    done; test-number rules only outside production.
  - Check page: lender status first; "(simulated pilot)" in titles and badges from "Preparing" onwards; offer shows
    "₹x a month for N months", "Annual Percentage Rate (APR)" with a plain explanation, valid-until date only; the Key
    Fact Statement is a visible Show/Hide control; "Decline this offer" is a button; "Amount you asked for";
    "What happens next" hidden once the check is with a lender.
- **Account:** email as detail text; unverified mobile links to About you; Sign out is secondary, not destructive.
- **Consents:** agree checkbox no longer repeats the version; badges beside titles; receipt badge "Given"/"Withdrawn"
  (matches the receipt list), short reference with the full ID kept below, dates don't wrap, unknown sources show
  "CreatorCo".
- **Onboarding:** business step links to the right About page (onboarding vs Passport edit); clearer display-name and
  mobile/PAN copy; categories hint only when more than one is chosen; handle not pre-filled twice.
- **Public:** landing hero drops the duplicate "I'm a member" (Sign in is in the header); sign-up measurement note says
  where to find it after joining; 404 sends signed-in people to their home.
- **Copy:** seed "loan kit" → "a kit to use for three months"; points terms no longer mention borrowing.

## Staff consoles

- **/admin:** current subtitle (points to Underwriting and Proposals); provider health in words ("Not checked yet");
  provider kinds, check statuses and consent purposes in plain labels; "1 membership"/"2 memberships".
- **Underwriting:** grade legend (A strongest → E); outcome and fraud badges in sentence case. Run detail: fraud checks
  read "Not detected / Detected" instead of "Passed" (so "Name differs…" + "Passed" can't be misread); "High severity".
- **Proposals:** "overrideed" typo fixed; status reads "Reviewed · confirmed/overridden" once reviewed; "Note" no
  longer shows "(optional)" twice; override reason and partner query marked required; "1 attempt".
- **Models:** policy fields marked required; clearer eyebrow.
- **/ops:** kill switch summary shows its state; partner key example no longer names a real bank.
- **/partnerships:** decline reason marked required; "Icon only"; "Close opportunity".

## Deferred

| Item                                                                                            | Why                                                             |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| KFS fields (net disbursed amount, penal/foreclosure charges, LSP)                               | Needs counsel and a partner-schema change (`offerTermsSchema`). |
| Consent text structure and names                                                                | Text changes need new consent versions and counsel review.      |
| Membership card number, switch colour, ConsentText "Version", sticky footers                    | Owned by design-system v2.0.0; needs a DS release.              |
| Signals toggle on by default                                                                    | Pre-ticked consent — declined (see above).                      |
| Forgot password, account-page mobile verification, underwriting rerun/filters/search            | New features, not fixes.                                        |
| /insights label renames, run-detail section order and reason-code chips, one shared date format | Lower priority; next design pass.                               |
