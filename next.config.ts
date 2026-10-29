import type { NextConfig } from "next";

import { API_CSP } from "./src/lib/csp";

/**
 * Static security headers for every response. Pages also get a per-request,
 * nonce-based Content-Security-Policy from `src/proxy.ts`; JSON APIs get a
 * deny-all policy here.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Stage 17: a self-contained server for the container image (Cloud Run). Ignored by Vercel.
  output: "standalone",
  // Version-skew protection across rolling deploys: set to the git SHA at build time.
  deploymentId: process.env.DEPLOYMENT_VERSION || undefined,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
    ];
  },
};

export default nextConfig;
