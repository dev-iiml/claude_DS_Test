import { z } from "zod";

/**
 * Analytics event catalogue (Stage 15) — pure, versioned, typed.
 *
 * The funnel in CLAUDE.md §26, recorded first-party. Every event has a strict
 * property schema: small enums and booleans only. Never names, emails,
 * mobiles, PAN/Aadhaar/GSTIN, handles, free text, amounts, bank or bureau data,
 * scores, grades or credit outcomes. (Risk/model analytics are computed from
 * the regulated domain's own tables, never sent as events.)
 *
 * Tiers (user decision):
 * - `essential`: pseudonymous service measurement of funnel steps — recorded
 *   for every member, disclosed in the privacy notice;
 * - `optional`: screen/feature views — recorded only with the optional
 *   "Product analytics" consent.
 *
 * Subjects: `user` events carry a pseudonym (keyed hash of the user id);
 * `anonymous` events carry no identifier at all (pre-sign-up page views).
 * `once`: recorded at most once per subject (first time only).
 *
 * Changing an event's properties bumps its `version`.
 */
export const ANALYTICS_CATALOGUE_VERSION = "ev-1";

const client = z.enum(["web", "ios", "android", "api"]);
const platform = z.string().regex(/^[a-z0-9_]{1,24}$/);
const tier = z.enum(["member", "onyx", "icon"]);
const kind = z.enum(["pr_drop", "programme", "experience", "event"]);
const category = z.string().regex(/^[a-z0-9_]{1,40}$/);
const modelVersion = z.string().regex(/^[a-z0-9.-]{1,24}$/);

interface EventDefinition<S extends z.ZodType = z.ZodType> {
  version: number;
  tier: "essential" | "optional";
  subject: "user" | "anonymous";
  once?: boolean;
  /** May be sent by a client (web beacon / native app) rather than only by the server. */
  clientEmittable?: boolean;
  props: S;
  description: string;
}

const define = <S extends z.ZodType>(d: EventDefinition<S>) => d;
const none = z.object({}).strict();

export const ANALYTICS_EVENTS = {
  landing_viewed: define({
    version: 1,
    tier: "essential",
    subject: "anonymous",
    props: none,
    description: "The landing page was viewed by a signed-out visitor (no identifier).",
  }),
  application_started: define({
    version: 1,
    tier: "essential",
    subject: "anonymous",
    props: none,
    description: "The join / sign-up page was opened by a signed-out visitor (no identifier).",
  }),
  account_created: define({
    version: 1,
    tier: "essential",
    subject: "user",
    once: true,
    props: z.object({ client }).strict(),
    description: "A creator account was created.",
  }),
  creator_profile_completed: define({
    version: 1,
    tier: "essential",
    subject: "user",
    once: true,
    props: z.object({ category: category.nullable() }).strict(),
    description: "Onboarding finished with the Creator Profile consent (primary category only).",
  }),
  social_connection_started: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: z.object({ platform }).strict(),
    description: "The creator started connecting a social account.",
  }),
  social_connection_completed: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: z.object({ platform }).strict(),
    description: "A social account connection completed.",
  }),
  passport_generated: define({
    version: 1,
    tier: "essential",
    subject: "user",
    once: true,
    props: none,
    description: "The Creator Passport was first verified by a connected account.",
  }),
  status_generated: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: z.object({ tier, changed: z.boolean() }).strict(),
    description: "Creator Status was evaluated from new professional signals.",
  }),
  financial_eligibility_started: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: none,
    description: "An eligibility check was started.",
  }),
  financial_consent_granted: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: none,
    description: "The financial-eligibility consent was given.",
  }),
  financial_inputs_completed: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: none,
    description: "The creator confirmed their eligibility inputs on Review.",
  }),
  underwriting_started: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: none,
    description: "A new CreatorCo recommendation run started for a confirmed check.",
  }),
  underwriting_completed: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: z.object({ model_version: modelVersion }).strict(),
    description: "A new recommendation run finished (no scores, grades or outcomes).",
  }),
  offer_generated: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: z.object({ simulated: z.boolean() }).strict(),
    description: "A reviewed partner-lender offer became visible to the creator (no terms).",
  }),
  offer_viewed: define({
    version: 1,
    tier: "optional",
    subject: "user",
    clientEmittable: true,
    props: z.object({ simulated: z.boolean() }).strict(),
    description: "The creator opened an open offer.",
  }),
  simulated_offer_accepted: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: none,
    description: "The creator accepted the simulated lender's illustrative offer.",
  }),
  offer_accepted: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: none,
    description: "The creator accepted a partner lender's offer.",
  }),
  offer_declined: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: z.object({ simulated: z.boolean() }).strict(),
    description: "The creator declined an offer.",
  }),
  access_opportunity_viewed: define({
    version: 1,
    tier: "optional",
    subject: "user",
    clientEmittable: true,
    props: z.object({ kind }).strict(),
    description: "The creator opened an Access opportunity.",
  }),
  access_requested: define({
    version: 1,
    tier: "essential",
    subject: "user",
    props: z.object({ kind, min_tier: tier }).strict(),
    description: "The creator requested an Access opportunity.",
  }),
} as const;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;
export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEvent[];
export type EventProps<E extends AnalyticsEvent> = z.input<(typeof ANALYTICS_EVENTS)[E]["props"]>;

