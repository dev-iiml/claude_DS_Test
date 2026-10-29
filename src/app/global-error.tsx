"use client";

import Link from "next/link";

/**
 * Last-resort error page (an error in the root layout). It is prerendered, so
 * under the per-request CSP its scripts may not run (they carry no nonce): it
 * is written to work without JavaScript — a plain link home — and styled with
 * attributes only, following the OS colour scheme. Never shows error details.
 */
export default function GlobalError() {
  return (
    <html lang="en-IN">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          colorScheme: "dark light",
        }}
      >
        <main style={{ maxWidth: "32rem", padding: "1.25rem" }}>
          <title>Something went wrong · CreatorCo</title>
          <p style={{ letterSpacing: "0.2em", fontSize: "0.75rem", textTransform: "uppercase" }}>CreatorCo</p>
          <h1 style={{ fontSize: "1.75rem", margin: "1.5rem 0 0.75rem" }}>Something went wrong</h1>
          <p style={{ opacity: 0.75, lineHeight: 1.5 }}>
            We couldn&rsquo;t load this page just now. Your progress is saved — please try again.
          </p>
          <p style={{ marginTop: "1.5rem" }}>
            {/* A real link: works even if the page's scripts don't run. */}
            <Link href="/" style={{ color: "inherit", fontWeight: 600 }}>
              Go to CreatorCo
            </Link>
          </p>
        </main>
      </body>
    </html>
  );
}
