import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "./globals.css";

import type { Metadata, Viewport } from "next";

import { colors } from "@/design/tokens";
import { getAppearance } from "@/lib/appearance";

export const metadata: Metadata = {
  title: { default: "CreatorCo", template: "%s · CreatorCo" },
  description: "A premium professional and financial network for creators in India.",
  robots: { index: false, follow: false },
  applicationName: "CreatorCo",
  appleWebApp: { capable: true, title: "CreatorCo", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false, email: false, address: false },
};

export async function generateViewport(): Promise<Viewport> {
  const appearance = await getAppearance();
  const themeColor =
    appearance === "system"
      ? [
          { media: "(prefers-color-scheme: dark)", color: colors.dark.paper },
          { media: "(prefers-color-scheme: light)", color: colors.light.paper },
        ]
      : colors[appearance].paper;
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor,
    colorScheme: appearance === "system" ? "dark light" : appearance,
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const appearance = await getAppearance();
  return (
    <html lang="en-IN" data-theme={appearance} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
