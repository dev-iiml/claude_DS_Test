/**
 * Free-text guard for staff and creator notes (pure). Notes must never carry
 * identifiers that belong in the regulated domain or nowhere at all: PAN,
 * GSTIN (which embeds a PAN), Aadhaar, bank account / card numbers, IFSC,
 * e-mail addresses or phone numbers. Returns the kinds found (empty = ok).
 */
const PATTERNS: [kind: string, re: RegExp][] = [
  ["gstin", /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i],
  ["pan", /\b[A-Z]{5}\d{4}[A-Z]\b/i],
  ["ifsc", /\b[A-Z]{4}0[A-Z0-9]{6}\b/i],
  ["aadhaar", /\b\d{4}\s?\d{4}\s?\d{4}\b/],
  ["account_number", /\b\d{9,18}\b/],
  ["email", /[^\s@]+@[^\s@]+\.[^\s@]+/],
  ["phone", /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/],
];

export function restrictedTextKinds(text: string): string[] {
  return PATTERNS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
}
