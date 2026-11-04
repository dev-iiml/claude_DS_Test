# rewards (Stage 14, points v0.2 in the QA follow-ups)

Creator Points: a simulated, append-only membership ledger (earn / hold / release / spend / reverse). Not cash, not
transferable, not withdrawable, never rupee-denominated.

Earn rules live in `rules.ts` (`POINTS_RULES_VERSION`, currently `pts-0.2.0`); any change bumps the version.

| Rule                                 | Points                  | Repeats                                  |
| ------------------------------------ | ----------------------- | ---------------------------------------- |
| Welcome / verified mobile            | 500 / 100               | once                                     |
| Completed profile details            | 250                     | once                                     |
| Membership anniversary               | 300                     | once per year (daily sweep)              |
| Creator Status tiers (Onyx / Icon)   | 1,000 / 2,500           | once per tier                            |
| Took part in an Access opportunity   | 150                     | once per request                         |
| Staff task (four-eyes catalogue)     | 50–1,000 (fixed)        | once per creator per task                |
| Verified brand work: 1 / 5 / 10 / 25 | 250 / 500 / 750 / 1,500 | once each (re-earnable after a reversal) |
| Confirmed brand payments: 1 / 5 / 10 | 200 / 400 / 600         | once each, method-neutral                |

Hard rules:

- Never for a consent (giving, renewing or keeping one), data sharing, credit actions or an amount. The profile-details
  milestone deliberately excludes consent and connected-account items; brand milestones read counts only (a unit test
  checks `brand-work/points.ts` reads no amount, consent or confirmation method).
- No manual points tool: staff tasks are proposed by one partnerships admin, approved by another, have fixed points and
  pass a wording guardrail (`taskGuardrailViolations`); completion is recorded by a partnerships admin with a checked
  note. (Open question for Aman: a single admin can still mark a task done.)
- Balance changes take `lockPointsAccount`. `reversePoints` cancels pending Access holds first and floors at zero.
- Brand-work points are reconciled by `brand-work/points.ts`: milestones are granted when counts reach them; they are
  reversed **only** for an approved reversal, and only the milestone that record had reached. Consent withdrawal and a
  bank-data reset never take points back.
