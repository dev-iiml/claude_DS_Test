import type { Database } from "./create-db";

/** A Drizzle transaction handle. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Anything that can run queries: the root client or an open transaction. */
export type DbExecutor = Database | Transaction;
