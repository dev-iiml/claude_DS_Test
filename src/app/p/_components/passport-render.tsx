import { BadgeCheck, Lock, UserRound } from "lucide-react";

import { Eyebrow, ListGroup, ListRow } from "@/components/creatorco";
import { LOCKED_HINT } from "@/modules/public-passport/domain";
import type { PublicPassportView, ViewSection } from "@/modules/public-passport/view";

/**
 * Renders a passport VIEW MODEL — nothing else. Whatever the view model left
 * out (a locked section's values, names, counts) can't appear here: locked
 * sections render a fixed number of same-size placeholder rows, whatever they
 * hide. Shared by the public page, the creator's preview and discovery cards.
 */

function Monogram({ text, size = "size-9" }: { text: string; size?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex ${size} items-center justify-center rounded-full bg-elevated text-subhead font-semibold text-ink-muted ring-1 ring-line ring-inset`}
    >
      {text.trim().charAt(0).toUpperCase() || "·"}
    </span>
  );
}

/** One placeholder row: the same shapes and widths for every locked value. */
function LockedRow() {
  return (
    <li className="flex min-h-row items-center gap-3 px-4 py-2.5" aria-hidden="true">
      <span className="h-3 w-28 rounded-full bg-elevated blur-[1.5px]" />
      <span className="ml-auto h-3 w-20 rounded-full bg-elevated blur-[1.5px]" />
    </li>
  );
}

function Section({ section, logoBase }: { section: ViewSection; logoBase: string | null }) {
  const id = `pp-${section.field}`;
  if (section.state === "locked") {
    return (
      <ListGroup
        id={id}
        label={section.title}
        action={<Lock aria-label="Locked" className="size-4 text-ink-subtle" strokeWidth={2} />}
        footer={LOCKED_HINT}
      >
        {Array.from({ length: section.placeholders }, (_, i) => (
          <LockedRow key={i} />
        ))}
        <li className="sr-only">Locked.</li>
      </ListGroup>
    );
  }
  if (section.state === "empty") {
    return (
      <ListGroup id={id} label={section.title}>
        <ListRow label={section.message} />
      </ListGroup>
    );
  }
  return (
    <ListGroup
      id={id}
      label={section.title}
      footer={`${section.source}${section.asOf ? ` · as of ${section.asOf}` : ""}`}
    >
      {section.rows.map((r) => (
        <ListRow
          key={`${r.label}-${r.value}`}
          label={r.label}
          value={r.value}
          leading={
            section.field === "brands" ? (
              r.logoBrandId && logoBase ? (
                // eslint-disable-next-line @next/next/no-img-element -- served by our own guarded route
                <img
                  src={`${logoBase}/${r.logoBrandId}`}
                  alt=""
                  width={36}
                  height={36}
                  className="size-9 rounded-full object-cover ring-1 ring-line"
                />
              ) : (
                <Monogram text={r.label} />
              )
            ) : undefined
          }
        />
      ))}
    </ListGroup>
  );
}

export function PassportRender({
  view,
  /** Where the photo is served from (`/p/<slug>/photo`, or the owner's own route); null shows a monogram. */
  photoSrc,
  /** `/p/<slug>/logo` on the public page; null shows monograms (previews). */
  logoBase,
}: {
  view: PublicPassportView;
  photoSrc: string | null;
  logoBase: string | null;
}) {
  const h = view.header;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start gap-4">
        {h.locked ? (
          <span
            aria-hidden="true"
            className="flex size-16 items-center justify-center rounded-full bg-elevated ring-1 ring-line ring-inset"
          >
            <UserRound className="size-7 text-ink-subtle" strokeWidth={1.75} />
          </span>
        ) : h.hasPhoto && photoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by our own guarded route
          <img
            src={photoSrc}
            alt=""
            width={64}
            height={64}
            className="size-16 rounded-full object-cover ring-1 ring-line"
          />
        ) : (
          <Monogram text={h.displayName ?? ""} size="size-16" />
        )}
        <div className="min-w-0">
          <Eyebrow className="flex items-center gap-1.5">
            <BadgeCheck aria-hidden="true" className="size-4 text-gold" strokeWidth={2} />
            Verified Creator Passport
          </Eyebrow>
          <h1 className="text-title-1 font-bold tracking-tight">{h.displayName ?? "A verified creator"}</h1>
          {h.locked ? (
            <p className="mt-1 text-subhead text-ink-muted">Name and photo: {LOCKED_HINT.toLowerCase()}.</p>
          ) : h.bio ? (
            <p className="mt-1 max-w-prose text-body text-ink-muted">{h.bio}</p>
          ) : null}
        </div>
      </header>
      {view.sections.map((s) => (
        <Section key={s.field} section={s} logoBase={logoBase} />
      ))}
    </div>
  );
}
