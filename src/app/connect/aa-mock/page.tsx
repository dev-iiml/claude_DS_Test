import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Lede, PageHeading } from "@/components/creatorco";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireCreator } from "@/modules/identity";
import { getProviders } from "@/modules/integrations/registry";
import { mockAccountsFor } from "@/providers/financial-data/mock-financial-data-provider";

export const metadata: Metadata = { title: "Test Account Aggregator" };

const REFERENCE = /^aa_[a-z0-9_]{6,120}$/;

/**
 * Stand-in for an Account Aggregator's journey (mock provider only): accounts
 * discovered per verified number, a checkbox per account, and "add another
 * mobile number" verified by a (simulated) OTP inside the journey — as live
 * AAs that support additional numbers do. Only last-four digits travel in URLs.
 */
export default async function MockAggregatorPage({ searchParams }: PageProps<"/connect/aa-mock">) {
  if ((await getProviders()).financialData.descriptor.mode !== "mock") notFound();
  await requireCreator();
  const q = await searchParams;
  const reference = typeof q.reference === "string" ? q.reference : "";
  if (!REFERENCE.test(reference)) notFound();
  const primary = reference.split("_").at(-2) ?? "";
  if (!/^\d{4}$/.test(primary)) notFound();
  const extra = (typeof q.extra === "string" ? q.extra.split(",") : [])
    .filter((x) => /^\d{4}$/.test(x) && x !== primary)
    .slice(0, 2);
  const numbers = [primary, ...new Set(extra)];
  const groups = numbers.map((last4) => ({ last4, accounts: mockAccountsFor(last4) }));
  const found = groups.some((g) => g.accounts.length > 0);
  const error = typeof q.error === "string" ? q.error : null;

  return (
    <div className="flex min-h-dvh flex-col items-center bg-paper px-4 pt-safe pb-safe">
      <main id="main" className="flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-10">
        <p className="self-center rounded-full bg-warning-soft px-3 py-1 text-[13px] font-medium text-warning">
          Test Account Aggregator — simulated
        </p>
        <div>
          <p className="text-[15px] text-ink-muted">Consent request from CreatorCo</p>
          <PageHeading className="mt-1">Choose accounts to share</PageHeading>
          <Lede className="mt-2">
            Statements for the last 12 months, for a financial eligibility check. One-time. You can stop at any time.
          </Lede>
        </div>
        {error ? (
          <p role="alert" className="rounded-[12px] bg-danger-soft px-4 py-3 text-[15px] text-danger">
            {error === "otp"
              ? "Enter the 6-digit OTP (any 6 digits in test mode)."
              : error === "mobile"
                ? "Enter a 10-digit mobile number."
                : "Choose at least one account to share."}
          </p>
        ) : null}

        <form action="/connect/aa-mock/approve" method="post" className="flex flex-col gap-5">
          <input type="hidden" name="reference" value={reference} />
          <input type="hidden" name="extra" value={extra.join(",")} />
          {groups.map((g) => (
            <fieldset key={g.last4} className="flex flex-col gap-2">
              <legend className="mb-2 text-[13px] font-medium text-ink-subtle">
                Accounts linked to ••••••{g.last4} (verified)
              </legend>
              {g.accounts.length ? (
                g.accounts.map((a) => (
                  <label
                    key={a.ref}
                    className="flex items-center gap-3 rounded-[14px] bg-surface p-4 text-[15px] ring-1 ring-line ring-inset"
                  >
                    <input
                      type="checkbox"
                      name="account"
                      value={a.ref}
                      defaultChecked
                      className="size-5 accent-[var(--color-gold)]"
                    />
                    <span>
                      {a.institution} · {a.accountType === "current" ? "Current" : "Savings"} ••
                      {a.maskedNumber.slice(-4)}
                    </span>
                  </label>
                ))
              ) : (
                <p className="rounded-[14px] bg-surface p-4 text-[15px] text-ink-muted ring-1 ring-line ring-inset">
                  No accounts found for this number.
                </p>
              )}
            </fieldset>
          ))}
          {found ? (
            <Button type="submit" name="decision" value="approve" size="lg">
              Approve sharing
            </Button>
          ) : (
            <Button type="submit" name="decision" value="none" size="lg" variant="secondary">
              Return to CreatorCo
            </Button>
          )}
          {found ? (
            <Button type="submit" name="decision" value="reject" size="lg" variant="ghost">
              Reject
            </Button>
          ) : null}
        </form>

        {numbers.length < 3 ? (
          <details className="rounded-[16px] bg-surface p-4 ring-1 ring-line ring-inset">
            <summary className="cursor-pointer text-[15px] font-medium">Add another mobile number</summary>
            <form action="/connect/aa-mock/add-number" method="post" className="mt-4 flex flex-col gap-3">
              <input type="hidden" name="reference" value={reference} />
              <input type="hidden" name="extra" value={extra.join(",")} />
              <label className="flex flex-col gap-1 text-[13px] text-ink-muted">
                Mobile number
                <Input name="mobile" type="tel" inputMode="numeric" autoComplete="off" maxLength={10} />
              </label>
              <label className="flex flex-col gap-1 text-[13px] text-ink-muted">
                OTP sent to that number (test mode: any 6 digits)
                <Input name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
              </label>
              <Button type="submit" variant="secondary">
                Verify and find accounts
              </Button>
            </form>
          </details>
        ) : null}

        <Link href="/eligibility" className="self-center text-[13px] text-ink-subtle underline underline-offset-4">
          Back to CreatorCo
        </Link>
      </main>
    </div>
  );
}
