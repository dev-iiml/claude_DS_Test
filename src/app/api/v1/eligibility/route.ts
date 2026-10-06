import { z } from "zod";

import { getDb } from "@/db";
import {
  getApplication,
  getOpenApplication,
  listApplications,
  startApplication,
} from "@/modules/financial-eligibility/application-service";

import { requireApiCreator } from "../_lib/auth";
import { json, readJson, route } from "../_lib/http";
import { toEligibilityApiError } from "./_errors";
import { applicationJson } from "./_view";

/** The creator's open eligibility check (if any) and past checks. */
export const GET = route("eligibility.list", async (request) => {
  const user = await requireApiCreator(request);
  const db = getDb();
  const open = await getOpenApplication({ db }, user.userId);
  const full = open ? await getApplication(db, { userId: user.userId, applicationId: open.id }) : null;
  return json({
    open: full ? applicationJson(full) : null,
    past: (await listApplications(db, user.userId)).filter((a) => a.id !== open?.id),
  });
});

/** Records the financial-eligibility consent and opens a check (idempotent while one is open). */
export const POST = route("eligibility.start", async (request) => {
  const user = await requireApiCreator(request);
  const { consentDefinitionId } = await readJson(
    request,
    z.object({ consentDefinitionId: z.uuid(), agree: z.literal(true) }),
  );
  try {
    const db = getDb();
    const app = await startApplication({ db }, { userId: user.userId, consentDefinitionId, source: "api" });
    return json(applicationJson((await getApplication(db, { userId: user.userId, applicationId: app.id }))!), 201);
  } catch (error) {
    toEligibilityApiError(error);
  }
});