/**
 * Funnel steps about a creator's eligibility checks and offers. They hold no
 * terms, amounts, scores or reasons, but they do show that a check was made
 * and whether an offer followed — so they are tied to the financial-eligibility
 * consent and erased when it is withdrawn (scope `financial_funnel_events`).
 */
export const FINANCIAL_FUNNEL_EVENTS = [
  "financial_eligibility_started",
  "financial_consent_granted",
  "financial_inputs_completed",
  "underwriting_started",
  "underwriting_completed",
  "offer_generated",
  "offer_viewed",
  "simulated_offer_accepted",
  "offer_accepted",
  "offer_declined",
] as const satisfies readonly AnalyticsEvent[];

/** Events recorded at most once per subject. */
export const ONCE_EVENTS = ANALYTICS_EVENT_NAMES.filter(
  (e) => "once" in ANALYTICS_EVENTS[e] && ANALYTICS_EVENTS[e].once,
);

export const ANALYTICS_TIERS = ["essential", "optional"] as const;
export type AnalyticsTier = (typeof ANALYTICS_TIERS)[number];

/** Events a client may send (anonymous views via the web beacon; consented views from native apps). */
export const CLIENT_EVENTS = ANALYTICS_EVENT_NAMES.filter(
  (e) => ANALYTICS_EVENTS[e].clientEmittable || ANALYTICS_EVENTS[e].subject === "anonymous",
);

/** Keys that may never appear in event properties, whatever the schema says (defence in depth). */
export const FORBIDDEN_PROP_KEYS =
  /(name|email|mobile|phone|pan|aadhaar|gstin|handle|address|note|amount|income|emi|score|grade|bureau|bank|account|salary|limit|exposure|outcome|reason)/i;

/** Validates an event's properties against its schema. Returns the clean props or throws. */
export function parseEventProps<E extends AnalyticsEvent>(
  event: E,
  props: unknown,
): Record<string, string | boolean | null> {
  const def = ANALYTICS_EVENTS[event];
  const parsed = def.props.parse(props ?? {}) as Record<string, string | boolean | null>;
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_PROP_KEYS.test(key)) throw new Error(`analytics: forbidden property "${key}" on ${event}`);
  }
  return parsed;
}

/** The funnel as shown on the dashboard, in order (user-subject steps). */
export const FUNNEL_STEPS: readonly { event: AnalyticsEvent; label: string }[] = [
  { event: "account_created", label: "Account created" },
  { event: "creator_profile_completed", label: "Profile completed" },
  { event: "social_connection_completed", label: "Account connected" },
  { event: "passport_generated", label: "Passport verified" },
  { event: "status_generated", label: "Status calculated" },
  { event: "financial_eligibility_started", label: "Eligibility started" },
  { event: "financial_inputs_completed", label: "Inputs confirmed" },
  { event: "underwriting_completed", label: "Recommendation prepared" },
  { event: "offer_generated", label: "Offer shown" },
  { event: "simulated_offer_accepted", label: "Offer accepted (simulated)" },
  { event: "access_requested", label: "Access requested" },
];
