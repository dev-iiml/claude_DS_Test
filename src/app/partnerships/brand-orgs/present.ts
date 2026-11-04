import type { OrgStatus } from "@/modules/brand-orgs/domain";

export const ORG_STATUS: Record<OrgStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "Pending", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  suspended: { label: "Suspended", tone: "danger" },
};
