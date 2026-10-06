import "server-only";

import { getDb } from "@/db";
import { getServerEnv } from "@/lib/env";
import type { ProviderRegistry } from "@/providers/registry";
import type { ProviderKind } from "@/providers/types";

import { resolveAllProviders, resolveProviderByKey } from "./router";

/**
 * Where business code obtains providers. Which adapter serves each capability
 * is configuration, resolved from a short-lived routing snapshot — domain code
 * never names a vendor.
 */
export async function getProviders(): Promise<ProviderRegistry> {
  const p = await resolveAllProviders({ db: getDb(), production: getServerEnv().APP_ENV === "production" });
  return {
    social: p.social,
    identity: p.identity,
    identityLookup: p.identity_lookup,
    taxRegistry: p.tax_registration,
    notifications: p.notification,
    bureau: p.bureau,
    financialData: p.financial_data,
    lender: p.lender,
  };
}

/** The provider behind a specific config key (return legs of flows begun before a switch). Null if it can't serve. */
export async function getProviderByKey<K extends ProviderKind>(kind: K, key: string) {
  return resolveProviderByKey({ db: getDb(), production: getServerEnv().APP_ENV === "production" }, kind, key);
}
