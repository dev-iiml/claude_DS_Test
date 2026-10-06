import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt (memory-hard, built into Node — no native deps,
 * Vercel-compatible). Parameters are encoded in the hash so cost can be raised
 * later; `needsRehash` reports hashes created with weaker parameters.
 *
 * Format: scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>
 */
const CURRENT = { N: 2 ** 17, r: 8, p: 1, keyLength: 64, saltLength: 16 } as const;

export {
  PASSWORD_POLICY_MAX_LENGTH as PASSWORD_MAX_LENGTH,
  PASSWORD_POLICY_MIN_LENGTH as PASSWORD_MIN_LENGTH,
} from "./password-policy";

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize("NFKC"), salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function options(N: number, r: number, p: number): ScryptOptions {
  return { N, r, p, maxmem: 256 * N * r + 1024 * 1024 };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(CURRENT.saltLength);
  const key = await scrypt(password, salt, CURRENT.keyLength, options(CURRENT.N, CURRENT.r, CURRENT.p));
  return ["scrypt", CURRENT.N, CURRENT.r, CURRENT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, salt, key] = parts as [string, string, string, string, string, string];
  const parsed = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt, "base64"),
    key: Buffer.from(key, "base64"),
  };
  if (![parsed.N, parsed.r, parsed.p].every(Number.isInteger) || parsed.key.length === 0) return null;
  return parsed;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const candidate = await scrypt(password, parsed.salt, parsed.key.length, options(parsed.N, parsed.r, parsed.p));
  return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
}

export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  return !parsed || parsed.N < CURRENT.N || parsed.r < CURRENT.r || parsed.p < CURRENT.p;
}

/**
 * A valid hash of a random secret, used to equalise timing when an account
 * does not exist (prevents user enumeration through response time).
 */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  return dummyHash;
}
