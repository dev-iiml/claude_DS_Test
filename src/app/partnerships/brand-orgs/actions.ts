"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import { readText } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import { BrandOrgError } from "@/modules/brand-orgs/errors";
import {
  approveOrg,
  decideClaim,
  decideLogo,
  decideOrgAction,
  linkAccessBrand,
  proposeOrgAction,
  rejectOrg,
  runCompanyLookup,
  setOrgQuota,
  verifyOrg,
} from "@/modules/brand-orgs/review-service";
import { requirePartnershipsAdmin } from "@/modules/identity";

/**
 * The brand-organisation desk (Stage 19). Each action authorises, calls the
 * review service (which enforces four eyes; the DB CHECKs too) and redirects
 * back with a fixed notice code.
 */

const idSchema = z.uuid();

async function run(orgId: string | undefined, fn: (staffId: string, orgId: string) => Promise<unknown>, ok: string) {
  const staff = await requirePartnershipsAdmin();
  const id = idSchema.safeParse(orgId);
  if (!id.success) redirect("/partnerships/brand-orgs");
  let notice = ok;
  try {
    await fn(staff.userId, id.data);
  } catch (error) {
    if (error instanceof BrandOrgError) notice = `error_${error.code}`;
    else {
      logger.error("brand_org_desk.action_failed", describeError(error));
      notice = "error_failed";
    }
  }
  revalidatePath(`/partnerships/brand-orgs/${id.data}`);
  redirect(`/partnerships/brand-orgs/${id.data}?notice=${notice}`);
}

export async function lookupAction(form: FormData) {
  await run(
    readText(form, "orgId"),
    (staffId, orgId) =>
      runCompanyLookup(getDb(), { staffId, orgId, production: getServerEnv().APP_ENV === "production" }),
    "looked_up",
  );
}

export async function verifyOrgAction(form: FormData) {
  await run(readText(form, "orgId"), (staffId, orgId) => verifyOrg(getDb(), { staffId, orgId }), "verified");
}

export async function approveOrgAction(form: FormData) {
  await run(readText(form, "orgId"), (staffId, orgId) => approveOrg(getDb(), { staffId, orgId }), "approved");
}

export async function rejectOrgAction(form: FormData) {
  await run(
    readText(form, "orgId"),
    (staffId, orgId) => rejectOrg(getDb(), { staffId, orgId, reason: readText(form, "reason") ?? "" }),
    "rejected",
  );
}

export async function proposeOrgActionAction(form: FormData) {
  const action = readText(form, "action") === "reinstate" ? "reinstate" : "suspend";
  await run(
    readText(form, "orgId"),
    (staffId, orgId) => proposeOrgAction(getDb(), { staffId, orgId, action, reason: readText(form, "reason") ?? "" }),
    `proposed_${action}`,
  );
}

export async function decideOrgActionAction(form: FormData) {
  const approve = readText(form, "decision") === "approve";
  await run(
    readText(form, "orgId"),
    (staffId, orgId) => decideOrgAction(getDb(), { staffId, orgId, approve }),
    approve ? "action_approved" : "action_rejected",
  );
}

export async function setQuotaAction(form: FormData) {
  const raw = (readText(form, "quota") ?? "").trim();
  const quota = raw === "" ? null : Number(raw);
  await run(
    readText(form, "orgId"),
    (staffId, orgId) => setOrgQuota(getDb(), { staffId, orgId, quota: Number.isNaN(quota) ? -1 : quota }),
    "quota",
  );
}

export async function linkBrandAction(form: FormData) {
  const raw = readText(form, "brandId") ?? "";
  const brandId = raw === "" ? null : idSchema.safeParse(raw).success ? raw : null;
  await run(
    readText(form, "orgId"),
    (staffId, orgId) => linkAccessBrand(getDb(), { staffId, orgId, brandId }),
    "linked",
  );
}

const STEPS = ["verify", "approve", "reject"] as const;

export async function decideClaimAction(form: FormData) {
  const step = STEPS.find((s) => s === readText(form, "step"));
  const claimId = idSchema.safeParse(readText(form, "claimId"));
  const target = readText(form, "target") === "logo" ? "logo" : "claim";
  await run(
    readText(form, "orgId"),
    async (staffId) => {
      if (!step || !claimId.success) throw new BrandOrgError("invalid");
      const input = { staffId, claimId: claimId.data, step, reason: readText(form, "reason") || null };
      return target === "logo" ? decideLogo(getDb(), input) : decideClaim(getDb(), input);
    },
    `${target}_${step ?? "done"}`,
  );
}
