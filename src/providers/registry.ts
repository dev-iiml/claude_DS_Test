import { MockCreditBureauProvider } from "./bureau/mock-credit-bureau-provider";
import type { CreditBureauProvider } from "./bureau/types";
import { MockFinancialDataProvider } from "./financial-data/mock-financial-data-provider";
import type { FinancialDataProvider } from "./financial-data/types";
import type { IdentityLookupProvider } from "./identity/lookup-types";
import { MockIdentityLookupProvider } from "./identity/mock-identity-lookup-provider";
import { MockIdentityVerificationProvider } from "./identity/mock-identity-verification-provider";
import type { IdentityVerificationProvider } from "./identity/types";
import { MockLenderProvider } from "./lender/mock-lender-provider";
import type { LenderProvider } from "./lender/types";
import { MockNotificationProvider } from "./notification/mock-notification-provider";
import type { NotificationProvider } from "./notification/types";
import { MockSocialDataProvider } from "./social/mock-social-data-provider";
import type { SocialDataProvider } from "./social/types";
import { MockTaxRegistrationProvider } from "./tax-registration/mock-tax-registration-provider";
import type { TaxRegistrationProvider } from "./tax-registration/types";

/**
 * The set of capabilities business code depends on. Live instances come from
 * `getProviders()` in `@/modules/integrations/registry`, which routes each
 * capability by configuration (the integration control plane, `/ops`).
 */
export interface ProviderRegistry {
  social: SocialDataProvider;
  identity: IdentityVerificationProvider;
  identityLookup: IdentityLookupProvider;
  taxRegistry: TaxRegistrationProvider;
  notifications: NotificationProvider;
  bureau: CreditBureauProvider;
  financialData: FinancialDataProvider;
  lender: LenderProvider;
}

/** Direct mocks, bypassing routing — for unit tests and scripts only. */
export function createMockProviderRegistry(): ProviderRegistry {
  return {
    social: new MockSocialDataProvider(),
    identity: new MockIdentityVerificationProvider(),
    identityLookup: new MockIdentityLookupProvider(),
    taxRegistry: new MockTaxRegistrationProvider(),
    notifications: new MockNotificationProvider(),
    bureau: new MockCreditBureauProvider(),
    financialData: new MockFinancialDataProvider(),
    lender: new MockLenderProvider(),
  };
}
