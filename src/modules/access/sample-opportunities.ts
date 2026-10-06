/**
 * Static preview of Access opportunities. Clearly labelled as samples in the UI;
 * no requests, points or redemptions exist yet (Stage 14).
 */
export interface SampleOpportunity {
  id: string;
  title: string;
  kind: "PR drop" | "Programme" | "Experience" | "Event";
  category: string;
}

export const SAMPLE_OPPORTUNITIES: readonly SampleOpportunity[] = [
  { id: "sample-beauty-drop", title: "Luxury Beauty Drop", kind: "PR drop", category: "Beauty" },
  {
    id: "sample-camera-programme",
    title: "Camera Creator Programme",
    kind: "Programme",
    category: "Photography & film",
  },
  { id: "sample-hotel-weekend", title: "Creator Hotel Weekend", kind: "Experience", category: "Travel" },
];
