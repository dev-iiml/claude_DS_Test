import { z } from "zod";

import type { CreditBureauProvider } from "./bureau/types";
import { MockCreditBureauProvider } from "./bureau/mock-credit-bureau-provider";
import { ProviderError } from "./errors";
import { MockFinancialDataProvider } from "./financial-data/mock-financial-data-provider";
import type { FinancialDataProvider } from "./financial-data/types";
import type { IdentityLookupProvider } from "./identity/lookup-types";
import { MockIdentityLookupProvider } from "./identity/mock-identity-lookup-provider";
import { MockIdentityVerificationProvider } from "./identity/mock-identity-verification-provider";
import type { IdentityVerificationProvider } from "./identity/types";
import { MockLenderProvider } from "./lender/mock-lender-provider";
import { PartnerApiLenderProvider } from "./lender/partner-api-lender-provider";
import { MINIMUM_PROPOSAL_PROFILE, PROPOSAL_DATA_GROUPS, type ProposalDataGroup } from "./lender/proposal";
import type { LenderProvider } from "./lender/types";
import { MockNotificationProvider } from "./notification/mock-notification-provider";
import type { NotificationProvider } from "./notification/types";
import { MockSocialDataProvider } from "./social/mock-social-data-provider";
import type { SocialDataProvider } from "./social/types";
import { MockTaxRegistrationProvider } from "./tax-registration/mock-tax-registration-provider";
import type { TaxRegistrationProvider } from "./tax-registration/types";
import type { Provider, ProviderKind, ProviderMode } from "./types";

/**
 * The adapters this build can run, per capability. A vendor integration is
 * added here (next to its mock) with the secrets it needs and a strict
 * settings schema; which adapter actually serves traffic is configuration,
 * managed in the integration control plane (`/ops`).
 */
export interface ProviderByKind {
  social: SocialDataProvider;
  identity: IdentityVerificationProvider;
  identity_lookup: IdentityLookupProvider;
  tax_registration: TaxRegistrationProvider;
  notification: NotificationProvider;
  bureau: CreditBureauProvider;
  financial_data: FinancialDataProvider;
  lender: LenderProvider;
}

/** Settings every adapter accepts. Settings are non-secret; secrets are env references. */
export const baseAdapterSettings = z.object({
  timeoutMs: z.number().int().min(100).max(60_000).optional(),
});

export interface AdapterContext {
  settings: Record<string, unknown>;
  /** Secret values resolved from the environment by logical name (never stored or logged). */
  secrets: Record<string, string>;
}

export interface AdapterDefinition<K extends ProviderKind = ProviderKind> {
  kind: K;
  /** Stable adapter id, e.g. `mock`. */
  adapter: string;
  label: string;
  /** Modes this adapter may run in. Mocks run only in `mock` mode. */
  modes: readonly ProviderMode[];
  /** Logical secret names the adapter needs (e.g. `apiKey`), each mapped to an env var. */
  secrets: readonly string[];
  /** Strict schema: unknown keys (e.g. a pasted API key) are rejected. */
  settings: z.ZodType<Record<string, unknown>>;
  create(ctx: AdapterContext): ProviderByKind[K];
}

const mockSettings = baseAdapterSettings
  .extend({
    /** Makes every call fail as `unavailable` — for rehearsing failover in non-production environments. */
    simulateOutage: z.boolean().optional(),
  })
  .strict();

/**
 * Lender adapters carry the partnership's proposal profile: which data groups
 * proposals include (partnership terms). `request` is always included.
 */
const lenderMockSettings = mockSettings
  .extend({
    proposalProfile: z
      .array(z.enum(PROPOSAL_DATA_GROUPS))
      .min(1)
      .refine((g) => g.includes("request"), "The request (amount and purposes) is always included.")
      .optional(),
  })
  .strict();

const partnerApiSettings = baseAdapterSettings
  .extend({
    proposalProfile: lenderMockSettings.shape.proposalProfile,
  })
  .strict();

/** Wraps a mock so async calls fail as an outage and health reports `down`. */
function simulatedOutage<T extends Provider>(provider: T): T {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "health") return async () => ({ status: "down" as const, checkedAt: new Date() });
      return (...args: unknown[]) => {
        const result: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (!(result instanceof Promise)) return result;
        result.catch(() => undefined);
        return Promise.reject(new ProviderError("unavailable", "simulated outage"));
      };
    },
  });
}

function mockAdapter<K extends ProviderKind>(
  kind: K,
  label: string,
  build: () => ProviderByKind[K],
): AdapterDefinition<K> {
  return {
    kind,
    adapter: "mock",
    label,
    modes: ["mock"],
    secrets: [],
    settings: mockSettings,
    create: ({ settings }) => (settings.simulateOutage ? simulatedOutage(build()) : build()),
  };
}

export const ADAPTERS: readonly AdapterDefinition[] = [
  mockAdapter("social", "Mock social data", () => new MockSocialDataProvider()),
  mockAdapter("identity", "Mock mobile verification", () => new MockIdentityVerificationProvider()),
  mockAdapter("identity_lookup", "Mock identity lookup", () => new MockIdentityLookupProvider()),
  mockAdapter("tax_registration", "Mock GST registry", () => new MockTaxRegistrationProvider()),
  mockAdapter("notification", "Mock notifications", () => new MockNotificationProvider()),
  mockAdapter("bureau", "Mock credit bureau", () => new MockCreditBureauProvider()),
  mockAdapter("financial_data", "Mock Account Aggregator", () => new MockFinancialDataProvider()),
  {
    kind: "lender",
    adapter: "mock",
    label: "Simulated partner lender",
    modes: ["mock"],
    secrets: [],
    settings: lenderMockSettings,
    create: ({ settings }) => {
      const lender = new MockLenderProvider(
        Array.isArray(settings.proposalProfile)
          ? (settings.proposalProfile as ProposalDataGroup[])
          : MINIMUM_PROPOSAL_PROFILE,
      );
      return settings.simulateOutage ? simulatedOutage(lender) : lender;
    },
  },
  {
    // Any partner lender on the CreatorCo partner API (Stage 12b). No secrets: the partner calls us with an API
    // key issued in /ops → Partners, and verifies our webhooks with a derived signing secret.
    kind: "lender",
    adapter: "partner_api",
    label: "Partner lender (partner API)",
    modes: ["sandbox", "live"],
    secrets: [],
    settings: partnerApiSettings,
    create: ({ settings }) =>
      // The router reports the config's own key and mode as the descriptor.
      new PartnerApiLenderProvider(
        "sandbox",
        Array.isArray(settings.proposalProfile)
          ? (settings.proposalProfile as ProposalDataGroup[])
          : MINIMUM_PROPOSAL_PROFILE,
      ),
  },
];

export function adaptersFor<K extends ProviderKind>(kind: K): AdapterDefinition<K>[] {
  return ADAPTERS.filter((a) => a.kind === kind) as unknown as AdapterDefinition<K>[];
}

export function findAdapter<K extends ProviderKind>(kind: K, adapter: string): AdapterDefinition<K> | undefined {
  return adaptersFor(kind).find((a) => a.adapter === adapter);
}

/** Config keys created by reference data for each capability (match keys already stored in our data). */
export const DEFAULT_CONFIG_KEYS: Record<ProviderKind, string> = {
  social: "mock",
  identity: "mock",
  identity_lookup: "mock",
  tax_registration: "mock",
  notification: "mock",
  bureau: "mock",
  financial_data: "mock",
  lender: "mock_re",
};
