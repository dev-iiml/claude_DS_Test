import { ImageResponse } from "next/og";

import { colors } from "@/design/tokens";
import { getDb } from "@/db";
import { passportSummaryFor, resolvePassportSlug } from "@/modules/public-passport/page-service";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Verified Creator Passport on CreatorCo";

/**
 * The share image: built from the PUBLIC tier only (`publicSummary`), so a
 * link preview never carries anything locked or hidden. Unknown or gone links
 * get the same generic card.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const r = await resolvePassportSlug(db, slug);
  const summary = r.kind === "live" ? await passportSummaryFor(db, r.passport) : null;
  const c = colors.dark;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: c.paper,
        color: c.ink,
      }}
    >
      <div style={{ display: "flex", fontSize: 30, color: c.gold, letterSpacing: 2 }}>VERIFIED CREATOR PASSPORT</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 700, lineHeight: 1.05 }}>
          {summary?.title ?? "A verified creator"}
        </div>
        {(summary?.lines ?? []).map((line) => (
          <div key={line} style={{ display: "flex", fontSize: 32, marginTop: 16, color: c.inkMuted }}>
            {line}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", fontSize: 28, color: c.inkMuted }}>CreatorCo</div>
    </div>,
    { ...size },
  );
}
