import { cn } from "@/lib/cn";
import { CREATOR_STATUS_LABELS, type CreatorStatusTier } from "@/modules/creator-status/status";

/**
 * The CreatorCo membership card — a status object, not a payment card. It
 * never shows a credit limit or any financial figure.
 */
export function MembershipCard({
  displayName,
  handle,
  tier,
  memberSince,
  memberNumber,
  className,
}: {
  displayName: string;
  handle: string | null;
  tier: CreatorStatusTier;
  memberSince: string;
  memberNumber: string;
  className?: string;
}) {
  return (
    <figure
      aria-label={`CreatorCo membership card for ${displayName}, Creator Status ${CREATOR_STATUS_LABELS[tier]}`}
      className={cn(
        "relative isolate aspect-[1.586/1] w-full max-w-membership-card overflow-hidden rounded-xl p-5 text-membership-ink sm:p-6",
        "bg-membership-base shadow-membership-card ring-1 ring-(color:--membership-edge) ring-inset",
        className,
      )}
    >
      {/* Brushed-titanium sheen: one soft highlight, not a decorative gradient. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_85%_-10%,var(--membership-sheen),transparent_55%)]"
      />
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-px bg-(--membership-highlight)" />
      <div className="flex h-full flex-col justify-between">
        <div className="flex items-start justify-between">
          <span className="font-serif text-[19px] tracking-tight">
            CreatorCo<span className="text-membership-accent">.</span>
          </span>
          <span className="rounded-full px-2.5 py-1 text-caption-2 font-semibold tracking-[0.14em] text-membership-accent uppercase ring-1 ring-membership-accent/50 ring-inset">
            {CREATOR_STATUS_LABELS[tier]}
          </span>
        </div>
        <div>
          <p className="text-title-2 leading-tight font-semibold tracking-tight sm:text-[24px]">{displayName}</p>
          {handle ? <p className="mt-0.5 text-subhead text-membership-ink/60">@{handle}</p> : null}
        </div>
        <div className="flex items-end justify-between text-caption-2 tracking-[0.12em] text-membership-ink/50 uppercase">
          <span>
            Member since
            <span className="mt-0.5 block text-footnote tracking-normal text-membership-ink/80 normal-case">
              {memberSince}
            </span>
          </span>
          <span className="font-mono tracking-[0.18em] text-membership-ink/70">{memberNumber}</span>
        </div>
      </div>
    </figure>
  );
}
