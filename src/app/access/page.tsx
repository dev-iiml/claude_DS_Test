import type { Metadata } from "next";

import { PageHeader, StatusBadge } from "@/components/creatorco";
import { SAMPLE_OPPORTUNITIES } from "@/modules/access/sample-opportunities";

import { requireMember } from "../_lib/member";
import { CreatorShell } from "../_components/creator-shell";

export const metadata: Metadata = { title: "Access" };

export default async function AccessPage() {
  await requireMember();
  return (
    <CreatorShell>
      <PageHeader
        title="Access"
        description="Brand programmes, PR and experiences for working creators."
        action={<StatusBadge tone="brand">Preview</StatusBadge>}
      />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SAMPLE_OPPORTUNITIES.map((o) => (
          <li
            key={o.id}
            className="flex min-h-[180px] flex-col justify-between rounded-card bg-surface p-5 ring-1 ring-line ring-inset"
          >
            <p className="text-footnote font-semibold tracking-[var(--tracking-eyebrow)] text-gold uppercase">
              {o.kind}
            </p>
            <div>
              <p className="text-title-2 leading-tight font-semibold tracking-tight">{o.title}</p>
              <p className="mt-1 text-subhead text-ink-muted">{o.category}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-footnote text-ink-subtle">
        Sample preview. Live programmes, requests and Creator Status benefits arrive in a later stage.
      </p>
    </CreatorShell>
  );
}
