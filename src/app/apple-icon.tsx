import { ImageResponse } from "next/og";

import { colors } from "@/design/tokens";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** App icon: a single champagne mark on near-black (no text, scales to any size). */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.dark.paper,
      }}
    >
      <div
        style={{
          width: 104,
          height: 104,
          borderRadius: 999,
          border: `13px solid ${colors.dark.gold}`,
          borderRightColor: "transparent",
          transform: "rotate(-45deg)",
        }}
      />
    </div>,
    size,
  );
}
