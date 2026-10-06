import { z } from "zod";

import { GST_STATUSES, LEGAL_FORMS, MAX_CATEGORIES, MAX_OTHER_LANGUAGES } from "./domain";
import { isValidGstin, normaliseGstin } from "./gstin";
import { CITIES_BY_STATE, OTHER_CITY } from "./india-cities";
import { INDIAN_STATES, LANGUAGE_CODES, LANGUAGES } from "./reference";
import { isPilotSupportedLegalForm } from "./rules";

/**
 * Server-side validation for each onboarding step. These are the trust
 * boundary: client-side hints are convenience only.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const HANDLE_PATTERN = /^[A-Za-z0-9._-]{2,64}$/;

export const handleSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@+/, ""))
  .pipe(z.string().regex(HANDLE_PATTERN, "Use 2–64 letters, numbers, dots, dashes or underscores (no spaces)."));

const codeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

// --- Step 2: About you ------------------------------------------------------

const OTHER_LANGUAGE_PATTERN = /^\p{L}[\p{L}\p{M} .'-]{1,39}$/u;
const KNOWN_LANGUAGE_LABELS = new Set(LANGUAGES.map((l) => l.label.toLowerCase()));

export const aboutStepSchema = z
  .object({
    legalName: z
      .string({ error: "Enter your legal name." })
      .trim()
      .min(2, "Enter your full legal name.")
      .max(120, "Legal name is too long."),
    displayName: z
      .string({ error: "Enter the name you create under." })
      .trim()
      .min(1, "Enter the name you create under.")
      .max(60, "Display name is too long."),
    state: z
      .union([z.literal(""), z.enum(INDIAN_STATES)])
      .optional()
      .transform((v) => (v ? v : null)),
    /** A city from the state's list, `__other__`, or empty. */
    city: optionalText(80),
    cityOther: optionalText(80),
    languages: z
      .array(z.enum(LANGUAGE_CODES, { error: "Choose from the listed languages." }))
      .max(8, "Choose up to eight languages.")
      .transform((v) => [...new Set(v)]),
    languagesOther: z
      .array(z.string().trim())
      .default([])
      .transform((v) => {
        const seen = new Set<string>();
        return v.filter((l) => {
          const k = l.toLowerCase();
          if (!l || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      }),
  })
  .superRefine((v, ctx) => {
    if (v.languages.length + v.languagesOther.length === 0) {
      ctx.addIssue({ code: "custom", path: ["languages"], message: "Choose at least one language." });
    }
    if (v.languagesOther.length > MAX_OTHER_LANGUAGES) {
      ctx.addIssue({
        code: "custom",
        path: ["languagesOther"],
        message: `Add up to ${MAX_OTHER_LANGUAGES} other languages.`,
      });
    }
    for (const l of v.languagesOther) {
      if (!OTHER_LANGUAGE_PATTERN.test(l)) {
        ctx.addIssue({
          code: "custom",
          path: ["languagesOther"],
          message: `"${l.slice(0, 40)}" isn't a valid language name.`,
        });
      } else if (KNOWN_LANGUAGE_LABELS.has(l.toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          path: ["languagesOther"],
          message: `${l} is already in the list — select it there.`,
        });
      }
    }
    if (v.city && !v.state) {
      ctx.addIssue({ code: "custom", path: ["state"], message: "Choose your state first." });
    } else if (v.city === OTHER_CITY) {
      if (!v.cityOther || v.cityOther.length < 2) {
        ctx.addIssue({ code: "custom", path: ["cityOther"], message: "Enter your city." });
      }
    } else if (v.city && v.state && !CITIES_BY_STATE[v.state].includes(v.city)) {
      ctx.addIssue({ code: "custom", path: ["city"], message: "Choose a city from the list, or Other." });
    }
  })
  .transform(({ cityOther, ...v }) => ({ ...v, city: v.city === OTHER_CITY ? cityOther : v.city }));
export type AboutStepInput = z.infer<typeof aboutStepSchema>;

// --- Step 3: Creator profile ------------------------------------------------

