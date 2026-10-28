// Server-side surface of the analytics module (Stage 15). The catalogue (`events.ts`) is pure and imported directly.
export {
  analyticsDay,
  eraseFinancialFunnelEvents,
  eraseOptionalEvents,
  recordEvent,
  type RecordEventInput,
  type RecordOutcome,
} from "./recorder";
export { analyticsSubject, analyticsSubjects } from "./pseudonym";
