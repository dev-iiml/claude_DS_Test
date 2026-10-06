import { Button } from "@/components/ui/button";

import { discardCheckAction } from "../actions";

const date = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

/**
 * Quiet, two-step way to throw a check away. Kept out of the main path so it
 * never reads as the way a check ends.
 */
export function DiscardCheck({ applicationId, expiresAt }: { applicationId: string; expiresAt: Date }) {
  return (
    <details className="group px-1">
      <summary className="cursor-pointer text-[13px] text-ink-subtle underline-offset-4 hover:underline">
        Don&rsquo;t need this check any more?
      </summary>
      <form action={discardCheckAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="applicationId" value={applicationId} />
        <p className="text-[13px] leading-snug text-ink-subtle">
          Unless it&rsquo;s sent to a partner lender, this check is kept until {date.format(expiresAt)}. Discarding it
          now erases its financial inputs straight away. You can start a new check whenever you like.
        </p>
        <div>
          <Button type="submit" variant="secondary" size="sm">
            Discard this check
          </Button>
        </div>
      </form>
    </details>
  );
}