export const profileStepSchema = z
  .object({
    primaryCreatorHandle: handleSchema,
    categories: z
      .array(codeSchema)
      .min(1, "Choose at least one category.")
      .max(MAX_CATEGORIES, `Choose up to ${MAX_CATEGORIES} categories.`)
      .transform((v) => [...new Set(v)]),
    primaryCategory: z.string().optional(),
    creatorSince: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(
        z
          .string()
          .regex(/^(20\d{2})-(0[1-9]|1[0-2])$/, "Choose a month and year from 2000 onwards.")
          .nullable(),
      ),
    platforms: z
      .array(codeSchema)
      .min(1, "Choose at least one platform you create on.")
      .max(10)
      .transform((v) => [...new Set(v)]),
    platformHandles: z.record(z.string(), z.string()).default({}),
  })
  .transform((v, ctx) => {
    // The primary must be one of the chosen categories; default to the first.
    const primary = v.primaryCategory && v.categories.includes(v.primaryCategory) ? v.primaryCategory : v.categories[0];
    if (v.primaryCategory && !v.categories.includes(v.primaryCategory)) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryCategory"],
        message: "Your main category must be one you selected.",
      });
    }
    // Each selected platform needs its own handle (defaults to the primary handle).
    const handles: Record<string, string> = {};
    for (const platform of v.platforms) {
      const raw = v.platformHandles[platform]?.trim() || v.primaryCreatorHandle;
      const parsed = handleSchema.safeParse(raw);
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          path: [`handle_${platform}`],
          message: "Enter a valid handle for this platform.",
        });
        continue;
      }
      handles[platform] = parsed.data;
    }
    return {
      primaryCreatorHandle: v.primaryCreatorHandle,
      creatorCategory: primary ?? "",
      additionalCategories: v.categories.filter((c) => c !== primary),
      creatorSince: v.creatorSince,
      platforms: v.platforms.map((code) => ({ code, handle: handles[code] ?? v.primaryCreatorHandle })),
    };
  });
export type ProfileStepInput = z.infer<typeof profileStepSchema>;

/** Rejects future months. Separate from the schema so "now" is injectable in tests. */
export function isFutureMonth(month: string, now: Date): boolean {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return y > now.getUTCFullYear() || (y === now.getUTCFullYear() && m > now.getUTCMonth() + 1);
}

// --- Step 4: Business status ------------------------------------------------

export const businessStepSchema = z
  .object({
    legalForm: z.enum(LEGAL_FORMS, { error: "Choose how you operate." }),
    gstStatus: z.enum(GST_STATUSES, { error: "Choose your GST registration status." }),
    gstin: z
      .string()
      .optional()
      .transform((v) => (v ? normaliseGstin(v) : null)),
  })
  .superRefine((v, ctx) => {
    if (!isPilotSupportedLegalForm(v.legalForm)) {
      ctx.addIssue({
        code: "custom",
        path: ["legalForm"],
        message: "Incorporated and partnership businesses are not supported in the current pilot.",
      });
    }
    if (v.gstStatus === "registered" && v.gstin && !isValidGstin(v.gstin)) {
      ctx.addIssue({ code: "custom", path: ["gstin"], message: "Enter a valid 15-character GSTIN." });
    }
  })
  // Discard any GSTIN that arrives without a "registered" declaration.
  .transform((v) => ({ ...v, gstin: v.gstStatus === "registered" ? v.gstin : null }));
export type BusinessStepInput = z.infer<typeof businessStepSchema>;

// --- Step 5: Professional interests ------------------------------------------

export const interestsStepSchema = z.object({
  prInterest: z.boolean(),
  preferredCategories: z
    .array(codeSchema)
    .max(20)
    .transform((v) => [...new Set(v)]),
  brandInterests: z
    .array(codeSchema)
    .max(20)
    .transform((v) => [...new Set(v)]),
  travelInterest: z.boolean(),
});
export type InterestsStepInput = z.infer<typeof interestsStepSchema>;

// --- Step 6: Consent -----------------------------------------------------------

export const consentStepSchema = z.object({
  consentDefinitionId: z.uuid("Consent version missing — reload the page."),
  agree: z.literal(true, { error: "Tick the box to give your consent." }),
});
export type ConsentStepInput = z.infer<typeof consentStepSchema>;
