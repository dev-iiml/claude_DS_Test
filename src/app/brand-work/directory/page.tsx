import type { Metadata } from "next";

import { ListGroup, ListRow, PageHeader } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDb } from "@/db";
import { listIndustries, listOpenMerges, searchDirectory } from "@/modules/brand-work";
import { requireBrandWorkReviewer } from "@/modules/identity";

import { BrandWorkShell } from "../../_components/creator-shell";
import { CreateBrandForm, DecideMergeForm, DirectoryEditForm } from "../forms";

export const metadata: Metadata = { title: "Brand directory" };

const NOTICES: Record<string, string> = {
  created: "Brand added.",
  saved: "Saved.",
  merge_approved: "Merged. Records and aliases now point to the surviving brand.",
  merge_declined: "Merge declined.",
};

export default async function DirectoryPage({ searchParams }: PageProps<"/brand-work/directory">) {
  const staff = await requireBrandWorkReviewer();
  const q = await searchParams;
  const term = typeof q.q === "string" ? q.q.slice(0, 60) : undefined;
  const db = getDb();
  const [brands, all, industries, merges] = await Promise.all([
    searchDirectory(db, term),
    searchDirectory(db, undefined),
    listIndustries(db),
    listOpenMerges(db),
  ]);
  const industryOptions = industries.map((i) => ({ value: i.code, label: i.label }));
  const industryLabel = new Map(industries.map((i) => [i.code, i.label]));
  const brandOptions = all.map((b) => ({ value: b.id, label: b.name }));
  const notice = typeof q.notice === "string" ? NOTICES[q.notice] : undefined;

  return (
    <BrandWorkShell role={staff.role}>
      <PageHeader
        eyebrow="Internal · reference data"
        title="Brand directory"
        description="One entry per brand, with aliases for the spellings creators use. Brands that records point to are merged, never deleted; a merge needs a second reviewer."
      />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="flex flex-col gap-6">
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {merges.length ? (
            <ListGroup id="merges" label="Merges waiting for approval">
              {merges.map((m) => (
                <li key={m.id} className="flex flex-col gap-2 px-4 py-3">
                  <span className="text-body">
                    {m.fromName} → {m.intoName}
                  </span>
                  {m.proposedBy === staff.userId ? (
                    <span className="text-footnote text-ink-muted">You proposed this — another reviewer decides.</span>
                  ) : (
                    <DecideMergeForm mergeId={m.id} />
                  )}
                </li>
              ))}
            </ListGroup>
          ) : null}
          <form method="get" role="search" aria-label="Search brands" className="flex gap-2">
            <Input name="q" defaultValue={term ?? ""} placeholder="Search brands" aria-label="Search brands" />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          <ListGroup id="brands" label={term ? `Matching “${term}”` : "All brands"}>
            {brands.length ? (
              brands.map((b) => (
                <li key={b.id} className="px-4 py-3">
                  <details>
                    <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 [&::-webkit-details-marker]:hidden">
                      <span className="text-body font-medium">{b.name}</span>
                      <span className="text-footnote text-ink-subtle">
                        {industryLabel.get(b.industryCode) ?? b.industryCode} · {b.records} record
                        {b.records === 1 ? "" : "s"}
                      </span>
                    </summary>
                    <p className="mt-2 text-footnote text-ink-muted">
                      Aliases: {b.aliases.length ? b.aliases.join(", ") : "none"}
                    </p>
                    <DirectoryEditForm
                      directoryId={b.id}
                      industries={industryOptions}
                      brands={brandOptions}
                      industry={b.industryCode}
                    />
                  </details>
                </li>
              ))
            ) : (
              <ListRow label="No brands found" />
            )}
          </ListGroup>
        </div>
        <section aria-labelledby="add-heading" className="flex flex-col gap-3">
          <h2 id="add-heading" className="text-title-3 font-semibold tracking-tight">
            Add a brand
          </h2>
          <CreateBrandForm industries={industryOptions} />
        </section>
      </div>
    </BrandWorkShell>
  );
}
