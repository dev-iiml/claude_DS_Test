"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db";
import { getServerEnv, isProductionLike } from "@/lib/env";
import { formError, readList, readText, type FormState } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";
import { requireOpsAdmin } from "@/modules/identity";
import {
  PartnerError,
  cancelApiKey,
  cancelWebhookEndpoint,
  createPartner,
  decideApiKey,
  decideWebhookEndpoint,
  deliverPartnerWebhooks,
  proposeApiKey,
  proposeWebhookEndpoint,
  redeliver,
  retireWebhookEndpoint,
  revokeApiKey,
  rotateWebhookSecret,
  sendTestPing,
  setPartnerStatus,
} from "@/modules/partners";

/**
 * /ops → Partners actions (Stage 12b). Thin: authorise (ops_admin /
 * super_admin), parse, call `modules/partners`, redirect. Keys and signing
 * secrets are returned to the issuing admin once, in the action result —
 * never logged, stored or echoed again.
 */

/** Form state that can carry a one-time secret back to the admin who created it. */
export interface SecretFormState extends FormState {
  secret?: { label: string; value: string; note: string };
}

const idSchema = z.uuid();
const production = () => getServerEnv().APP_ENV === "production";

function fail(error: unknown): FormState {
  if (error instanceof PartnerError)
    return formError(error.message !== error.code ? error.message : "That isn't possible now.");
  logger.error("partners.ops_action_failed", describeError(error));
  return formError("Something went wrong. Please try again.");
}

function partnerPath(partnerId: string) {
  return `/ops/partners/${partnerId}`;
}

function idFrom(form: FormData, name: string): string {
  const id = idSchema.safeParse(readText(form, name));
  if (!id.success) redirect("/ops/partners");
  return id.data;
}

export async function createPartnerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireOpsAdmin();
  let id: string;
  try {
    const row = await createPartner(getDb(), {
      staffId: admin.userId,
      key: readText(form, "key") ?? "",
      name: readText(form, "name") ?? "",
      environment: readText(form, "environment") ?? "",
      lenderKey: readText(form, "lenderKey") ?? "",
      production: production(),
    });
    id = row.id;
  } catch (error) {
    return {
      ...fail(error),
      values: {
        key: readText(form, "key") ?? "",
        name: readText(form, "name") ?? "",
        lenderKey: readText(form, "lenderKey") ?? "",
      },
    };
  }
  revalidatePath("/ops/partners");
  redirect(partnerPath(id));
}

