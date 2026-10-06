/**
 * Sensitive-field classification for keys in logs and audit metadata.
 * Keys are checked by snake/camel-case token and by known substrings so that
 * `user_pan`, `panNumber` and `gstinValue` are all caught, while innocuous
 * words such as `company` are not.
 */
const SENSITIVE_TOKENS = new Set([
  "pan",
  "pin",
  "otp",
  "dob",
  "cvv",
  "card",
  "bank",
  "ifsc",
  "upi",
  "vpa",
  "ip",
  "name",
  "address",
  "email",
  "mobile",
  "phone",
  "cookie",
  "session",
  "token",
  "secret",
  "password",
  "passwd",
  "authorization",
  "auth",
  "salary",
  "income",
]);

const SENSITIVE_SUBSTRINGS = [
  "password",
  "secret",
  "token",
  "gstin",
  "aadhaar",
  "aadhar",
  "email",
  "mobile",
  "phone",
  "address",
  "birth",
  "bureau",
  "tradeline",
  "transaction",
  "payload",
  "ckyc",
];

function tokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  return tokens(key).some((t) => SENSITIVE_TOKENS.has(t));
}
