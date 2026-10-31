/**
 * Creator Points rules — pure.
 *
 * Creator Points are a simulated membership currency for requesting Access:
 * not cash, not transferable, not withdrawable, not denominated in rupees, no
 * P2P transfer (CLAUDE.md §18).
 *
 * pts-0.2.0 (Stage 18): points reward membership milestones, Creator Status and
 * verified professional outcomes (verified brand work, confirmed brand
 * payments, completed Access opportunities and staff-defined tasks). HOW
 * something is verified never changes the points. Points are never given for
 * applying for credit, or for granting, renewing or keeping any consent
 * (including Account Aggregator consent), and never scale with money amounts.
 *
 * Any change to an amount or a rule bumps POINTS_RULES_VERSION; each earned
 * entry records the version it was granted under.
 */
export const POINTS_RULES_VERSION = "pts-0.2.0";

/** What can trigger an earn rule. A test keeps consents, credit and bank data out of this list. */
export const EARN_TRIGGERS = [
  "membership",
  "identity",
  "status",
  "profile",
  "tenure",
  "access_participation",
  "staff_task",
  "brand_work_verified",
  "brand_payment_confirmed",
] as const;
export type EarnTrigger = (typeof EARN_TRIGGERS)[number];

/** How often a rule can be earned: once ever, or once per year / request / task (the reference). */
export type EarnRepeat = "once" | "per_year" | "per_request" | "per_task";

interface RuleDef {
  /** Fixed points; `null` only for staff tasks, whose points are set (within bounds) on the task. */
  points: number | null;
  label: string;
  trigger: EarnTrigger;
  repeat: EarnRepeat;
}

export const EARN_RULES = {
  welcome: { points: 500, label: "Welcome to CreatorCo", trigger: "membership", repeat: "once" },
  mobile_verified: { points: 100, label: "Verified your mobile number", trigger: "identity", repeat: "once" },
  tier_onyx: { points: 1_000, label: "Reached Onyx", trigger: "status", repeat: "once" },
  tier_icon: { points: 2_500, label: "Reached Icon", trigger: "status", repeat: "once" },
  passport_complete: { points: 250, label: "Completed your profile details", trigger: "profile", repeat: "once" },
  membership_anniversary: { points: 300, label: "Membership anniversary", trigger: "tenure", repeat: "per_year" },
  access_completed: {
    points: 150,
    label: "Completed an Access opportunity",
    trigger: "access_participation",
    repeat: "per_request",
  },
  task_completed: { points: null, label: "Completed a task", trigger: "staff_task", repeat: "per_task" },
  brand_work_verified_1: {
    points: 250,
    label: "First verified brand work",
    trigger: "brand_work_verified",
    repeat: "once",
  },
  brand_work_verified_5: {
    points: 500,
    label: "5 verified brand collaborations",
    trigger: "brand_work_verified",
    repeat: "once",
  },
  brand_work_verified_10: {
    points: 750,
    label: "10 verified brand collaborations",
    trigger: "brand_work_verified",
    repeat: "once",
  },
  brand_work_verified_25: {
    points: 1_500,
    label: "25 verified brand collaborations",
    trigger: "brand_work_verified",
    repeat: "once",
  },
  brand_payment_confirmed_1: {
    points: 200,
    label: "First confirmed brand payment",
    trigger: "brand_payment_confirmed",
    repeat: "once",
  },
  brand_payment_confirmed_5: {
    points: 400,
    label: "5 confirmed brand payments",
    trigger: "brand_payment_confirmed",
    repeat: "once",
  },
  brand_payment_confirmed_10: {
    points: 600,
    label: "10 confirmed brand payments",
    trigger: "brand_payment_confirmed",
    repeat: "once",
  },
} as const satisfies Record<string, RuleDef>;
export type EarnRule = keyof typeof EARN_RULES;
export const EARN_RULE_CODES = Object.keys(EARN_RULES) as EarnRule[];

/** Fixed-point rules (everything except staff tasks). */
export type FixedEarnRule = Exclude<EarnRule, "task_completed">;

/** Staff tasks: points are set on the task within these bounds. */
export const TASK_POINTS_MIN = 50;
export const TASK_POINTS_MAX = 1_000;

