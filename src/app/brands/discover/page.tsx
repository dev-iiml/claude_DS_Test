import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { BackLink, PageHeader } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDb } from "@/db";
import { discoverCreators, orgDailyQuota, orgUnlocksToday } from "@/modules/brand-orgs/access-service";
import { requireVerifiedBrandMember } from "@/modules/identity";
import { isFeatureEnabled } from "@/modules/integrations/change-service";

import { RATE_LIMITED_MESSAGE, rateLimit } from "../../_lib/rate-limit";
import { BrandShell } from "../../_components/creator-shell";
import { PassportRender } from "../../p/_components/passport-render";
import { BrandUnlockForm } from "../../p/[slug]/forms";

export const metadata: Metadata = { title: "Discover" };

const FILTERS = [
  ["category", "Category"],
  ["platform", "Platform"],
  ["followerBand", "Audience size"],
  ["industry", "Industry"],
  ["city", "City"],
] as const;

/**
 * Discovery (behind the /ops switch, off by default): creators who chose to be
 * found by verified brands, shown from their PUBLIC tier only. Opening one in
 * full is an unlock and counts against the organisation's daily quota.
 */
export default async function DiscoverPage({ searchParams }: PageProps<"/brands/discover">) {
  const user = await requireVerifiedBrandMember();
  const db = getDb();
  if (!(await isFeatureEnabled(db, "brand_discovery"))) notFound();
  const q = await searchParams;
  const filters = Object.fromEntries(
    FILTERS.map(([k]) => [k, typeof q[k] === "string" ? (q[k] as string).slice(0, 40) : ""]),
  ) as Record<(typeof FILTERS)[number][0], string>;
  const limited = !(await rateLimit("brand.discovery", user.userId)).ok;
  const [results, used, quota] = await Promise.all([
    limited ? Promise.resolve([]) : discoverCreators(db, { userId: user.userId, filters }),
    orgUnlocksToday(db, user.membership.orgId, new Date()),
    orgDailyQuota(db, user.membership.orgId),
  ]);

  return (
    <BrandShell>
      <BackLink href="/brands" label="Home" />
      <PageHeader
        title="Discover creators"
        description={`Creators who chose to be found by verified brands. Opening one in full uses an unlock (${used} of ${quota} today).`}
      />
      <div className="flex max-w-3xl flex-col gap-8">
        {limited ? <Alert tone="warning">{RATE_LIMITED_MESSAGE}</Alert> : null}
        <form method="get" role="search" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FILTERS.map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1.5 text-subhead font-medium">
              {label}
              <Input name={k} defaultValue={filters[k]} autoComplete="off" />
            </label>
          ))}
          <div className="flex items-end">
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </div>
        </form>

        {results.length === 0 && !limited ? <p className="text-subhead text-ink-muted">No creators match.</p> : null}
        {results.map((r) => (
          <article key={r.slug} className="flex flex-col gap-5 rounded-lg bg-surface p-5 ring-1 ring-line ring-inset">
            <PassportRender view={r.view} photoSrc={null} logoBase={null} />
            <BrandUnlockForm slug={r.slug} orgName={user.membership.orgName} />
          </article>
        ))}
      </div>
    </BrandShell>
  );
}
