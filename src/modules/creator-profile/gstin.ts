/**
 * GSTIN format + check-digit validation.
 *
 * Structure: 2-digit state code, 10-character PAN, entity number, 'Z', check
 * character. The check character uses the base-36 weighted algorithm published
 * by GSTN. This validates *shape* only — it does not confirm the registration
 * exists (that requires a verification provider in a later stage).
 *
 * Note: a GSTIN embeds the holder's PAN. Treat it as a restricted field.
 */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function normaliseGstin(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i] ?? "");
    if (value < 0) throw new Error("invalid GSTIN character");
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36] ?? "0";
}

export function isValidGstin(raw: string): boolean {
  const gstin = normaliseGstin(raw);
  if (!GSTIN_PATTERN.test(gstin)) return false;
  return gstinCheckCharacter(gstin.slice(0, 14)) === gstin[14];
}

/** Position rules for progressive (as-you-type) feedback. */
const POSITION_RULES: { test: RegExp; describe: string }[] = [
  ...[1, 2].map(() => ({ test: /[0-9]/, describe: "a digit (state code)" })),
  ...[1, 2, 3, 4, 5].map(() => ({ test: /[A-Z]/, describe: "a letter (part of the PAN)" })),
  ...[1, 2, 3, 4].map(() => ({ test: /[0-9]/, describe: "a digit (part of the PAN)" })),
  { test: /[A-Z]/, describe: "a letter (end of the PAN)" },
  { test: /[1-9A-Z]/, describe: "a digit 1–9 or a letter (registration number)" },
  { test: /Z/, describe: "the letter Z" },
  { test: /[0-9A-Z]/, describe: "a digit or letter (check character)" },
];

export type GstinFeedback =
  | { state: "empty" }
  | { state: "incomplete"; message: string }
  | { state: "invalid"; message: string }
  | { state: "valid"; gstin: string };

/** Explains what is wrong with a partially or fully typed GSTIN. Pure; safe on the client. */
export function explainGstin(raw: string): GstinFeedback {
  const g = normaliseGstin(raw);
  if (!g) return { state: "empty" };
  if (/[^0-9A-Z]/.test(g)) return { state: "invalid", message: "Use only letters and digits." };
  if (g.length > 15) return { state: "invalid", message: "A GSTIN has exactly 15 characters." };
  for (let i = 0; i < g.length; i++) {
    const rule = POSITION_RULES[i];
    if (rule && !rule.test.test(g[i] ?? "")) {
      return { state: "invalid", message: `Character ${i + 1} should be ${rule.describe}.` };
    }
  }
  if (g.length >= 2) {
    const code = Number(g.slice(0, 2));
    if (!((code >= 1 && code <= 38) || code === 97 || code === 99)) {
      return { state: "invalid", message: `${g.slice(0, 2)} isn't a valid GST state code.` };
    }
  }
  if (g.length < 15)
    return { state: "incomplete", message: `${15 - g.length} more character${g.length === 14 ? "" : "s"}.` };
  if (gstinCheckCharacter(g.slice(0, 14)) !== g[14]) {
    return { state: "invalid", message: "The last character (check digit) doesn't match — please re-check the GSTIN." };
  }
  return { state: "valid", gstin: g };
}
