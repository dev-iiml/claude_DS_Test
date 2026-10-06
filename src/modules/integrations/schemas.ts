import { z } from "zod";

import { PROVIDER_KINDS, PROVIDER_MODES } from "@/providers/types";

import { CONFIG_KEY_PATTERN, SECRET_REF_PATTERN } from "./domain";

/** Inputs for control-plane changes. Adapter-specific settings are validated by the adapter's schema. */

const kind = z.enum(PROVIDER_KINDS);
const mode = z.enum(PROVIDER_MODES);
const settings = z.record(z.string(), z.unknown());
export const secretRefsSchema = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/),
  z
    .string()
    .trim()
    .regex(SECRET_REF_PATTERN, "Use an env var name starting with INTEGRATION_ (upper case, digits, underscores)."),
);

export const reasonSchema = z
  .string()
  .trim()
  .min(4, "Say why, in a few words.")
  .max(500, "Keep the reason under 500 characters.");

export const changeInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_config"),
    kind,
    key: z
      .string()
      .trim()
      .regex(CONFIG_KEY_PATTERN, "Lower-case letters, digits and underscores, starting with a letter."),
    adapter: z.string().trim().min(1).max(40),
    mode,
    enabled: z.boolean(),
    settings: settings.default({}),
    secretRefs: secretRefsSchema.default({}),
  }),
  z.object({
    action: z.literal("update_config"),
    configId: z.uuid(),
    mode: mode.optional(),
    enabled: z.boolean().optional(),
    settings: settings.optional(),
    secretRefs: secretRefsSchema.optional(),
  }),
  z.object({
    action: z.literal("set_route"),
    kind,
    primaryConfigId: z.uuid(),
    fallbackConfigId: z.uuid().nullable(),
  }),
  z.object({ action: z.literal("pause_kind"), kind }),
  z.object({ action: z.literal("resume_kind"), kind }),
]);
export type ChangeInput = z.infer<typeof changeInputSchema>;

export const decisionNoteSchema = z.string().trim().max(500).optional();
