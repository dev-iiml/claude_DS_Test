/** Preview-only specimens for tokens.hit-area. Never imported by the app. */
import * as React from "react";

const Page = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-full bg-paper p-5 text-ink">{children}</div>
);
const pill =
  "inline-flex h-button-sm items-center rounded-full bg-elevated px-4 text-subhead font-semibold ring-1 ring-line ring-inset";

export const SHARED = {};
export const AFTER = {
  HitAreaDemo: () => (
    <Page>
      <div className="flex flex-wrap items-center gap-10 py-6">
        <div className="flex flex-col items-start gap-3">
          <button className={pill}>Without · 36pt target</button>
          <span className="text-footnote text-ink-muted">Only the visible pill responds.</span>
        </div>
        <div className="flex flex-col items-start gap-3">
          <button className={pill + " hit-area"}>With hit-area · 44pt target</button>
          <span className="text-footnote text-ink-muted">Looks identical; the tap target is 44pt tall.</span>
        </div>
      </div>
    </Page>
  ),
};
