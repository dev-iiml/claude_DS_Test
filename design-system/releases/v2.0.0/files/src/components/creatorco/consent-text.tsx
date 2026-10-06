import { cn } from "@/lib/cn";

export interface ConsentTextDefinition {
  id: string;
  title: string;
  purpose: string;
  body: string;
  version: number;
}

/** The exact, versioned consent text the creator is agreeing to. */
export function ConsentText({
  definition,
  id,
  className,
}: {
  definition: ConsentTextDefinition;
  id: string;
  className?: string;
}) {
  return (
    <div id={id} className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-body font-semibold">{definition.title}</p>
        <p className="shrink-0 text-caption text-ink-subtle">Version {definition.version}</p>
      </div>
      <p className="text-subhead leading-snug">{definition.purpose}</p>
      <div className="flex flex-col gap-2.5 text-subhead leading-relaxed text-ink-muted">
        {definition.body.split("\n\n").map((para) => (
          <p key={para.slice(0, 40)}>{para}</p>
        ))}
      </div>
    </div>
  );
}
