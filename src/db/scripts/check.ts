import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import postgres from "postgres";

import { describeUrl, requireDatabaseUrl } from "./_env";

/**
 * Fails fast when the database is behind the code (e.g. after pulling a new
 * stage), instead of the app failing later with "relation does not exist".
 * Read-only: it never applies migrations itself. Runs before `npm run dev`.
 */

type JournalEntry = { tag: string; when: number };

export function pendingMigrations(journal: JournalEntry[], appliedUpTo: number | null): string[] {
  return journal.filter((e) => appliedUpTo === null || e.when > appliedUpTo).map((e) => e.tag);
}

async function appliedUpTo(url: string): Promise<number | null> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [table] = await sql`select to_regclass('drizzle.__drizzle_migrations') as name`;
    if (!table?.name) return null;
    const [row] = await sql`select max(created_at)::bigint as at from drizzle.__drizzle_migrations`;
    return row?.at == null ? null : Number(row.at);
  } finally {
    await sql.end();
  }
}

// pathToFileURL percent-encodes the path (e.g. spaces), matching import.meta.url.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Reads the migration history, which only the schema owner can see (Stage 16 app role).
  const url = process.env.DATABASE_MIGRATION_URL || requireDatabaseUrl();
  const journal = (
    JSON.parse(readFileSync("src/db/migrations/meta/_journal.json", "utf8")) as { entries: JournalEntry[] }
  ).entries;
  appliedUpTo(url)
    .then((at) => {
      const pending = pendingMigrations(journal, at);
      if (!pending.length) return;
      console.error(
        `\n✗ ${describeUrl(url)} is ${pending.length} migration(s) behind the code:\n` +
          pending.map((t) => `    - ${t}`).join("\n") +
          `\n\n  Run:  npm run db:migrate\n`,
      );
      process.exit(1);
    })
    .catch((e: unknown) => {
      console.error(
        `\n✗ Could not reach the database at ${describeUrl(url)}:`,
        e instanceof Error ? e.message : e,
        "\n  Is Postgres running? See README → Local setup.\n",
      );
      process.exit(1);
    });
}
