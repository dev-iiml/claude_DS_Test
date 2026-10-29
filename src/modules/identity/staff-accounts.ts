import { and, eq, ne } from "drizzle-orm";

import { isUniqueViolation } from "@/db/errors";
import type { Database } from "@/db/create-db";
import { authIdentities, users } from "@/db/schema";
import { recordAuditEvent } from "@/modules/audit";

import { evaluatePassword } from "./auth/password-policy";
import { hashPassword } from "./auth/password";
import { normaliseEmail } from "./auth/tokens";
import { USER_ROLES, type UserRole } from "./domain";

/**
 * Staff accounts (Stage 17). Staging and production have no demo staff, so the
 * first accounts are created from the command line (`npm run staff:create`)
 * by whoever holds the migration credentials. Creators sign up themselves;
 * this never creates a creator. Staff passwords must meet the policy and be at
 * least 14 characters.
 */
export const STAFF_ROLES = USER_ROLES.filter((r) => r !== "creator") as Exclude<UserRole, "creator">[];
export type StaffRole = (typeof STAFF_ROLES)[number];
export const STAFF_PASSWORD_MIN_LENGTH = 14;

export type CreateStaffResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid_role" | "weak_password" | "invalid_email" | "email_taken" | "unknown_creator" };

/** The active staff member (not a creator) with this email — who is creating the account, for the audit trail. */
export async function findActiveStaffId(db: Database, email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, normaliseEmail(email)), ne(users.role, "creator"), eq(users.status, "active")));
  return row?.id ?? null;
}

export async function createStaffAccount(
  db: Database,
  /** `createdBy`: the staff user creating it; absent only for the very first (bootstrap) account. */
  input: { email: string; role: string; password: string; createdBy?: string | null },
): Promise<CreateStaffResult> {
  if (!(STAFF_ROLES as readonly string[]).includes(input.role)) return { ok: false, reason: "invalid_role" };
  const email = normaliseEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { ok: false, reason: "invalid_email" };
  if ([...input.password].length < STAFF_PASSWORD_MIN_LENGTH || !evaluatePassword(input.password).valid) {
    return { ok: false, reason: "weak_password" };
  }
  const passwordHash = await hashPassword(input.password);
  try {
    const userId = await db.transaction(async (tx) => {
      const [identity] = await tx
        .insert(authIdentities)
        .values({ email, passwordHash })
        .returning({ id: authIdentities.id });
      const [user] = await tx
        .insert(users)
        .values({ authUserId: identity!.id, email, role: input.role as StaffRole, status: "active" })
        .returning({ id: users.id });
      await recordAuditEvent(tx, {
        actorType: input.createdBy ? "user" : "system",
        actorId: input.createdBy ?? null,
        eventType: "auth.staff_created",
        entityType: "user",
        entityId: user!.id,
        metadata: { role: input.role, source: "cli", bootstrap: !input.createdBy },
      });
      return user!.id;
    });
    return { ok: true, userId };
  } catch (error) {
    if (isUniqueViolation(error, "identities_email_key") || isUniqueViolation(error, "users_email_key")) {
      return { ok: false, reason: "email_taken" };
    }
    throw error;
  }
}
