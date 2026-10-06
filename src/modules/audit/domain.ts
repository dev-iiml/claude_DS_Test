/** `partner`: a partner lender's API key (actor id = the key's id), Stage 12b. */
export const ACTOR_TYPES = ["user", "system", "partner"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
