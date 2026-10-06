import { and, eq, isNull } from "drizzle-orm";

import { CONSENT_DEFINITION_SEEDS } from "@/modules/consent/definitions";
import { publishDefaultProviderRoutes } from "@/modules/integrations/reference";
import { publishDefaultLenderPolicy } from "@/modules/lending/policy-service";

import type { Database } from "../create-db";
import { consentDefinitions } from "../schema";

/**
 * Publishes reference data that every environment needs (consent texts, and
 * outside production a mock route per provider capability).
 * Idempotent: existing versions are left untouched — published consent text
 * is immutable, so a changed text must be a new version.
 */
export async function publishReferenceData(db: Database) {
  for (const def of CONSENT_DEFINITION_SEEDS) {
    const [existing] = await db
      .select({ id: consentDefinitions.id, body: consentDefinitions.body })
      .from(consentDefinitions)
      .where(and(eq(consentDefinitions.key, def.key), eq(consentDefinitions.version, def.version)))
      .limit(1);

    if (existing) {
      if (existing.body !== def.body) {
        throw new Error(
          `consent ${def.key} v${def.version} differs from the published text — add a new version instead of editing`,
        );
      }
      continue;
    }

    await db.transaction(async (tx) => {
      // Close the currently open version (if any) before opening the new one.
      await tx
        .update(consentDefinitions)
        .set({ activeTo: def.activeFrom })
        .where(and(eq(consentDefinitions.key, def.key), isNull(consentDefinitions.activeTo)));
      await tx.insert(consentDefinitions).values({ ...def, activeTo: null });
    });
  }
  await publishDefaultProviderRoutes(db, { production: process.env.APP_ENV === "production" });
  // The pilot's simulated lender policy, v1 (later versions go through maker-checker).
  await publishDefaultLenderPolicy(db);
}
