export * from "./domain";
export * from "./rules";
export {
  ConsentError,
  findValidReceipt,
  getActiveDefinition,
  grantConsent,
  hasValidConsent,
  listUserConsents,
  withdrawConsent,
  type ConsentDefinition,
  type ConsentReceipt,
  type GrantConsentInput,
} from "./consent-service";
