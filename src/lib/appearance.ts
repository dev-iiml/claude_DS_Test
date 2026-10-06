import "server-only";

import { cookies } from "next/headers";

import { APPEARANCES, DEFAULT_APPEARANCE, type Appearance } from "@/design/tokens";

/** Per-device appearance preference (like iOS: a device setting, not account data). */
export const APPEARANCE_COOKIE = "cc_appearance";

export function parseAppearance(value: string | undefined | null): Appearance {
  return (APPEARANCES as readonly string[]).includes(value ?? "") ? (value as Appearance) : DEFAULT_APPEARANCE;
}

export async function getAppearance(): Promise<Appearance> {
  const store = await cookies();
  return parseAppearance(store.get(APPEARANCE_COOKIE)?.value);
}