export async function setPartnerStatusAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    await setPartnerStatus(getDb(), {
      staffId: admin.userId,
      partnerId,
      status: readText(form, "status") === "active" ? "active" : "suspended",
      reason: readText(form, "reason") ?? "",
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(partnerPath(partnerId));
  redirect(partnerPath(partnerId));
}

export async function proposeKeyAction(_prev: SecretFormState, form: FormData): Promise<SecretFormState> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  const replaces = readText(form, "replacesKeyId");
  try {
    const { key } = await proposeApiKey(getDb(), {
      staffId: admin.userId,
      partnerId,
      label: readText(form, "label") ?? "",
      scopes: readList(form, "scopes"),
      lifetimeDays: Number(readText(form, "lifetimeDays") ?? 0) || undefined,
      replacesKeyId: replaces && idSchema.safeParse(replaces).success ? replaces : null,
      overlapHours: replaces ? Number(readText(form, "overlapHours") ?? 24) : null,
    });
    revalidatePath(partnerPath(partnerId));
    return {
      status: "idle",
      secret: {
        label: "API key",
        value: key,
        note: "Copy it now and give it to the partner over a secure channel — it won't be shown again. It works only after a second ops admin approves it.",
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function decideKeyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    await decideApiKey(getDb(), {
      staffId: admin.userId,
      keyId: idFrom(form, "keyId"),
      approve: readText(form, "decision") === "approve",
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(partnerPath(partnerId));
  redirect(partnerPath(partnerId));
}

export async function revokeKeyAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    await revokeApiKey(getDb(), {
      staffId: admin.userId,
      keyId: idFrom(form, "keyId"),
      reason: readText(form, "reason") ?? "",
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(partnerPath(partnerId));
  redirect(partnerPath(partnerId));
}

export async function proposeWebhookAction(_prev: SecretFormState, form: FormData): Promise<SecretFormState> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    const { secret } = await proposeWebhookEndpoint(getDb(), {
      staffId: admin.userId,
      partnerId,
      url: readText(form, "url") ?? "",
      production: isProductionLike(),
    });
    revalidatePath(partnerPath(partnerId));
    return {
      status: "idle",
      secret: {
        label: "Webhook signing secret",
        value: secret,
        note: "Give it to the partner so it can verify the CreatorCo-Signature header. It won't be shown again. Deliveries start once a second ops admin approves the URL.",
      },
    };
  } catch (error) {
    return { ...fail(error), values: { url: readText(form, "url") ?? "" } };
  }
}

export async function decideWebhookAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    await decideWebhookEndpoint(getDb(), {
      staffId: admin.userId,
      endpointId: idFrom(form, "endpointId"),
      approve: readText(form, "decision") === "approve",
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(partnerPath(partnerId));
  redirect(partnerPath(partnerId));
}

export async function retireWebhookAction(_prev: FormState, form: FormData): Promise<FormState> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    await retireWebhookEndpoint(getDb(), { staffId: admin.userId, endpointId: idFrom(form, "endpointId") });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(partnerPath(partnerId));
  redirect(partnerPath(partnerId));
}

export async function rotateSecretAction(_prev: SecretFormState, form: FormData): Promise<SecretFormState> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    const { secret, version } = await rotateWebhookSecret(getDb(), {
      staffId: admin.userId,
      endpointId: idFrom(form, "endpointId"),
    });
    revalidatePath(partnerPath(partnerId));
    return {
      status: "idle",
      secret: {
        label: `Webhook signing secret v${version}`,
        value: secret,
        note: "Webhooks are signed with both the new and the previous secret for 24 hours, then only the new one. It won't be shown again.",
      },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function pingAction(form: FormData): Promise<void> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    await sendTestPing(getDb(), { staffId: admin.userId, partnerId });
    await deliverPartnerWebhooks({ db: getDb() }, 5);
  } catch (error) {
    if (!(error instanceof PartnerError)) logger.error("partners.ping_failed", describeError(error));
  }
  revalidatePath(partnerPath(partnerId));
  redirect(`${partnerPath(partnerId)}?notice=pinged`);
}

export async function redeliverAction(form: FormData): Promise<void> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    await redeliver(getDb(), { staffId: admin.userId, deliveryId: idFrom(form, "deliveryId") });
    await deliverPartnerWebhooks({ db: getDb() }, 5);
  } catch (error) {
    if (!(error instanceof PartnerError)) logger.error("partners.redeliver_failed", describeError(error));
  }
  revalidatePath(partnerPath(partnerId));
  redirect(partnerPath(partnerId));
}

export async function cancelKeyAction(form: FormData): Promise<void> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    await cancelApiKey(getDb(), { staffId: admin.userId, keyId: idFrom(form, "keyId") });
  } catch (error) {
    if (!(error instanceof PartnerError)) logger.error("partners.cancel_failed", describeError(error));
  }
  revalidatePath(partnerPath(partnerId));
  redirect(partnerPath(partnerId));
}

export async function cancelWebhookAction(form: FormData): Promise<void> {
  const admin = await requireOpsAdmin();
  const partnerId = idFrom(form, "partnerId");
  try {
    await cancelWebhookEndpoint(getDb(), { staffId: admin.userId, endpointId: idFrom(form, "endpointId") });
  } catch (error) {
    if (!(error instanceof PartnerError)) logger.error("partners.cancel_failed", describeError(error));
  }
  revalidatePath(partnerPath(partnerId));
  redirect(partnerPath(partnerId));
}
