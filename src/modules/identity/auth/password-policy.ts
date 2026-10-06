/**
 * Password policy shared by the browser (live checklist) and the server
 * (authoritative validation). Pure and dependency-free so client components
 * can import it.
 */
export const PASSWORD_POLICY_MIN_LENGTH = 8;
export const PASSWORD_POLICY_MAX_LENGTH = 128;

export interface PasswordRule {
  key: "length" | "lower" | "upper" | "digit" | "special";
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    key: "length",
    label: `At least ${PASSWORD_POLICY_MIN_LENGTH} characters`,
    test: (p) => [...p].length >= PASSWORD_POLICY_MIN_LENGTH,
  },
  { key: "lower", label: "A lower-case letter", test: (p) => /\p{Ll}/u.test(p) },
  { key: "upper", label: "An upper-case letter", test: (p) => /\p{Lu}/u.test(p) },
  { key: "digit", label: "A number", test: (p) => /\p{Nd}/u.test(p) },
  { key: "special", label: "A special character (e.g. ! @ # -)", test: (p) => /[^\p{L}\p{Nd}\s]/u.test(p) },
];

export interface PasswordCheck {
  key: PasswordRule["key"];
  label: string;
  met: boolean;
}

export function evaluatePassword(password: string): { checks: PasswordCheck[]; valid: boolean } {
  const checks = PASSWORD_RULES.map((r) => ({ key: r.key, label: r.label, met: r.test(password) }));
  const tooLong = [...password].length > PASSWORD_POLICY_MAX_LENGTH;
  return { checks, valid: !tooLong && checks.every((c) => c.met) };
}