/** Milestones for verified brand work and confirmed payments: counts in, rules out. Never an amount. */
export const BRAND_WORK_MILESTONES = [1, 5, 10, 25] as const;
export const BRAND_PAYMENT_MILESTONES = [1, 5, 10] as const;

export function brandWorkMilestoneRules(verifiedCount: number): EarnRule[] {
  return BRAND_WORK_MILESTONES.filter((m) => verifiedCount >= m).map((m) => `brand_work_verified_${m}` as EarnRule);
}

/** The same rules whatever the confirmation method (agency, remittance advice or bank data): method isn't an input. */
export function brandPaymentMilestoneRules(confirmedCount: number): EarnRule[] {
  return BRAND_PAYMENT_MILESTONES.filter((m) => confirmedCount >= m).map(
    (m) => `brand_payment_confirmed_${m}` as EarnRule,
  );
}

/** Membership years completed by `now` (1 on the first anniversary). */
export function membershipYears(memberSince: Date, now: Date): number {
  let years = now.getUTCFullYear() - memberSince.getUTCFullYear();
  const anniversary = new Date(memberSince);
  anniversary.setUTCFullYear(memberSince.getUTCFullYear() + years);
  if (anniversary.getTime() > now.getTime()) years -= 1;
  return Math.max(0, years);
}

/**
 * Idempotency key, unique per creator: the rule code, plus the reference for
 * repeatable rules (`membership_anniversary:2`, `access_completed:<request>`,
 * `task_completed:<task>`).
 */
export function earnKeyFor(rule: EarnRule, ref?: string | number): string {
  const repeat = EARN_RULES[rule].repeat;
  // A once-only milestone that was reversed can be earned again under a new key (`brand_work_verified_5:1`).
  if (repeat === "once") return ref === undefined || ref === "" || ref === 0 ? rule : `${rule}:${ref}`;
  if (ref === undefined || ref === "") throw new Error(`${rule} needs a reference`);
  return `${rule}:${ref}`;
}

/** The earn key a reversal uses (unique, so a grant is reversed at most once). */
export function reverseKeyFor(earnKey: string): string {
  return `reverse:${earnKey}`;
}

/**
 * Ledger entry types: earn (+), hold (−, a pending request), release (+, the
 * hold returned), reverse (−, an earn undone after a verification is reversed).
 */
export const LEDGER_ENTRY_TYPES = ["earn", "hold", "release", "reverse"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/** "1,500 points" — never a rupee symbol. */
export function formatPoints(n: number): string {
  return `${new Intl.NumberFormat("en-IN").format(n)} ${Math.abs(n) === 1 ? "point" : "points"}`;
}

export const POINTS_TERMS = [
  "Creator Points have no cash value and aren't money.",
  "They can't be transferred, sold, exchanged or withdrawn.",
  "They're earned for membership milestones, Creator Status and verified professional work — verified brand work, confirmed brand payments, completed Access opportunities and CreatorCo tasks.",
  "How a payment is confirmed doesn't change your points.",
  "They're never given for applying for credit or for giving or renewing consent.",
] as const;

/**
 * Staff tasks are reviewed against these before they can go live: a task
 * mustn't reward consents, data sharing, bank data or anything credit-related.
 * Pure; a second staff member still approves every task.
 */
const TASK_BLOCKLIST: readonly [label: string, re: RegExp][] = [
  ["consent", /\bconsent/],
  ["permission", /\bpermission/],
  ["credit", /\bcredit/],
  ["loan", /\bloans?\b/],
  ["borrow", /\bborrow/],
  ["lend", /\blend(ing|er)?\b/],
  ["emi", /\bemis?\b/],
  ["eligibility", /\beligib/],
  ["bureau", /\bbureau/],
  ["cibil", /\bcibil/],
  ["bank", /\bbank/],
  ["account aggregator", /\baccount aggregator/],
  ["upi", /\bupi\b/],
  ["kyc", /\bkyc\b/],
  ["pan", /\bpan\b/],
  ["aadhaar", /\baadhaa?r/],
  ["share data", /\bshare (your )?data\b/],
  ["offer", /\b(credit|loan|card) offers?\b/],
  ["apply for", /\bapply for\b/],
];

export function taskGuardrailViolations(text: string): string[] {
  const t = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  return TASK_BLOCKLIST.filter(([, re]) => re.test(t)).map(([label]) => label);
}
