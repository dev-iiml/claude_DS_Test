import { ImageResponse } from "next/og";

import { colors } from "@/design/tokens";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** App icon: a single champagne mark on near-black (no text, scales to any size). */
export default function Icon() {
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
          width: 300,
          height: 300,
          borderRadius: 999,
          border: `34px solid ${colors.dark.gold}`,
          borderRightColor: "transparent",
          transform: "rotate(-45deg)",
        }}
      />
    </div>,
    size,
  );
}
