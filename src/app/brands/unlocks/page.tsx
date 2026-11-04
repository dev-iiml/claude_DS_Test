import Link from "next/link";
import type { Metadata } from "next";

import { BackLink, ListGroup, ListRow, PageHeader } from "@/components/creatorco";
import { getDb } from "@/db";
import { orgUnlockHistory } from "@/modules/brand-orgs/access-service";
import { requireVerifiedBrandMember } from "@/modules/identity";

import { BrandShell } from "../../_components/creator-shell";

export const metadata: Metadata = { title: "Unlocks" };

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export default async function BrandUnlocksPage() {
  const user = await requireVerifiedBrandMember();
  const rows = await orgUnlockHistory(getDb(), user.membership.orgId);
  return (
    <BrandShell>
      <BackLink href="/brands" label="Home" />
      <PageHeader title="Unlocks" description="Passports your organisation unlocked." />
      <div className="max-w-2xl">
        <ListGroup id="history" label="History" footer="Creators see each unlock with your organisation's name.">
          {rows.length ? (
            rows.map((r, i) => (
              <ListRow
                key={`${r.slug}-${r.day}-${i}`}
                label={
                  r.slug ? (
                    <Link href={`/p/${r.slug}`} className="text-gold">
                      /p/{r.slug}
                    </Link>
                  ) : (
                    "A Passport no longer online"
                  )
                }
                value={dayFmt.format(new Date(`${r.day}T00:00:00Z`))}
              />
            ))
          ) : (
            <ListRow label="No unlocks yet" />
          )}
        </ListGroup>
      </div>
    </BrandShell>
  );
}
