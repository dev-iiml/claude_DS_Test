/** Postgres error helpers (driver-agnostic: inspects `code`/`constraint_name`, including on `cause`). */
interface PgLikeError {
  code?: string;
  constraint_name?: string;
  constraint?: string;
}

function pgError(error: unknown): PgLikeError | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as PgLikeError & { cause?: unknown };
  if (typeof e.code === "string") return e;
  if (e.cause) return pgError(e.cause);
  return undefined;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = pgError(error);
  if (!e || e.code !== "23505") return false;
  if (!constraint) return true;
  return (e.constraint_name ?? e.constraint) === constraint;
}
