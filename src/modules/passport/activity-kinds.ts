/** Activity groups the creator can filter by. Pure. */
export const ACTIVITY_KINDS = ["profile", "identity", "consent", "accounts", "signals"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  profile: "Profile",
  identity: "Identity",
  consent: "Consents",
  accounts: "Social accounts",
  signals: "Signals",
};
