/**
 * Database schema, grouped by domain. Drizzle generates SQL migrations from
 * these definitions (`npm run db:generate`); hand-written SQL migrations add
 * triggers, privilege hardening and reference data.
 */
export * from "./identity";
export * from "./creator-profile";
export * from "./social";
export * from "./consent";
export * from "./audit";
export * from "./identity-verification";
export * from "./professional-graph";
export * from "./financial";
export * from "./ops";
export * from "./partners";
export * from "./creator-status";
export * from "./access";
