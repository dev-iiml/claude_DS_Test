export const FEATURE_SOURCES = ["verified", "declared", "derived"] as const;
export type FeatureSource = (typeof FEATURE_SOURCES)[number];

export const FEATURE_CONFIDENCE = ["low", "medium", "high"] as const;
export type FeatureConfidence = (typeof FEATURE_CONFIDENCE)[number];

export const GRAPH_RUN_TRIGGERS = ["connection", "manual", "system"] as const;
export type GraphRunTrigger = (typeof GRAPH_RUN_TRIGGERS)[number];
