import { PageHeader } from "@/components/creatorco";
import { cn } from "@/lib/cn";

/**
 * PageHeader aligned to the page's content column (QA pass). A status badge sits at the right edge of that column on
 * larger screens — not at the far edge of the window — and drops below the title on phones so it never squeezes it.
 */
export function PageTitle({
  eyebrow,
  title,
  description,
  status,
  className = "max-w-2xl",
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  status?: React.ReactNode;
  /** Width of the page's content column. */
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)}>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={status ? <span className="hidden sm:inline-flex">{status}</span> : undefined}
      />
      {status ? <div className="-mt-3 mb-6 sm:hidden">{status}</div> : null}
    </div>
  );
}
