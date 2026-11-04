import type { PointsTaskStatus } from "@/modules/rewards/tasks-domain";

export const TASK_STATUS: Record<
  PointsTaskStatus,
  { label: string; tone: "info" | "success" | "neutral" | "warning" }
> = {
  proposed: { label: "Awaiting approval", tone: "warning" },
  active: { label: "Live", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
  retired: { label: "Retired", tone: "neutral" },
};
