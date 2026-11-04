import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { recordAfterResponse } from "@/app/_lib/analytics";
import { clientIp, rateLimit } from "@/app/_lib/rate-limit";
import { Alert } from "@/components/ui/alert";
import { ComplianceNote, ListGroup, Wordmark } from "@/components/creatorco";
import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { REPORT_REASONS, VERIFIED_BY_NOTE } from "@/modules/public-passport/domain";
import { passportSummaryFor, passportViewFor, resolvePassportSlug } from "@/modules/public-passport/page-service";
import { hasLockedContent } from "@/modules/public-passport/view";

import { PassportRender } from "../_components/passport-render";
import { resolveViewer } from "../_lib/viewer";
import { BrandUnlockForm, ReportForm, UnlockForm } from "./forms";

/**
 * The public Verified Creator Passport. Public entry point: it shows the public
 * tier to anyone, and the unlocked tier only to a viewer the SERVER has
 * verified (a valid code cookie for this passport, or a verified brand's
 * unlock today). Locked values never reach the browser — the view model
 * leaves them out. Gone / unknown links are answered with 410 by the proxy.
 */
export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const db = getDb();
  const r = await resolvePassportSlug(db, slug);
  if (r.kind !== "live") return { title: "Creator Passport", robots: { index: false, follow: false } };
  const summary = await passportSummaryFor(db, r.passport);
  return {
    metadataBase: new URL(getServerEnv().APP_URL),
    title: summary?.title ? `${summary.title} · Creator Passport` : "Creator Passport",
    description: summary?.lines.join(" · ") || "A Verified Creator Passport on CreatorCo.",
    robots: r.passport.indexable ? { index: true, follow: false } : { index: false, follow: false },
  };
}

export default async function PublicPassportPage({ params, searchParams }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  const db = getDb();
  const r = await resolvePassportSlug(db, slug);
  if (r.kind !== "live") notFound();
  const passport = r.passport;

  const limited = !(await rateLimit("passport.public_view", await clientIp())).ok;
  const viewer = limited ? null : await resolveViewer(db, passport);
  const view = viewer ? await passportViewFor(db, passport, viewer.access) : null;
  if (viewer && !view) notFound();
  if (viewer) await recordAfterResponse({ event: "passport_viewed", props: { tier: viewer.access, via: viewer.via } });
  const q = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col pt-safe pb-safe">
      <header className="mx-auto flex h-14 w-full max-w-3xl items-center px-5 sm:px-8">
        <Wordmark />
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-5 py-6 sm:px-8">
        {!viewer || !view ? (
          <Alert tone="warning">Too many requests from your network. Please try again in a little while.</Alert>
        ) : (
          <div className="flex flex-col gap-8">
            {q.reported === "1" ? <Alert tone="success">Thanks — CreatorCo will review this page.</Alert> : null}
            {viewer.isOwner ? (
              <Alert tone="info">
                This is your public Passport as a stranger sees it. Preview the unlocked tier from Passport → Sharing.
              </Alert>
            ) : null}
            {viewer.access === "unlocked" ? (
              <Alert tone="success">
                {viewer.via === "brand" && viewer.brand
                  ? `Unlocked for ${viewer.brand.orgName} today.`
                  : "Unlocked with an access code."}
              </Alert>
            ) : null}

            <PassportRender view={view} photoSrc={`/p/${passport.slug}/photo`} logoBase={`/p/${passport.slug}/logo`} />

            {viewer.access === "locked" && hasLockedContent(view) && !viewer.isOwner ? (
              <section
                aria-labelledby="unlock-heading"
                className="flex flex-col gap-4 rounded-lg bg-surface p-5 ring-1 ring-line ring-inset"
              >
                <h2 id="unlock-heading" className="text-title-3 font-semibold tracking-tight">
                  Unlock the details
                </h2>
                {viewer.brand?.ready && viewer.brand.mayUnlock ? (
                  <BrandUnlockForm slug={passport.slug!} orgName={viewer.brand.orgName} />
                ) : viewer.brand && !viewer.brand.ready ? (
                  <p className="text-subhead text-ink-muted">{viewer.brand.notReadyReason}</p>
                ) : null}
                <p className="text-subhead text-ink-muted">
                  Have an access code from this creator? Enter it to see brand work, audience signals and the other
                  details they share with people they choose.
                </p>
                <UnlockForm slug={passport.slug!} />
              </section>
            ) : null}

            <ListGroup id="verified-by" label="About this Passport" footer={null}>
              {VERIFIED_BY_NOTE.map((line) => (
                <li key={line} className="px-4 py-3 text-footnote leading-relaxed text-ink-muted">
                  {line}
                </li>
              ))}
            </ListGroup>

            <details className="group">
              <summary className="cursor-pointer list-none px-1 text-footnote text-ink-subtle underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
                Report this page
              </summary>
              <div className="mt-3">
                <ReportForm
                  slug={passport.slug!}
                  reasons={REPORT_REASONS.map(([value, label]) => ({ value, label }))}
                />
              </div>
            </details>
          </div>
        )}
        <ComplianceNote className="mt-12" />
      </main>
    </div>
  );
}
