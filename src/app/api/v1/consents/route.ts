import { getDb } from "@/db";
import { SERVICE_MEASUREMENT_NOTE, getConsentCentre } from "@/modules/privacy";

import { requireApiCreator } from "../_lib/auth";
import { json, route } from "../_lib/http";

/** The consent centre: every purpose, its current text, the creator's status and receipts. */
export const GET = route("consents.list", async (request) => {
  const user = await requireApiCreator(request);
  const purposes = await getConsentCentre(getDb(), user.userId);
  return json({
    purposes: purposes.map((p) => ({
      key: p.policy.key,
      label: p.policy.label,
      summary: p.policy.summary,
      core: p.policy.core,
      onWithdraw: p.policy.onWithdraw,
      erasure: p.policy.erasure,
      status: p.status,
      current: p.current,
      activeReceiptId: p.activeReceipt?.id ?? null,
      receipts: p.receipts,
      deferredErasures: p.deferredErasures,
    })),
    /** Essential pseudonymous service measurement (a disclosure, not a consent). */
    serviceMeasurement: SERVICE_MEASUREMENT_NOTE,
  });
});
