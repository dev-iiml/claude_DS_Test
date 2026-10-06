/** Preview-only specimens for membership.verification-derived. Never imported by the app. */
import * as React from "react";

import { ListGroup, ListRow, VerificationMark } from "@/components/creatorco";

export const SHARED = {};
export const AFTER = {
  VerificationDerived: () => (
    <div className="min-h-full max-w-xl bg-paper p-5 text-ink">
      <ListGroup id="ver" label="Verification" footer="2 of 5 details verified or derived from verified data.">
        <ListRow leading={<VerificationMark state="missing" />} label="Mobile number" detail="Not provided · Add" />
        <ListRow leading={<VerificationMark state="declared" />} label="Legal name" detail="Self-declared" />
        <ListRow leading={<VerificationMark state="attention" />} label="GST registration" detail="Requires review" />
        <ListRow
          leading={<VerificationMark state="verified" />}
          label="Creator activity"
          detail="Verified · Instagram, 3 Oct"
        />
        <ListRow
          leading={<VerificationMark state="derived" />}
          label="Posting consistency"
          detail="Derived from connected accounts"
        />
      </ListGroup>
    </div>
  ),
};
