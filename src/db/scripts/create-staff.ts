import { pathToFileURL } from "node:url";

import { createStaffAccount, findActiveStaffId, STAFF_ROLES } from "../../modules/identity/staff-accounts";
import { createDb } from "../create-db";

import { describeUrl, requireDatabaseUrl } from "./_env";

/**
 * Creates a staff account (Stage 17) — the way staff get into staging/production, which have no demo users:
 *
 *   read -rs STAFF_PASSWORD && export STAFF_PASSWORD
 *   npm run staff:create -- --email new@company.com --role risk_admin --by you@company.com
 *
 * `--by` names the existing staff member creating the account (recorded in the audit trail); without it the account
 * is recorded as a bootstrap account — use that only for the first one. The password comes from the environment — read it with `read -rs` so it stays out of
 * shell history — and is never printed.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const role = arg("role");
  const password = process.env.STAFF_PASSWORD;
  const by = arg("by");
  if (!email || !role) throw new Error(`usage: --email <email> --role <${STAFF_ROLES.join("|")}> [--by <your email>]`);
  if (!password)
    throw new Error("set STAFF_PASSWORD in the environment (14+ characters, mixed case, a digit, a symbol)");
  const url = process.env.DATABASE_MIGRATION_URL || requireDatabaseUrl();
  const { db, client } = createDb({ url, max: 1, prepare: process.env.DATABASE_PREPARE !== "false" });
  try {
    const createdBy = by ? await findActiveStaffId(db, by) : null;
    if (by && !createdBy) throw new Error("--by must be an existing active staff account");
    if (!by) console.log("! no --by: recorded as a bootstrap account (use --by <your staff email> after the first)");
    const result = await createStaffAccount(db, { email, role, password, createdBy });
    if (!result.ok) throw new Error(`not created: ${result.reason}`);
    console.log(`✓ ${role} account created on ${describeUrl(url)}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error("✗", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
