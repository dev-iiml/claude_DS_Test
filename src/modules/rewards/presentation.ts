import { EARN_RULES, type FixedEarnRule } from "./rules";

/** "Ways to earn" for the creator's points page and API (pure). One place, so copy and amounts can't drift. */
export interface EarnGuideRow {
  label: string;
  points: number;
  /** How often: "Once", "Every year", "Each time". */
  frequency: string;
}

export interface EarnGuideGroup {
  key: string;
  label: string;
  footer?: string;
  rows: EarnGuideRow[];
}

const row = (rule: FixedEarnRule, frequency: string, label?: string): EarnGuideRow => ({
  label: label ?? EARN_RULES[rule].label,
  points: EARN_RULES[rule].points,
  frequency,
});

export const EARN_GUIDE: readonly EarnGuideGroup[] = [
  {
    key: "membership",
    label: "Membership",
    footer: "Profile details means what you type in yourself — connecting accounts isn't part of it.",
    rows: [
      row("welcome", "Once"),
      row("mobile_verified", "Once"),
      row("passport_complete", "Once"),
      row("membership_anniversary", "Every year", "Each membership anniversary"),
    ],
  },
  {
    key: "status",
    label: "Creator Status",
    rows: [row("tier_onyx", "Once"), row("tier_icon", "Once")],
  },
  {
    key: "brand_work",
    label: "Verified brand work",
    footer:
      "Payment points are the same however the payment is confirmed. They never depend on how much you were paid.",
    rows: [
      row("brand_work_verified_1", "Once"),
      row("brand_work_verified_5", "Once"),
      row("brand_work_verified_10", "Once"),
      row("brand_work_verified_25", "Once"),
      row("brand_payment_confirmed_1", "Once"),
      row("brand_payment_confirmed_5", "Once"),
      row("brand_payment_confirmed_10", "Once"),
    ],
  },
  {
    key: "access",
    label: "Access",
    footer: "Once the partnerships team confirms you took part. The same for every opportunity.",
    rows: [row("access_completed", "Each time", "Taking part in an approved opportunity")],
  },
];
