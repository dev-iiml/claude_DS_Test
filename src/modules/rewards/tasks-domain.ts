/** Staff-defined points tasks: vocabulary (pure). */
export const POINTS_TASK_CATEGORIES = ["content", "community", "events", "profile", "brand"] as const;
export type PointsTaskCategory = (typeof POINTS_TASK_CATEGORIES)[number];

export const POINTS_TASK_CATEGORY_LABELS: Record<PointsTaskCategory, string> = {
  content: "Content",
  community: "Community",
  events: "Events",
  profile: "Profile",
  brand: "Brand work",
};

/** proposed → active (a different admin approves) or rejected; active → retired. */
export const POINTS_TASK_STATUSES = ["proposed", "active", "rejected", "retired"] as const;
export type PointsTaskStatus = (typeof POINTS_TASK_STATUSES)[number];
