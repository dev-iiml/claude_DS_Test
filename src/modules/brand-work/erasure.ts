import { and, eq, inArray, sql } from "drizzle-orm";

import {
  brandWorkRecords,
  creatorNotices,
  creatorProfessionalFeatures,
  creatorProfiles,
  professionalGraphRuns,
} from "@/db/schema";
import type { DbExecutor } from "@/db/types";
import { enqueueJob } from "@/modules/jobs";
import { BRAND_FEATURE_KEYS } from "@/modules/professional-graph/engine";

import { storageKeysToErase } from "./documents-service";

/**
 * Withdrawal of `brand_work_records` (scope `brand_work_records`): records,
 * documents (rows now; stored objects by a job) and review history are
 * erased, and so are the brand features in every earlier Professional Graph
 * run (a fresh run follows). Earned Creator Points stay — the ledger holds
 * rule codes and ids only. Returns small counts.
 */
export async function eraseBrandWorkRecords(tx: DbExecutor, input: { userId: string; before?: Date }) {
  const records = await tx
    .select({ id: brandWorkRecords.id })
    .from(brandWorkRecords)
    .where(eq(brandWorkRecords.userId, input.userId));
  const keys = await storageKeysToErase(
    tx,
    records.map((r) => r.id),
  );
  await tx.execute(sql`set local creatorco.erasure = 'on'`);
  const deleted = await tx
    .delete(brandWorkRecords)
    .where(eq(brandWorkRecords.userId, input.userId))
    .returning({ id: brandWorkRecords.id });
  await tx.delete(creatorNotices).where(eq(creatorNotices.userId, input.userId));
  const runs = tx
    .select({ id: professionalGraphRuns.id })
    .from(professionalGraphRuns)
    .innerJoin(creatorProfiles, eq(creatorProfiles.id, professionalGraphRuns.creatorId))
    .where(eq(creatorProfiles.userId, input.userId));
  const features = await tx
    .delete(creatorProfessionalFeatures)
    .where(
      and(
        inArray(creatorProfessionalFeatures.runId, runs),
        inArray(creatorProfessionalFeatures.featureKey, [...BRAND_FEATURE_KEYS]),
      ),
    )
    .returning({ id: creatorProfessionalFeatures.id });
  for (const k of keys) {
    await enqueueJob(tx, { type: "brand_work_erase_documents", payload: { key: k.key, provider: k.provider } });
  }
  return {
    brand_work_records: deleted.length,
    brand_work_documents_queued: keys.length,
    brand_graph_features: features.length,
  };
}
