import Link from "next/link";
import type { Metadata } from "next";

import { BackLink, ListGroup, ListRow, PageHeader, StatusBadge } from "@/components/creatorco";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { CONSENT_KEYS, hasValidConsent } from "@/modules/consent";
import { listAccessCodes, type CodeStatus } from "@/modules/public-passport/codes-service";

import { requireMember } from "../../../_lib/member";
import { CreatorShell } from "../../../_components/creator-shell";
import { revokeCodeAction } from "../actions";
import { CodeForm } from "./code-form";

export const metadata: Metadata = { title: "Access codes" };

const STATUS: Record<CodeStatus, { label: string; tone: "success" | "neutral" | "warning" }> = {
  active: { label: "Active", tone: "success" },
  expired: { label: "Expired", tone: "neutral" },
  used_up: { label: "Used up", tone: "neutral" },
  revoked: { label: "Revoked", tone: "warning" },
};

const day = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export default async function AccessCodesPage({ searchParams }: PageProps<"/passport/sharing/codes">) {
  const { user } = await requireMember();
  const db = getDb();
  const q = await searchParams;
  const allowed = await hasValidConsent(db, user.userId, CONSENT_KEYS.passportUnlock);
  const codes = await listAccessCodes(db, user.userId);

  return (
    <CreatorShell>
      <BackLink href="/passport/sharing" label="Sharing" />
      <PageHeader
        title="Access codes"
        description="Give a code to someone you choose. With it they can unlock the details you share with unlockers, for up to a day at a time."
      />
      {q.notice === "revoked" ? (
        <Alert tone="success" className="mb-6">
          Code revoked. Anyone using it is locked out straight away.
        </Alert>
      ) : q.notice === "revoke_failed" ? (
        <Alert tone="danger" className="mb-6">
          We couldn&apos;t revoke that code.
        </Alert>
      ) : null}

      <div className="flex max-w-2xl flex-col gap-10">
        {allowed ? (
          <section aria-labelledby="new-code-heading" className="flex flex-col gap-4">
            <h2 id="new-code-heading" className="text-title-3 font-semibold tracking-tight">
              New code
            </h2>
            <CodeForm />
          </section>
        ) : (
          <Alert tone="info">
            Choose who can unlock your Passport first.{" "}
            <Link href="/passport/sharing#unlock" className="text-gold underline-offset-2 hover:underline">
              Go to Sharing
            </Link>
          </Alert>
        )}

        <ListGroup
          id="codes"
          label="Your codes"
          footer="Codes are stored only as a fingerprint — CreatorCo can't show them again."
        >
          {codes.length ? (
            codes.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-body font-medium">{c.label}</p>
                  <StatusBadge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</StatusBadge>
                </div>
                <p className="text-footnote text-ink-muted">
                  Ends …{c.hint} · {c.uses}
                  {c.maxUses !== null ? ` of ${c.maxUses}` : ""} {c.uses === 1 && c.maxUses === null ? "use" : "uses"} ·{" "}
                  {c.status === "active" ? `expires ${day.format(c.expiresAt)}` : `created ${day.format(c.createdAt)}`}
                  {c.lastUsedAt ? ` · last used ${day.format(c.lastUsedAt)}` : ""}
                  {c.orgName ? ` · only for ${c.orgName}` : ""}
                </p>
                {c.status === "active" ? (
                  <form action={revokeCodeAction}>
                    <input type="hidden" name="codeId" value={c.id} />
                    <Button type="submit" size="sm" variant="destructive" aria-label={`Revoke code ${c.label}`}>
                      Revoke
                    </Button>
                  </form>
                ) : null}
              </li>
            ))
          ) : (
            <ListRow label="No codes yet" />
          )}
        </ListGroup>
      </div>
    </CreatorShell>
  );
}
